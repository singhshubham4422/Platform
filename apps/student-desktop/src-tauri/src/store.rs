//! Local SQLite store for the student workspace.
//!
//! Holds drafts, the sync outbox, notes, course-package metadata and sync cursors in
//! `<app data dir>/lplatform.db`. Authentication secrets are NOT stored here (they live in the
//! OS credential vault). The server stays authoritative for grades and submission status.
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub struct Store(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackRow {
    pub pack_id: String,
    pub kind: String,
    pub course_id: String,
    pub assessment_id: Option<String>,
    pub version: i64,
    pub title: String,
    pub path: String,
    pub sha256: String,
    pub manifest_json: String,
    pub installed_at: String,
}

pub fn packs_list(conn: &Connection) -> rusqlite::Result<Vec<PackRow>> {
    let mut s=conn.prepare("SELECT pack_id,kind,course_id,assessment_id,version,title,path,sha256,manifest_json,installed_at FROM packs ORDER BY title COLLATE NOCASE")?;
    s.query_map([], |r| {
        Ok(PackRow {
            pack_id: r.get(0)?,
            kind: r.get(1)?,
            course_id: r.get(2)?,
            assessment_id: r.get(3)?,
            version: r.get(4)?,
            title: r.get(5)?,
            path: r.get(6)?,
            sha256: r.get(7)?,
            manifest_json: r.get(8)?,
            installed_at: r.get(9)?,
        })
    })?
    .collect()
}
pub fn packs_get(conn: &Connection, id: &str) -> rusqlite::Result<Option<PackRow>> {
    conn.query_row("SELECT pack_id,kind,course_id,assessment_id,version,title,path,sha256,manifest_json,installed_at FROM packs WHERE pack_id=?1",[id],|r|Ok(PackRow{pack_id:r.get(0)?,kind:r.get(1)?,course_id:r.get(2)?,assessment_id:r.get(3)?,version:r.get(4)?,title:r.get(5)?,path:r.get(6)?,sha256:r.get(7)?,manifest_json:r.get(8)?,installed_at:r.get(9)?})).optional()
}
pub fn packs_put(conn: &Connection, p: &PackRow) -> rusqlite::Result<()> {
    conn.execute("INSERT OR REPLACE INTO packs(pack_id,kind,course_id,assessment_id,version,title,path,sha256,manifest_json,installed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![p.pack_id,p.kind,p.course_id,p.assessment_id,p.version,p.title,p.path,p.sha256,p.manifest_json,p.installed_at])?;
    Ok(())
}
pub fn packs_remove(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM packs WHERE pack_id=?1", [id])
}

/// Ordered, append-only migrations. Never edit a released entry; add a new one.
const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        r#"
    CREATE TABLE code_drafts (
        question_id   TEXT NOT NULL,
        assignment_id TEXT NOT NULL DEFAULT '',
        language_id   TEXT NOT NULL,
        source_text   TEXT NOT NULL,
        revision      INTEGER NOT NULL DEFAULT 1,
        updated_at    TEXT NOT NULL,
        synced        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (question_id, assignment_id, language_id)
    );
    CREATE TABLE outbox (
        operation_id    TEXT PRIMARY KEY,
        operation_type  TEXT NOT NULL CHECK (operation_type IN ('EVENT','SNAPSHOT','SUBMISSION')),
        entity_id       TEXT,
        payload_json    TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        attempt_count   INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error_code TEXT,
        sync_state      TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_state IN ('PENDING','FAILED_PERMANENT'))
    );
    CREATE INDEX idx_outbox_due ON outbox (operation_type, sync_state, next_attempt_at, created_at);
    CREATE TABLE local_notes (
        note_id     TEXT PRIMARY KEY,
        course_id   TEXT,
        resource_id TEXT,
        body        TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        sync_state  TEXT NOT NULL DEFAULT 'LOCAL'
    );
    CREATE TABLE course_cache (
        course_id       TEXT PRIMARY KEY,
        package_version INTEGER NOT NULL,
        manifest_json   TEXT NOT NULL,
        downloaded_at   TEXT NOT NULL
    );
    CREATE TABLE sync_cursors (
        stream_name  TEXT PRIMARY KEY,
        cursor_value TEXT,
        updated_at   TEXT NOT NULL
    );
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    "#,
    ),
    (
        2,
        r#"
    CREATE TABLE runtimes (
        language TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        PRIMARY KEY (language, version)
    );
    "#,
    ),
    (
        3,
        r#"
    CREATE TABLE packs (
        pack_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        course_id TEXT,
        assessment_id TEXT,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        installed_at TEXT NOT NULL
    );
    "#,
    ),
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    )?;
    for (version, sql) in MIGRATIONS {
        let applied: Option<i64> = conn
            .query_row(
                "SELECT version FROM local_schema_migrations WHERE version = ?1",
                [version],
                |r| r.get(0),
            )
            .optional()?;
        if applied.is_none() {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO local_schema_migrations (version, applied_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                [version],
            )?;
            tx.commit()?;
        }
    }
    Ok(())
}

