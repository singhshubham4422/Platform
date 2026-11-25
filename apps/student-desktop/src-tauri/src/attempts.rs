//! Locally stored Run/Submit attempts (C7 `attempts`), signed with the device key.
//!
//! Canonical JSON (signed bytes; verified by `canonicalAttemptJson` in
//! `supabase/functions/_shared/assessments.js`): a compact JSON object with exactly these keys in
//! this order — attemptId, packId, questionId, assessmentId, language, mode, sourceSha256,
//! verdict, passed, total, totalTimeMs, startedAt, finishedAt, monotonicSeq, deviceId.
//! `assessmentId` is `null` for practice. Strings use standard JSON escaping.
use crate::device;
use crate::runner::{Mode, RunResult};
use crate::secrets::SecretStore;
use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRow {
    pub attempt_id: String,
    pub pack_id: String,
    pub question_id: String,
    pub assessment_id: Option<String>,
    pub language: String,
    pub mode: String,
    pub source: String,
    pub source_sha256: String,
    pub verdict: String,
    pub passed: i64,
    pub total: i64,
    pub total_time_ms: i64,
    pub results: serde_json::Value,
    pub started_at: String,
    pub finished_at: String,
    pub monotonic_seq: i64,
    pub signature: Option<String>,
    pub device_id: String,
    pub synced_at: Option<String>,
    pub sync_error: Option<String>,
}

pub struct AttemptContext<'a> {
    pub pack_id: &'a str,
    pub question_id: &'a str,
    pub assessment_id: Option<&'a str>,
    pub language: &'a str,
    pub source: &'a str,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn js(v: impl Serialize) -> String {
    serde_json::to_string(&v).unwrap_or_else(|_| "null".into())
}

pub fn canonical_json(a: &AttemptRow) -> String {
    format!(
        "{{\"attemptId\":{},\"packId\":{},\"questionId\":{},\"assessmentId\":{},\"language\":{},\"mode\":{},\"sourceSha256\":{},\"verdict\":{},\"passed\":{},\"total\":{},\"totalTimeMs\":{},\"startedAt\":{},\"finishedAt\":{},\"monotonicSeq\":{},\"deviceId\":{}}}",
        js(&a.attempt_id),
        js(&a.pack_id),
        js(&a.question_id),
        js(&a.assessment_id),
        js(&a.language),
        js(&a.mode),
        js(&a.source_sha256),
        js(&a.verdict),
        a.passed,
        a.total,
        a.total_time_ms,
        js(&a.started_at),
        js(&a.finished_at),
        a.monotonic_seq,
        js(&a.device_id),
    )
}

/// Stores a RUN or SUBMIT attempt. CUSTOM runs are not stored (returns `Ok(None)`).
pub fn record(
    conn: &mut Connection,
    secrets: &dyn SecretStore,
    ctx: &AttemptContext,
    result: &RunResult,
) -> Result<Option<AttemptRow>, String> {
    let mode = match result.mode {
        Mode::Run => "RUN",
        Mode::Submit => "SUBMIT",
        Mode::Custom => return Ok(None),
    };
    let dev = device::ensure(conn, secrets)?;
    // Defence in depth: hidden test data never reaches storage even if a caller forgot.
    let mut tests = result.tests.clone();
    for t in tests.iter_mut().filter(|t| t.hidden) {
        t.stdout = None;
        t.stderr = None;
        t.expected_output = None;
        t.input = None;
    }
    let tx = conn.transaction().map_err(|e| format!("IO: {e}"))?;
    let seq = device::next_seq(&tx).map_err(|e| format!("IO: {e}"))?;
    let mut row = AttemptRow {
        attempt_id: result.attempt_id.clone(),
        pack_id: ctx.pack_id.into(),
        question_id: ctx.question_id.into(),
        assessment_id: ctx.assessment_id.map(str::to_owned),
        language: ctx.language.into(),
        mode: mode.into(),
        source: ctx.source.into(),
        source_sha256: sha256_hex(ctx.source.as_bytes()),
        verdict: result.verdict.clone(),
        passed: result.passed as i64,
        total: result.total as i64,
        total_time_ms: result.total_time_ms as i64,
        results: serde_json::to_value(&tests).map_err(|e| format!("IO: {e}"))?,
        started_at: result.started_at.clone(),
        finished_at: result.finished_at.clone(),
        monotonic_seq: seq,
        signature: None,
        device_id: dev.device_id,
        synced_at: None,
        sync_error: None,
    };
    row.signature = device::sign(secrets, canonical_json(&row).as_bytes());
    tx.execute(
        "INSERT INTO attempts (attempt_id, pack_id, question_id, assessment_id, language, mode, source,
            source_sha256, verdict, passed, total, total_time_ms, results_json, started_at, finished_at,
            monotonic_seq, signature, device_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        params![
            row.attempt_id,
            row.pack_id,
            row.question_id,
            row.assessment_id,
            row.language,
            row.mode,
            row.source,
            row.source_sha256,
            row.verdict,
            row.passed,
            row.total,
            row.total_time_ms,
            row.results.to_string(),
            row.started_at,
            row.finished_at,
            row.monotonic_seq,
            row.signature,
            row.device_id,
        ],
    )
    .map_err(|e| format!("IO: {e}"))?;
    tx.commit().map_err(|e| format!("IO: {e}"))?;
    Ok(Some(row))
}

