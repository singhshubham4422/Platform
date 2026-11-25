//! Activity events (C10) stored locally, sealed into gzip JSONL batches for upload (C3 raw/activity).
//!
//! - `append` assigns `seq` from the device counter and the `deviceId`, overriding the client.
//! - `seal_batch` returns the oldest unuploaded batch first, so batches upload in order and a
//!   crash between upload and ack simply re-sends the same batch (same id, same bytes).
//! - Backlog guard: above [`PENDING_LIMIT`] pending events, the oldest `code_changed` events are
//!   merged into hourly summaries (frozen C10 metadata keys only). Other events are never dropped.
use crate::device;
use crate::secrets::SecretStore;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use flate2::{Compression, write::GzEncoder};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::io::Write;

pub const PENDING_LIMIT: i64 = 200_000;
const MAX_EVENT_BYTES: usize = 4096;
const MERGE_CHUNK: i64 = 10_000;

pub const EVENT_TYPES: &[&str] = &[
    "session_started",
    "session_ended",
    "question_opened",
    "editor_started",
    "code_changed",
    "paste_detected",
    "copy_inside_editor",
    "language_changed",
    "reset_to_starter",
    "draft_saved",
    "run_requested",
    "execution_completed",
    "submission_created",
    "question_completed",
    "window_focus_lost",
    "window_focus_gained",
    "idle_period",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SealedBatch {
    pub batch_id: String,
    pub gz_base64: String,
    pub sha256: String,
    pub size_bytes: usize,
    pub event_count: i64,
}

fn io<E: std::fmt::Display>(e: E) -> String {
    format!("IO: {e}")
}

/// Stores valid events; returns how many were stored. Invalid, oversized or duplicate events
/// are skipped (the count of rejected ones is logged, never their content).
pub fn append(
    conn: &mut Connection,
    secrets: &dyn SecretStore,
    events: Vec<Value>,
) -> Result<usize, String> {
    let dev = device::ensure(conn, secrets)?;
    let tx = conn.transaction().map_err(io)?;
    let (mut stored, mut rejected) = (0usize, 0usize);
    for ev in events {
        let Value::Object(mut obj) = ev else {
            rejected += 1;
            continue;
        };
        let id = obj.get("eventId").and_then(Value::as_str).unwrap_or("");
        let ty = obj.get("eventType").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() || id.len() > 64 || !EVENT_TYPES.contains(&ty) {
            rejected += 1;
            continue;
        }
        let id = id.to_owned();
        let seq = device::next_seq(&tx).map_err(io)?;
        obj.insert("seq".into(), json!(seq));
        obj.insert("deviceId".into(), json!(dev.device_id));
        obj.insert("schemaVersion".into(), json!(2));
        let payload = Value::Object(obj).to_string();
        if payload.len() > MAX_EVENT_BYTES {
            rejected += 1;
            continue;
        }
        stored += tx
            .execute(
                "INSERT OR IGNORE INTO activity_events (event_id, seq, payload_json) VALUES (?1, ?2, ?3)",
                params![id, seq, payload],
            )
            .map_err(io)?;
    }
    tx.commit().map_err(io)?;
    if rejected > 0 {
        log::warn!("activity: rejected {rejected} invalid event(s)");
    }
    let merged = compact(conn, PENDING_LIMIT)?;
    if merged > 0 {
        log::warn!("activity: merged {merged} old code_changed event(s) into hourly summaries");
    }
    Ok(stored)
}

fn pending(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM activity_events WHERE batch_id IS NULL",
        [],
        |r| r.get(0),
    )
}

/// One hourly merge group: lowest seq, the first event (template), summed counters, merged ids.
struct Group {
    seq: i64,
    first: Map<String, Value>,
    sums: [i64; 3],
    ids: Vec<String>,
}