fn now() -> String {
    // SQLite-formatted UTC timestamp; computed in SQL to avoid a chrono dependency.
    String::from("strftime('%Y-%m-%dT%H:%M:%fZ','now')")
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub question_id: String,
    pub assignment_id: Option<String>,
    pub language: String,
    pub content: String,
    pub updated_at: String,
    pub synced: bool,
    pub revision: i64,
}

pub fn save_draft(
    conn: &Connection,
    question_id: &str,
    assignment_id: Option<&str>,
    language: &str,
    content: &str,
) -> rusqlite::Result<Draft> {
    conn.execute(
        &format!(
            "INSERT INTO code_drafts (question_id, assignment_id, language_id, source_text, revision, updated_at, synced)
             VALUES (?1, ?2, ?3, ?4, 1, {n}, 0)
             ON CONFLICT (question_id, assignment_id, language_id) DO UPDATE SET
               source_text = excluded.source_text, revision = code_drafts.revision + 1, updated_at = {n}, synced = 0",
            n = now()
        ),
        params![question_id, assignment_id.unwrap_or(""), language, content],
    )?;
    Ok(get_draft(conn, question_id, assignment_id, language)?.expect("draft just written"))
}

fn row_to_draft(r: &rusqlite::Row) -> rusqlite::Result<Draft> {
    let assignment: String = r.get(1)?;
    Ok(Draft {
        question_id: r.get(0)?,
        assignment_id: if assignment.is_empty() {
            None
        } else {
            Some(assignment)
        },
        language: r.get(2)?,
        content: r.get(3)?,
        revision: r.get(4)?,
        updated_at: r.get(5)?,
        synced: r.get::<_, i64>(6)? == 1,
    })
}

const DRAFT_COLS: &str =
    "question_id, assignment_id, language_id, source_text, revision, updated_at, synced";

pub fn get_draft(
    conn: &Connection,
    question_id: &str,
    assignment_id: Option<&str>,
    language: &str,
) -> rusqlite::Result<Option<Draft>> {
    conn.query_row(
        &format!("SELECT {DRAFT_COLS} FROM code_drafts WHERE question_id = ?1 AND assignment_id = ?2 AND language_id = ?3"),
        params![question_id, assignment_id.unwrap_or(""), language],
        row_to_draft,
    )
    .optional()
}

pub fn list_drafts(conn: &Connection) -> rusqlite::Result<Vec<Draft>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DRAFT_COLS} FROM code_drafts ORDER BY updated_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_draft)?;
    rows.collect()
}

/// Marks a draft synced only if it was not edited again since the upload started.
pub fn mark_draft_synced(
    conn: &Connection,
    question_id: &str,
    assignment_id: Option<&str>,
    language: &str,
    revision: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE code_drafts SET synced = 1 WHERE question_id = ?1 AND assignment_id = ?2 AND language_id = ?3 AND revision = ?4",
        params![question_id, assignment_id.unwrap_or(""), language, revision],
    )
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub operation_id: String,
    pub operation_type: String,
    pub payload_json: String,
    pub attempt_count: i64,
}

/// Idempotent enqueue: re-sending the same operation id is a no-op.
pub fn enqueue(
    conn: &Connection,
    operation_id: &str,
    operation_type: &str,
    entity_id: Option<&str>,
    payload_json: &str,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        &format!(
            "INSERT OR IGNORE INTO outbox (operation_id, operation_type, entity_id, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, {})",
            now()
        ),
        params![operation_id, operation_type, entity_id, payload_json],
    )?;
    Ok(n == 1)
}