const COLUMNS: &str = "attempt_id, pack_id, question_id, assessment_id, language, mode, source, source_sha256,
    verdict, passed, total, total_time_ms, results_json, started_at, finished_at, monotonic_seq, signature,
    device_id, synced_at, sync_error";

fn map(r: &rusqlite::Row) -> rusqlite::Result<AttemptRow> {
    let results: String = r.get(12)?;
    Ok(AttemptRow {
        attempt_id: r.get(0)?,
        pack_id: r.get(1)?,
        question_id: r.get(2)?,
        assessment_id: r.get(3)?,
        language: r.get(4)?,
        mode: r.get(5)?,
        source: r.get(6)?,
        source_sha256: r.get(7)?,
        verdict: r.get(8)?,
        passed: r.get(9)?,
        total: r.get(10)?,
        total_time_ms: r.get(11)?,
        results: serde_json::from_str(&results).unwrap_or(serde_json::Value::Array(vec![])),
        started_at: r.get(13)?,
        finished_at: r.get(14)?,
        monotonic_seq: r.get(15)?,
        signature: r.get(16)?,
        device_id: r.get(17)?,
        synced_at: r.get(18)?,
        sync_error: r.get(19)?,
    })
}

/// Newest first, at most 200. Filters are optional.
pub fn list(
    conn: &Connection,
    pack_id: Option<&str>,
    question_id: Option<&str>,
) -> rusqlite::Result<Vec<AttemptRow>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM attempts WHERE (?1 IS NULL OR pack_id = ?1) AND (?2 IS NULL OR question_id = ?2)
         ORDER BY monotonic_seq DESC LIMIT 200"
    );
    let mut s = conn.prepare(&sql)?;
    s.query_map(params![pack_id, question_id], map)?.collect()
}

/// Unsynced, unparked SUBMIT attempts, oldest first. RUN attempts never sync.
pub fn due(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<AttemptRow>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM attempts WHERE mode = 'SUBMIT' AND synced_at IS NULL AND sync_error IS NULL
         ORDER BY monotonic_seq ASC LIMIT ?1"
    );
    let mut s = conn.prepare(&sql)?;
    s.query_map([limit.clamp(1, 200)], map)?.collect()
}

pub fn ack(conn: &mut Connection, ids: &[String]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute(
            "UPDATE attempts SET synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), sync_error = NULL
             WHERE attempt_id = ?1 AND synced_at IS NULL",
            [id],
        )?;
    }
    tx.commit()?;
    Ok(n)
}

/// Parks an attempt the server permanently refused (shown to the student; not retried).
pub fn park(conn: &Connection, id: &str, error: &str) -> rusqlite::Result<usize> {
    let error: String = error.chars().take(200).collect();
    conn.execute(
        "UPDATE attempts SET sync_error = ?2 WHERE attempt_id = ?1 AND synced_at IS NULL",
        params![id, error],
    )
}