/// Merges the oldest pending `code_changed` events when more than `limit` events are pending.
/// Returns the number of events removed by merging.
pub fn compact(conn: &mut Connection, limit: i64) -> Result<usize, String> {
    if pending(conn).map_err(io)? <= limit {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(io)?;
    let rows: Vec<(String, i64, String)> = {
        let mut s = tx
            .prepare(
                "SELECT event_id, seq, payload_json FROM activity_events
                 WHERE batch_id IS NULL AND json_extract(payload_json, '$.eventType') = 'code_changed'
                 ORDER BY seq LIMIT ?1",
            )
            .map_err(io)?;
        s.query_map([MERGE_CHUNK], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(io)?
            .collect::<Result<_, _>>()
            .map_err(io)?
    };
    let key_fields = [
        "userId",
        "organizationId",
        "deviceId",
        "packId",
        "questionId",
        "assessmentId",
        "language",
    ];
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    for (id, seq, payload) in rows {
        let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&payload) else {
            continue;
        };
        let hour: String = obj
            .get("clientTs")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(13)
            .collect();
        let mut key = hour;
        for f in key_fields {
            key.push('|');
            key.push_str(&obj.get(f).map(Value::to_string).unwrap_or_default());
        }
        let m = obj.get("metadata").cloned().unwrap_or(Value::Null);
        let num = |k: &str| m.get(k).and_then(Value::as_i64).unwrap_or(0);
        let g = groups.entry(key).or_insert_with(|| Group {
            seq,
            first: obj.clone(),
            sums: [0; 3],
            ids: Vec::new(),
        });
        g.seq = g.seq.min(seq);
        g.sums[0] += num("insertedChars");
        g.sums[1] += num("deletedChars");
        g.sums[2] += num("burstMs");
        g.ids.push(id);
    }
    let mut removed = 0usize;
    for Group {
        seq,
        mut first,
        sums,
        ids,
    } in groups.into_values()
    {
        if ids.len() < 2 {
            continue;
        }
        for id in &ids {
            removed += tx
                .execute("DELETE FROM activity_events WHERE event_id = ?1", [id])
                .map_err(io)?;
        }
        removed -= 1;
        let new_id = uuid::Uuid::new_v4().to_string();
        first.insert("eventId".into(), json!(new_id));
        first.insert("seq".into(), json!(seq));
        first.insert(
            "metadata".into(),
            json!({ "insertedChars": sums[0], "deletedChars": sums[1], "burstMs": sums[2] }),
        );
        tx.execute(
            "INSERT INTO activity_events (event_id, seq, payload_json) VALUES (?1, ?2, ?3)",
            params![new_id, seq, Value::Object(first).to_string()],
        )
        .map_err(io)?;
    }
    tx.commit().map_err(io)?;
    Ok(removed)
}

/// Returns the oldest unuploaded batch, or seals up to `max_events` pending events into a new one.
pub fn seal_batch(conn: &mut Connection, max_events: i64) -> Result<Option<SealedBatch>, String> {
    let existing = conn
        .query_row(
            "SELECT batch_id, gz, sha256, event_count FROM activity_batches
             WHERE uploaded_at IS NULL ORDER BY created_at, rowid LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(io)?;
    if let Some((batch_id, gz, sha256, event_count)) = existing {
        return Ok(Some(SealedBatch {
            batch_id,
            size_bytes: gz.len(),
            gz_base64: B64.encode(gz),
            sha256,
            event_count,
        }));
    }
    let tx = conn.transaction().map_err(io)?;
    let rows: Vec<(String, String)> = {
        let mut s = tx
            .prepare(
                "SELECT event_id, payload_json FROM activity_events WHERE batch_id IS NULL ORDER BY seq LIMIT ?1",
            )
            .map_err(io)?;
        s.query_map([max_events.clamp(1, 20_000)], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(io)?
        .collect::<Result<_, _>>()
        .map_err(io)?
    };
    if rows.is_empty() {
        return Ok(None);
    }
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    for (_, payload) in &rows {
        enc.write_all(payload.as_bytes()).map_err(io)?;
        enc.write_all(b"\n").map_err(io)?;
    }
    let gz = enc.finish().map_err(io)?;
    let sha256 = crate::attempts::sha256_hex(&gz);
    let batch_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO activity_batches (batch_id, created_at, event_count, sha256, gz)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?2, ?3, ?4)",
        params![batch_id, rows.len() as i64, sha256, gz],
    )
    .map_err(io)?;
    for (id, _) in &rows {
        tx.execute(
            "UPDATE activity_events SET batch_id = ?1 WHERE event_id = ?2",
            params![batch_id, id],
        )
        .map_err(io)?;
    }
    tx.commit().map_err(io)?;
    Ok(Some(SealedBatch {
        batch_id,
        size_bytes: gz.len(),
        gz_base64: B64.encode(&gz),
        sha256,
        event_count: rows.len() as i64,
    }))
}

/// Marks a batch uploaded and deletes its events and bytes.
pub fn ack_batch(conn: &mut Connection, batch_id: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(io)?;
    tx.execute(
        "UPDATE activity_batches SET uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), gz = NULL
         WHERE batch_id = ?1",
        [batch_id],
    )
    .map_err(io)?;
    tx.execute(
        "DELETE FROM activity_events WHERE batch_id = ?1",
        [batch_id],
    )
    .map_err(io)?;
    tx.commit().map_err(io)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCounts {
    pub pending_events: i64,
    pub pending_batches: i64,
}

pub fn counts(conn: &Connection) -> rusqlite::Result<ActivityCounts> {
    Ok(ActivityCounts {
        pending_events: conn.query_row("SELECT COUNT(*) FROM activity_events", [], |r| r.get(0))?,
        pending_batches: conn.query_row(
            "SELECT COUNT(*) FROM activity_batches WHERE uploaded_at IS NULL",
            [],
            |r| r.get(0),
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use crate::store;
    use flate2::read::GzDecoder;
    use std::io::Read;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        store::migrate(&mut c).unwrap();
        c
    }

    fn ev(id: &str, ty: &str, ts: &str, meta: Value) -> Value {
        json!({ "eventId": id, "eventType": ty, "clientTs": ts, "userId": "u1", "organizationId": "o1",
                "deviceId": "spoofed", "seq": 999_999, "packId": "p@1", "questionId": "q1",
                "assessmentId": null, "attemptId": null, "language": "JAVA", "metadata": meta })
    }

    fn unzip(b64: &str) -> Vec<Value> {
        let mut s = String::new();
        GzDecoder::new(&B64.decode(b64).unwrap()[..])
            .read_to_string(&mut s)
            .unwrap();
        s.lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn append_assigns_seq_and_device_and_rejects_unknown_types() {
        let mut c = db();
        let s = MemorySecrets::default();
        let n = append(
            &mut c,
            &s,
            vec![
                ev(
                    "e1",
                    "question_opened",
                    "2026-11-25T10:00:00.000Z",
                    json!({"language":"JAVA"}),
                ),
                ev("e2", "made_up_event", "2026-11-25T10:00:01.000Z", json!({})),
                ev(
                    "e1",
                    "question_opened",
                    "2026-11-25T10:00:00.000Z",
                    json!({}),
                ),
                ev(
                    "e3",
                    "code_changed",
                    "2026-11-25T10:00:02.000Z",
                    json!({"insertedChars":5,"deletedChars":0,"burstMs":800}),
                ),
                json!("not an object"),
            ],
        )
        .unwrap();
        assert_eq!(n, 2);
        let b = seal_batch(&mut c, 100).unwrap().unwrap();
        let lines = unzip(&b.gz_base64);
        assert_eq!(lines.len(), 2);
        let dev = device::ensure(&c, &s).unwrap();
        for l in &lines {
            assert_eq!(l["deviceId"], json!(dev.device_id));
            assert_eq!(l["schemaVersion"], json!(2));
            assert_ne!(l["seq"], json!(999_999));
        }
        assert!(lines[0]["seq"].as_i64() < lines[1]["seq"].as_i64());
        assert_eq!(
            b.sha256,
            crate::attempts::sha256_hex(&B64.decode(&b.gz_base64).unwrap())
        );
    }

    #[test]
    fn same_batch_is_returned_until_acked() {
        let mut c = db();
        let s = MemorySecrets::default();
        append(
            &mut c,
            &s,
            vec![ev(
                "e1",
                "draft_saved",
                "2026-11-25T10:00:00.000Z",
                json!({"chars":3}),
            )],
        )
        .unwrap();
        let a = seal_batch(&mut c, 100).unwrap().unwrap();
        append(
            &mut c,
            &s,
            vec![ev(
                "e2",
                "draft_saved",
                "2026-11-25T10:00:01.000Z",
                json!({"chars":4}),
            )],
        )
        .unwrap();
        let again = seal_batch(&mut c, 100).unwrap().unwrap();
        assert_eq!(a, again);
        ack_batch(&mut c, &a.batch_id).unwrap();
        let next = seal_batch(&mut c, 100).unwrap().unwrap();
        assert_ne!(next.batch_id, a.batch_id);
        assert_eq!(unzip(&next.gz_base64)[0]["eventId"], json!("e2"));
        ack_batch(&mut c, &next.batch_id).unwrap();
        assert!(seal_batch(&mut c, 100).unwrap().is_none());
        assert_eq!(
            counts(&c).unwrap(),
            ActivityCounts {
                pending_events: 0,
                pending_batches: 0
            }
        );
    }

    #[test]
    fn compaction_merges_only_code_changed() {
        let mut c = db();
        let s = MemorySecrets::default();
        let mut evs = vec![];
        for i in 0..5 {
            evs.push(ev(
                &format!("c{i}"),
                "code_changed",
                &format!("2026-11-25T10:0{i}:00.000Z"),
                json!({"insertedChars":10,"deletedChars":1,"burstMs":100}),
            ));
        }
        evs.push(ev(
            "s1",
            "submission_created",
            "2026-11-25T10:06:00.000Z",
            json!({"attemptId":"a","verdict":"ACCEPTED","passed":1,"total":1}),
        ));
        append(&mut c, &s, evs).unwrap();
        assert_eq!(compact(&mut c, 100).unwrap(), 0);
        assert_eq!(compact(&mut c, 2).unwrap(), 4);
        let b = seal_batch(&mut c, 100).unwrap().unwrap();
        let lines = unzip(&b.gz_base64);
        assert_eq!(lines.len(), 2);
        let merged = lines
            .iter()
            .find(|l| l["eventType"] == "code_changed")
            .unwrap();
        assert_eq!(
            merged["metadata"],
            json!({"insertedChars":50,"deletedChars":5,"burstMs":500})
        );
        assert!(lines.iter().any(|l| l["eventType"] == "submission_created"));
    }
}