/// Pending operations whose retry time has arrived, oldest first.
pub fn due(
    conn: &Connection,
    operation_type: &str,
    limit: i64,
) -> rusqlite::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT operation_id, operation_type, payload_json, attempt_count FROM outbox
         WHERE operation_type = ?1 AND sync_state = 'PENDING'
           AND (next_attempt_at IS NULL OR next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ORDER BY created_at LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![operation_type, limit], |r| {
        Ok(OutboxItem {
            operation_id: r.get(0)?,
            operation_type: r.get(1)?,
            payload_json: r.get(2)?,
            attempt_count: r.get(3)?,
        })
    })?;
    rows.collect()
}

/// Remove acknowledged operations (only after the server confirmed them).
pub fn ack(tx: &Transaction, ids: &[String]) -> rusqlite::Result<usize> {
    let mut n = 0;
    for id in ids {
        n += tx.execute("DELETE FROM outbox WHERE operation_id = ?1", [id])?;
    }
    Ok(n)
}

/// Record a failure. Transient failures back off exponentially (5 s · 2^n, max 1 h, ±20 % jitter
/// supplied by the caller); permanent failures stop retrying and are surfaced to the student.
pub fn fail(
    conn: &Connection,
    operation_id: &str,
    error_code: &str,
    permanent: bool,
    jitter_pct: i64,
) -> rusqlite::Result<()> {
    if permanent {
        conn.execute(
            "UPDATE outbox SET sync_state = 'FAILED_PERMANENT', last_error_code = ?2, attempt_count = attempt_count + 1 WHERE operation_id = ?1",
            params![operation_id, error_code],
        )?;
        return Ok(());
    }
    conn.execute(
        "UPDATE outbox SET attempt_count = attempt_count + 1, last_error_code = ?2,
           next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now',
             '+' || CAST(MIN(3600, 5 * (1 << MIN(attempt_count, 10))) * (100 + ?3) / 100 AS INTEGER) || ' seconds')
         WHERE operation_id = ?1",
        params![operation_id, error_code, jitter_pct.clamp(-20, 20)],
    )?;
    Ok(())
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub events: i64,
    pub snapshots: i64,
    pub submissions: i64,
    pub unsynced_drafts: i64,
    pub failed: i64,
}

pub fn counts(conn: &Connection) -> rusqlite::Result<Counts> {
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0));
    Ok(Counts {
        events: count(
            "SELECT COUNT(*) FROM outbox WHERE operation_type='EVENT' AND sync_state='PENDING'",
        )?,
        snapshots: count(
            "SELECT COUNT(*) FROM outbox WHERE operation_type='SNAPSHOT' AND sync_state='PENDING'",
        )?,
        submissions: count(
            "SELECT COUNT(*) FROM outbox WHERE operation_type='SUBMISSION' AND sync_state='PENDING'",
        )?,
        unsynced_drafts: count("SELECT COUNT(*) FROM code_drafts WHERE synced = 0")?,
        failed: count("SELECT COUNT(*) FROM outbox WHERE sync_state='FAILED_PERMANENT'")?,
    })
}

pub fn list_failed(conn: &Connection) -> rusqlite::Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare("SELECT operation_id, operation_type, COALESCE(last_error_code,'') FROM outbox WHERE sync_state='FAILED_PERMANENT' ORDER BY created_at")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

pub fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .optional()
}

pub fn set_cursor(conn: &Connection, stream: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        &format!("INSERT INTO sync_cursors (stream_name, cursor_value, updated_at) VALUES (?1, ?2, {n}) ON CONFLICT (stream_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = {n}", n = now()),
        params![stream, value],
    )?;
    Ok(())
}

pub fn get_cursor(conn: &Connection, stream: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT cursor_value FROM sync_cursors WHERE stream_name = ?1",
        [stream],
        |r| r.get(0),
    )
    .optional()
    .map(|v| v.flatten())
}

pub fn save_note(
    conn: &Connection,
    note_id: &str,
    course_id: Option<&str>,
    resource_id: Option<&str>,
    body: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        &format!("INSERT INTO local_notes (note_id, course_id, resource_id, body, updated_at) VALUES (?1, ?2, ?3, ?4, {n}) ON CONFLICT (note_id) DO UPDATE SET body = excluded.body, updated_at = {n}", n = now()),
        params![note_id, course_id, resource_id, body],
    )?;
    Ok(())
}

/// (note_id, course_id, resource_id, body, updated_at)
pub type NoteRow = (String, Option<String>, Option<String>, String, String);

