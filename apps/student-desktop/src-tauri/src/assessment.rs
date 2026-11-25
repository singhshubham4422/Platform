//! Phase 10 desktop rules for ASSESSMENT packs.
//!
//! - The per-assessment AES-256-GCM key (from the broker's `assessment-key`) lives only in the
//!   [`SecretStore`]; hidden tests are decrypted in memory for one run and dropped.
//! - Window, duration and attempt limits are enforced locally for the student's benefit. The
//!   local clock is NOT trusted for grading: the server labels lateness from its own clock.
//! - Duration starts when the key is first stored on this device (the "Start" moment).
use crate::attempts;
use crate::runner::TestCase;
use crate::secrets::{SecretStore, assessment_key_name};
use crate::store;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssessmentInfo {
    pub opens_at_ms: i64,
    pub closes_at_ms: i64,
    pub duration_minutes: i64,
    pub attempts_allowed: i64,
    pub grace_minutes: i64,
    pub key_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentStatus {
    pub has_key: bool,
    pub started_at_ms: Option<i64>,
    pub ends_at_ms: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredKey {
    key_id: String,
    key_b64: String,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` (what Postgres and JS produce) to epoch ms.
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = format!("{:0<3}", &s[start..i]);
        ms = frac.get(0..3)?.parse().ok()?;
    }
    let offset_min = match b.get(i)? {
        b'Z' => 0,
        sign @ (b'+' | b'-') => {
            let oh = num(i + 1..i + 3)?;
            let om = num(i + 4..i + 6)?;
            let v = oh * 60 + om;
            if *sign == b'+' { v } else { -v }
        }
        _ => return None,
    };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // Days from civil (Howard Hinnant's algorithm).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60 + sec) - offset_min * 60) * 1000 + ms)
}

pub fn info(manifest: &serde_json::Value) -> Result<AssessmentInfo, String> {
    let a = &manifest["assessment"];
    let bad = || "INVALID_MANIFEST: assessment".to_string();
    Ok(AssessmentInfo {
        opens_at_ms: a["opensAt"]
            .as_str()
            .and_then(parse_iso_ms)
            .ok_or_else(bad)?,
        closes_at_ms: a["closesAt"]
            .as_str()
            .and_then(parse_iso_ms)
            .ok_or_else(bad)?,
        duration_minutes: a["durationMinutes"].as_i64().ok_or_else(bad)?,
        attempts_allowed: a["attemptsAllowed"].as_i64().ok_or_else(bad)?,
        grace_minutes: a["gracePeriodMinutes"].as_i64().unwrap_or(0),
        key_id: a["keyId"].as_str().ok_or_else(bad)?.to_owned(),
    })
}

fn start_cursor(assessment_id: &str) -> String {
    format!("assessment-start:{assessment_id}")
}

/// Stores the key in the secret store and records the local start time (first time only).
pub fn store_key(
    conn: &Connection,
    secrets: &dyn SecretStore,
    assessment_id: &str,
    key_id: &str,
    key_b64: &str,
    now: i64,
) -> Result<(), String> {
    let raw = B64
        .decode(key_b64)
        .map_err(|_| "IO: invalid assessment key".to_string())?;
    if raw.len() != 32 || key_id.is_empty() || assessment_id.is_empty() {
        return Err("IO: invalid assessment key".into());
    }
    let value = serde_json::to_string(&StoredKey {
        key_id: key_id.into(),
        key_b64: key_b64.into(),
    })
    .map_err(|e| format!("IO: {e}"))?;
    secrets.set(&assessment_key_name(assessment_id), &value)?;
    if store::get_cursor(conn, &start_cursor(assessment_id))
        .map_err(|e| format!("IO: {e}"))?
        .is_none()
    {
        store::set_cursor(conn, &start_cursor(assessment_id), &now.to_string())
            .map_err(|e| format!("IO: {e}"))?;
    }
    Ok(())
}

fn started_at(conn: &Connection, assessment_id: &str) -> Result<Option<i64>, String> {
    Ok(store::get_cursor(conn, &start_cursor(assessment_id))
        .map_err(|e| format!("IO: {e}"))?
        .and_then(|v| v.parse().ok()))
}

fn load_key(
    secrets: &dyn SecretStore,
    assessment_id: &str,
    info: &AssessmentInfo,
) -> Result<[u8; 32], String> {
    let locked = || "ASSESSMENT_LOCKED: start the assessment while online".to_string();
    let stored: StoredKey = secrets
        .get(&assessment_key_name(assessment_id))
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str(&v).ok())
        .ok_or_else(locked)?;
    if stored.key_id != info.key_id {
        return Err(locked());
    }
    B64.decode(stored.key_b64)
        .ok()
        .and_then(|k| k.try_into().ok())
        .ok_or_else(locked)
}

pub fn status(
    conn: &Connection,
    secrets: &dyn SecretStore,
    assessment_id: &str,
    info: &AssessmentInfo,
) -> Result<AssessmentStatus, String> {
    let has_key = load_key(secrets, assessment_id, info).is_ok();
    let started = started_at(conn, assessment_id)?;
    Ok(AssessmentStatus {
        has_key,
        started_at_ms: started,
        ends_at_ms: started.map(|s| (s + info.duration_minutes * 60_000).min(info.closes_at_ms)),
    })
}

/// Checks the local key, window and duration before any run on an assessment pack.
pub fn check_can_run(
    conn: &Connection,
    secrets: &dyn SecretStore,
    assessment_id: &str,
    info: &AssessmentInfo,
    now: i64,
) -> Result<(), String> {
    load_key(secrets, assessment_id, info)?;
    if now > info.closes_at_ms + info.grace_minutes * 60_000 {
        return Err("ASSESSMENT_CLOSED: the assessment window has ended".into());
    }
    if let Some(start) = started_at(conn, assessment_id)?
        && now > start + info.duration_minutes * 60_000 + info.grace_minutes * 60_000
    {
        return Err("ASSESSMENT_CLOSED: your time for this assessment is up".into());
    }
    Ok(())
}

pub fn check_attempts(
    conn: &Connection,
    assessment_id: &str,
    question_id: &str,
    info: &AssessmentInfo,
) -> Result<(), String> {
    let used = attempts::count_submits(conn, assessment_id, question_id)
        .map_err(|e| format!("IO: {e}"))?;
    if used >= info.attempts_allowed {
        return Err(format!(
            "ATTEMPTS_EXCEEDED: {used} of {} attempts used",
            info.attempts_allowed
        ));
    }
    Ok(())
}

/// Decrypts `tests/{id}.hidden.enc` (C5) in memory. A wrong key reports ASSESSMENT_LOCKED.
pub fn hidden_tests(
    enc_file: &[u8],
    secrets: &dyn SecretStore,
    assessment_id: &str,
    info: &AssessmentInfo,
) -> Result<Vec<TestCase>, String> {
    let key = load_key(secrets, assessment_id, info)?;
    let enc: serde_json::Value =
        serde_json::from_slice(enc_file).map_err(|_| "INVALID_MANIFEST: hidden".to_string())?;
    let locked = || "ASSESSMENT_LOCKED: DECRYPT_FAILED".to_string();
    if enc["alg"] != "A256GCM" {
        return Err(locked());
    }
    let nonce = enc["nonce"]
        .as_str()
        .and_then(|n| B64.decode(n).ok())
        .filter(|n| n.len() == 12)
        .ok_or_else(locked)?;
    let ct = enc["ciphertext"]
        .as_str()
        .and_then(|c| B64.decode(c).ok())
        .ok_or_else(locked)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| locked())?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| locked())?;
    let parsed: serde_json::Value = serde_json::from_slice(&plain).map_err(|_| locked())?;
    drop(plain);
    parsed["tests"]
        .as_array()
        .ok_or_else(locked)?
        .iter()
        .map(|t| {
            Ok(TestCase {
                id: t["id"].as_str().ok_or_else(locked)?.into(),
                input: t["input"].as_str().unwrap_or("").into(),
                expected_output: Some(t["expectedOutput"].as_str().ok_or_else(locked)?.into()),
                hidden: true,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use aes_gcm::aead::OsRng;
    use aes_gcm::{AeadCore, aead::Aead};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        store::migrate(&mut c).unwrap();
        c
    }

    fn info_fixture() -> AssessmentInfo {
        AssessmentInfo {
            opens_at_ms: parse_iso_ms("2026-11-25T09:00:00.000Z").unwrap(),
            closes_at_ms: parse_iso_ms("2026-11-25T12:00:00.000Z").unwrap(),
            duration_minutes: 60,
            attempts_allowed: 2,
            grace_minutes: 10,
            key_id: "k1".into(),
        }
    }

    fn encrypt(key: &[u8; 32], plain: &str) -> Vec<u8> {
        let cipher = Aes256Gcm::new_from_slice(key).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = cipher.encrypt(&nonce, plain.as_bytes()).unwrap();
        serde_json::json!({"alg":"A256GCM","keyId":"k1","nonce":B64.encode(nonce),"ciphertext":B64.encode(ct)})
            .to_string()
            .into_bytes()
    }

    #[test]
    fn parses_iso_variants() {
        let z = parse_iso_ms("2026-11-25T10:00:00.000Z").unwrap();
        assert_eq!(parse_iso_ms("2026-11-25T10:00:00Z"), Some(z));
        assert_eq!(parse_iso_ms("2026-11-25T15:30:00+05:30"), Some(z));
        assert_eq!(parse_iso_ms("2026-11-25 10:00:00.5+00:00"), Some(z + 500));
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("not a date"), None);
    }

    #[test]
    fn without_key_runs_are_locked_and_with_key_hidden_tests_decrypt_in_memory() {
        let c = db();
        let s = MemorySecrets::default();
        let info = info_fixture();
        let key = [7u8; 32];
        let enc = encrypt(
            &key,
            r#"{"tests":[{"id":"h1","input":"1","expectedOutput":"MARKER-OUT"}]}"#,
        );
        let now = info.opens_at_ms + 1000;
        assert!(
            check_can_run(&c, &s, "a1", &info, now)
                .unwrap_err()
                .starts_with("ASSESSMENT_LOCKED")
        );
        assert!(
            hidden_tests(&enc, &s, "a1", &info)
                .unwrap_err()
                .starts_with("ASSESSMENT_LOCKED")
        );
        store_key(&c, &s, "a1", "k1", &B64.encode(key), now).unwrap();
        check_can_run(&c, &s, "a1", &info, now).unwrap();
        let tests = hidden_tests(&enc, &s, "a1", &info).unwrap();
        assert_eq!(tests.len(), 1);
        assert!(tests[0].hidden);
        assert_eq!(tests[0].expected_output.as_deref(), Some("MARKER-OUT"));
        let st = status(&c, &s, "a1", &info).unwrap();
        assert!(st.has_key && st.started_at_ms.is_some());
    }

    #[test]
    fn wrong_key_or_key_id_is_locked() {
        let c = db();
        let s = MemorySecrets::default();
        let info = info_fixture();
        let enc = encrypt(&[7u8; 32], r#"{"tests":[]}"#);
        store_key(&c, &s, "a1", "k1", &B64.encode([9u8; 32]), 0).unwrap();
        assert_eq!(
            hidden_tests(&enc, &s, "a1", &info).unwrap_err(),
            "ASSESSMENT_LOCKED: DECRYPT_FAILED"
        );
        store_key(&c, &s, "a1", "other-key-id", &B64.encode([7u8; 32]), 0).unwrap();
        assert!(
            hidden_tests(&enc, &s, "a1", &info)
                .unwrap_err()
                .starts_with("ASSESSMENT_LOCKED")
        );
        assert!(store_key(&c, &s, "a1", "k1", "c2hvcnQ=", 0).is_err());
    }

    #[test]
    fn window_and_duration_are_enforced_locally() {
        let c = db();
        let s = MemorySecrets::default();
        let info = info_fixture();
        let start = info.opens_at_ms + 5 * 60_000;
        store_key(&c, &s, "a1", "k1", &B64.encode([1u8; 32]), start).unwrap();
        // Duration 60 min + 10 min grace from the local start.
        assert!(check_can_run(&c, &s, "a1", &info, start + 69 * 60_000).is_ok());
        assert!(
            check_can_run(&c, &s, "a1", &info, start + 71 * 60_000)
                .unwrap_err()
                .contains("time for this assessment is up")
        );
        // Window end + grace closes it regardless of start.
        let mut long = info.clone();
        long.duration_minutes = 600;
        assert!(
            check_can_run(&c, &s, "a1", &long, info.closes_at_ms + 11 * 60_000)
                .unwrap_err()
                .contains("window has ended")
        );
        // Re-storing the key does not restart the clock.
        store_key(
            &c,
            &s,
            "a1",
            "k1",
            &B64.encode([1u8; 32]),
            start + 30 * 60_000,
        )
        .unwrap();
        let st = status(&c, &s, "a1", &info).unwrap();
        assert_eq!(st.started_at_ms, Some(start));
        assert_eq!(st.ends_at_ms, Some(start + 60 * 60_000));
    }

    #[test]
    fn attempts_limit_is_enforced_locally() {
        let mut c = db();
        let s = MemorySecrets::default();
        let info = info_fixture();
        assert!(check_attempts(&c, "a1", "q1", &info).is_ok());

        let result = crate::runner::RunResult {
            attempt_id: "att-1".into(),
            mode: crate::runner::Mode::Submit,
            verdict: "ACCEPTED".into(),
            compile_output: None,
            tests: vec![],
            passed: 1,
            total: 1,
            total_time_ms: 10,
            started_at: "2026-11-25T10:00:00.000Z".into(),
            finished_at: "2026-11-25T10:00:01.000Z".into(),
        };
        let ctx = attempts::AttemptContext {
            pack_id: "a1@1",
            question_id: "q1",
            assessment_id: Some("a1"),
            language: "PYTHON",
            source: "print(1)",
        };
        attempts::record(&mut c, &s, &ctx, &result).unwrap();
        assert!(check_attempts(&c, "a1", "q1", &info).is_ok());

        let mut result2 = result.clone();
        result2.attempt_id = "att-2".into();
        attempts::record(&mut c, &s, &ctx, &result2).unwrap();
        let err = check_attempts(&c, "a1", "q1", &info).unwrap_err();
        assert!(err.starts_with("ATTEMPTS_EXCEEDED: 2 of 2"), "got {err}");
    }
}