pub fn count_submits(
    conn: &Connection,
    assessment_id: &str,
    question_id: &str,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM attempts WHERE mode = 'SUBMIT' AND assessment_id = ?1 AND question_id = ?2",
        params![assessment_id, question_id],
        |r| r.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::TestResult;
    use crate::secrets::MemorySecrets;
    use crate::store;
    use base64::{Engine, engine::general_purpose::STANDARD as B64};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        store::migrate(&mut c).unwrap();
        c
    }

    fn result(mode: Mode, id: &str) -> RunResult {
        RunResult {
            attempt_id: id.into(),
            mode,
            verdict: "WRONG_ANSWER".into(),
            compile_output: None,
            tests: vec![
                TestResult {
                    test_id: "v1".into(),
                    hidden: false,
                    verdict: "ACCEPTED".into(),
                    time_ms: 5,
                    memory_kb: 100,
                    stdout: Some("1".into()),
                    stderr: None,
                    expected_output: Some("1".into()),
                    input: Some("x".into()),
                },
                TestResult {
                    test_id: "h1".into(),
                    hidden: true,
                    verdict: "WRONG_ANSWER".into(),
                    time_ms: 5,
                    memory_kb: 100,
                    stdout: Some("SECRET-OUT".into()),
                    stderr: Some("SECRET-ERR".into()),
                    expected_output: Some("SECRET-EXP".into()),
                    input: Some("SECRET-IN".into()),
                },
            ],
            passed: 1,
            total: 2,
            total_time_ms: 10,
            started_at: "2026-11-25T10:00:00.000Z".into(),
            finished_at: "2026-11-25T10:00:01.000Z".into(),
        }
    }

    fn ctx() -> AttemptContext<'static> {
        AttemptContext {
            pack_id: "c0000000-0000-4000-8000-000000000001@1",
            question_id: "q0000000-0000-4000-8000-000000000001",
            assessment_id: None,
            language: "PYTHON",
            source: "print(1)\n",
        }
    }

    #[test]
    fn stores_run_and_submit_with_hidden_fields_nulled_but_not_custom() {
        let mut c = db();
        let s = MemorySecrets::default();
        let run = record(&mut c, &s, &ctx(), &result(Mode::Run, "a1"))
            .unwrap()
            .unwrap();
        record(&mut c, &s, &ctx(), &result(Mode::Submit, "a2"))
            .unwrap()
            .unwrap();
        assert!(
            record(&mut c, &s, &ctx(), &result(Mode::Custom, "a3"))
                .unwrap()
                .is_none()
        );
        assert_eq!(run.source_sha256.len(), 64);
        let all = list(&c, None, None).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].attempt_id, "a2");
        let dump: String = c
            .query_row(
                "SELECT group_concat(results_json, '|') FROM attempts",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!dump.contains("SECRET"), "hidden data leaked: {dump}");
        assert!(dump.contains("\"stdout\":\"1\""));
        // Only SUBMIT is due for sync.
        let due_rows = due(&c, 50).unwrap();
        assert_eq!(due_rows.len(), 1);
        assert_eq!(due_rows[0].attempt_id, "a2");
    }

    /// The same literal is asserted against `canonicalAttemptJson` in
    /// supabase/functions/_shared/canonical-attempt.test.mjs, so desktop and server agree byte for byte.
    pub const CANONICAL_FIXTURE: &str = r#"{"attemptId":"a1","packId":"e@1","questionId":"q","assessmentId":"e","language":"JAVA","mode":"SUBMIT","sourceSha256":"ab","verdict":"ACCEPTED","passed":1,"total":2,"totalTimeMs":3,"startedAt":"s","finishedAt":"f","monotonicSeq":4,"deviceId":"d"}"#;

    #[test]
    fn canonical_json_matches_server_fixture() {
        let row = AttemptRow {
            attempt_id: "a1".into(),
            pack_id: "e@1".into(),
            question_id: "q".into(),
            assessment_id: Some("e".into()),
            language: "JAVA".into(),
            mode: "SUBMIT".into(),
            source: "ignored".into(),
            source_sha256: "ab".into(),
            verdict: "ACCEPTED".into(),
            passed: 1,
            total: 2,
            total_time_ms: 3,
            results: serde_json::json!([]),
            started_at: "s".into(),
            finished_at: "f".into(),
            monotonic_seq: 4,
            signature: None,
            device_id: "d".into(),
            synced_at: None,
            sync_error: None,
        };
        assert_eq!(canonical_json(&row), CANONICAL_FIXTURE);
    }

    #[test]
    fn signature_verifies_over_documented_canonical_json() {
        let mut c = db();
        let s = MemorySecrets::default();
        let row = record(&mut c, &s, &ctx(), &result(Mode::Submit, "a1"))
            .unwrap()
            .unwrap();
        let canonical = canonical_json(&row);
        assert!(canonical.starts_with("{\"attemptId\":\"a1\",\"packId\":"));
        assert!(canonical.contains("\"assessmentId\":null,\"language\":\"PYTHON\""));
        assert!(canonical.ends_with(&format!(
            "\"monotonicSeq\":{},\"deviceId\":\"{}\"}}",
            row.monotonic_seq, row.device_id
        )));
        let dev = device::ensure(&c, &s).unwrap();
        let pk: [u8; 32] = B64.decode(dev.public_key).unwrap().try_into().unwrap();
        let sig: [u8; 64] = B64
            .decode(row.signature.unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        VerifyingKey::from_bytes(&pk)
            .unwrap()
            .verify(canonical.as_bytes(), &Signature::from_bytes(&sig))
            .unwrap();
    }

    #[test]
    fn seq_increases_ack_and_park_remove_from_due() {
        let mut c = db();
        let s = MemorySecrets::default();
        let a = record(&mut c, &s, &ctx(), &result(Mode::Submit, "a1"))
            .unwrap()
            .unwrap();
        let b = record(&mut c, &s, &ctx(), &result(Mode::Submit, "a2"))
            .unwrap()
            .unwrap();
        let d = record(&mut c, &s, &ctx(), &result(Mode::Submit, "a3"))
            .unwrap()
            .unwrap();
        assert!(a.monotonic_seq < b.monotonic_seq && b.monotonic_seq < d.monotonic_seq);
        assert_eq!(ack(&mut c, &["a1".into()]).unwrap(), 1);
        assert_eq!(ack(&mut c, &["a1".into()]).unwrap(), 0);
        park(&c, "a2", "INVALID_ATTEMPT").unwrap();
        let ids: Vec<_> = due(&c, 50)
            .unwrap()
            .into_iter()
            .map(|r| r.attempt_id)
            .collect();
        assert_eq!(ids, vec!["a3"]);
        assert_eq!(
            list(&c, None, Some("q0000000-0000-4000-8000-000000000001"))
                .unwrap()
                .iter()
                .find(|r| r.attempt_id == "a2")
                .unwrap()
                .sync_error
                .as_deref(),
            Some("INVALID_ATTEMPT")
        );
    }
}