pub fn list_notes(conn: &Connection, course_id: Option<&str>) -> rusqlite::Result<Vec<NoteRow>> {
    let mut stmt = conn.prepare("SELECT note_id, course_id, resource_id, body, updated_at FROM local_notes WHERE (?1 IS NULL OR course_id = ?1) ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([course_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })?;
    rows.collect()
}

pub fn put_course(
    conn: &Connection,
    course_id: &str,
    version: i64,
    manifest_json: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        &format!("INSERT INTO course_cache (course_id, package_version, manifest_json, downloaded_at) VALUES (?1, ?2, ?3, {n}) ON CONFLICT (course_id) DO UPDATE SET package_version = excluded.package_version, manifest_json = excluded.manifest_json, downloaded_at = {n}", n = now()),
        params![course_id, version, manifest_json],
    )?;
    Ok(())
}

pub fn list_courses(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT manifest_json FROM course_cache ORDER BY downloaded_at DESC")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRow {
    pub language: String,
    pub version: String,
    pub path: String,
    pub sha256: String,
    pub installed_at: String,
}

pub fn runtimes_list(conn: &Connection) -> rusqlite::Result<Vec<RuntimeRow>> {
    let mut stmt = conn.prepare("SELECT language, version, path, sha256, installed_at FROM runtimes ORDER BY language, installed_at DESC")?;
    stmt.query_map([], |r| {
        Ok(RuntimeRow {
            language: r.get(0)?,
            version: r.get(1)?,
            path: r.get(2)?,
            sha256: r.get(3)?,
            installed_at: r.get(4)?,
        })
    })?
    .collect()
}

pub fn runtimes_get(
    conn: &Connection,
    language: &str,
    version: &str,
) -> rusqlite::Result<Option<RuntimeRow>> {
    conn.query_row("SELECT language, version, path, sha256, installed_at FROM runtimes WHERE language=?1 AND version=?2", params![language, version], |r| Ok(RuntimeRow {
        language:r.get(0)?, version:r.get(1)?, path:r.get(2)?, sha256:r.get(3)?, installed_at:r.get(4)?,
    })).optional()
}

pub fn runtimes_put(conn: &Connection, row: &RuntimeRow) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO runtimes(language,version,path,sha256,installed_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(language,version) DO UPDATE SET path=excluded.path,sha256=excluded.sha256,installed_at=excluded.installed_at", params![row.language,row.version,row.path,row.sha256,row.installed_at])?;
    Ok(())
}

pub fn runtimes_remove(
    conn: &Connection,
    language: &str,
    version: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM runtimes WHERE language=?1 AND version=?2",
        params![language, version],
    )
}

pub fn delete_course(conn: &Connection, course_id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM course_cache WHERE course_id = ?1", [course_id])
}

/// One-time import of drafts and pending operations previously kept in webview localStorage.
/// Runs in a single transaction and records completion, so repeating it is a no-op.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyExport {
    pub drafts: Vec<LegacyDraft>,
    pub events: Vec<serde_json::Value>,
    pub snapshots: Vec<serde_json::Value>,
    pub submissions: Vec<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDraft {
    pub question_id: String,
    pub assignment_id: Option<String>,
    pub language: String,
    pub content: String,
    pub synced: bool,
}

pub fn import_legacy(
    conn: &mut Connection,
    export: &LegacyExport,
) -> rusqlite::Result<(usize, usize)> {
    if get_meta(conn, "legacy_import_v1")?.is_some() {
        return Ok((0, 0));
    }
    let tx = conn.transaction()?;
    let mut drafts = 0;
    for d in &export.drafts {
        drafts += tx.execute(
            &format!("INSERT OR IGNORE INTO code_drafts (question_id, assignment_id, language_id, source_text, revision, updated_at, synced) VALUES (?1, ?2, ?3, ?4, 1, {}, ?5)", now()),
            params![d.question_id, d.assignment_id.clone().unwrap_or_default(), d.language, d.content, d.synced as i64],
        )?;
    }
    let mut ops = 0;
    for (kind, items, id_key) in [
        ("EVENT", &export.events, "id"),
        ("SNAPSHOT", &export.snapshots, "id"),
        ("SUBMISSION", &export.submissions, "clientOperationId"),
    ] {
        for item in items {
            if let Some(id) = item.get(id_key).and_then(|v| v.as_str()) {
                ops += tx.execute(
                    &format!("INSERT OR IGNORE INTO outbox (operation_id, operation_type, payload_json, created_at) VALUES (?1, ?2, ?3, {})", now()),
                    params![id, kind, item.to_string()],
                )?;
            }
        }
    }
    tx.execute("INSERT INTO app_meta (key, value) VALUES ('legacy_import_v1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [])?;
    tx.commit()?;
    Ok((drafts, ops))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_migration_adds_only_the_runtime_table_to_existing_store() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE local_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap();
        conn.execute(
            "INSERT INTO local_schema_migrations(version, applied_at) VALUES(1, 'before')",
            [],
        )
        .unwrap();
        let before: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        migrate(&mut conn).unwrap();
        let after: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert!(before.iter().all(|name| after.contains(name)));
        assert!(after.contains(&"runtimes".to_string()));
        let migration: i64 = conn
            .query_row(
                "SELECT version FROM local_schema_migrations WHERE version=2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(migration, 2);
    }

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        c
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut c = mem();
        migrate(&mut c).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM local_schema_migrations", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, MIGRATIONS.len() as i64);
    }

    #[test]
    fn drafts_are_separate_per_language_and_track_revisions() {
        let c = mem();
        save_draft(&c, "q", Some("a"), "PYTHON", "v1").unwrap();
        let d = save_draft(&c, "q", Some("a"), "PYTHON", "v2").unwrap();
        save_draft(&c, "q", Some("a"), "JAVA", "j").unwrap();
        assert_eq!(d.revision, 2);
        assert_eq!(
            get_draft(&c, "q", Some("a"), "PYTHON")
                .unwrap()
                .unwrap()
                .content,
            "v2"
        );
        assert_eq!(
            get_draft(&c, "q", Some("a"), "JAVA")
                .unwrap()
                .unwrap()
                .content,
            "j"
        );
        assert!(get_draft(&c, "q", None, "PYTHON").unwrap().is_none());
        // A stale ack (older revision) must not mark the newer draft as synced.
        assert_eq!(
            mark_draft_synced(&c, "q", Some("a"), "PYTHON", 1).unwrap(),
            0
        );
        assert_eq!(
            mark_draft_synced(&c, "q", Some("a"), "PYTHON", 2).unwrap(),
            1
        );
    }

    #[test]
    fn outbox_is_idempotent_and_backs_off() {
        let mut c = mem();
        assert!(enqueue(&c, "op-1", "SUBMISSION", Some("q"), "{}").unwrap());
        assert!(
            !enqueue(&c, "op-1", "SUBMISSION", Some("q"), "{}").unwrap(),
            "duplicate enqueue ignored"
        );
        assert_eq!(due(&c, "SUBMISSION", 10).unwrap().len(), 1);
        fail(&c, "op-1", "NETWORK", false, 0).unwrap();
        assert_eq!(
            due(&c, "SUBMISSION", 10).unwrap().len(),
            0,
            "not due during backoff"
        );
        assert_eq!(
            counts(&c).unwrap().submissions,
            1,
            "still pending, not lost"
        );
        fail(&c, "op-1", "VALIDATION", true, 0).unwrap();
        assert_eq!(counts(&c).unwrap().failed, 1);
        enqueue(&c, "op-2", "EVENT", None, "{}").unwrap();
        let tx = c.transaction().unwrap();
        assert_eq!(ack(&tx, &["op-2".into()]).unwrap(), 1);
        tx.commit().unwrap();
        assert_eq!(counts(&c).unwrap().events, 0);
    }

    #[test]
    fn data_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("lp-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        {
            let c = open(&path).unwrap();
            save_draft(&c, "q", None, "C", "int main(){}").unwrap();
            enqueue(&c, "op", "SUBMISSION", None, "{\"x\":1}").unwrap();
        }
        let c = open(&path).unwrap();
        assert_eq!(
            get_draft(&c, "q", None, "C").unwrap().unwrap().content,
            "int main(){}"
        );
        assert_eq!(counts(&c).unwrap().submissions, 1);
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_import_runs_once() {
        let mut c = mem();
        let export: LegacyExport = serde_json::from_str(
            r#"{"drafts":[{"questionId":"q","assignmentId":null,"language":"PYTHON","content":"x","synced":false}],
                "events":[{"id":"e1"}],"snapshots":[],"submissions":[{"clientOperationId":"s1"}]}"#,
        ).unwrap();
        assert_eq!(import_legacy(&mut c, &export).unwrap(), (1, 2));
        assert_eq!(import_legacy(&mut c, &export).unwrap(), (0, 0));
        assert_eq!(counts(&c).unwrap().submissions, 1);
    }
}
