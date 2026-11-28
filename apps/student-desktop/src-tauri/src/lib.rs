mod activity;
mod assessment;
mod attempts;
mod device;
mod packs;
mod runner;
pub mod runtimes;
mod secrets;
mod store;

use std::sync::Mutex;
use store::Store;
use tauri::{Manager, State};

type CmdResult<T> = Result<T, String>;

fn with_conn<T>(
    state: &State<Store>,
    f: impl FnOnce(&mut rusqlite::Connection) -> rusqlite::Result<T>,
) -> CmdResult<T> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "local database lock poisoned".to_string())?;
    f(&mut guard).map_err(|e| format!("local database error: {e}"))
}

#[tauri::command]
fn store_save_draft(
    state: State<Store>,
    question_id: String,
    assignment_id: Option<String>,
    language: String,
    content: String,
) -> CmdResult<store::Draft> {
    with_conn(&state, |c| {
        store::save_draft(
            c,
            &question_id,
            assignment_id.as_deref(),
            &language,
            &content,
        )
    })
}
#[tauri::command]
fn store_get_draft(
    state: State<Store>,
    question_id: String,
    assignment_id: Option<String>,
    language: String,
) -> CmdResult<Option<store::Draft>> {
    with_conn(&state, |c| {
        store::get_draft(c, &question_id, assignment_id.as_deref(), &language)
    })
}
#[tauri::command]
fn store_list_drafts(state: State<Store>) -> CmdResult<Vec<store::Draft>> {
    with_conn(&state, |c| store::list_drafts(c))
}
#[tauri::command]
fn store_mark_draft_synced(
    state: State<Store>,
    question_id: String,
    assignment_id: Option<String>,
    language: String,
    revision: i64,
) -> CmdResult<usize> {
    with_conn(&state, |c| {
        store::mark_draft_synced(
            c,
            &question_id,
            assignment_id.as_deref(),
            &language,
            revision,
        )
    })
}
#[tauri::command]
fn store_enqueue(
    state: State<Store>,
    operation_id: String,
    operation_type: String,
    entity_id: Option<String>,
    payload_json: String,
) -> CmdResult<bool> {
    with_conn(&state, |c| {
        store::enqueue(
            c,
            &operation_id,
            &operation_type,
            entity_id.as_deref(),
            &payload_json,
        )
    })
}
#[tauri::command]
fn store_due(
    state: State<Store>,
    operation_type: String,
    limit: i64,
) -> CmdResult<Vec<store::OutboxItem>> {
    with_conn(&state, |c| store::due(c, &operation_type, limit))
}
#[tauri::command]
fn store_ack(state: State<Store>, operation_ids: Vec<String>) -> CmdResult<usize> {
    with_conn(&state, |c| {
        let tx = c.transaction()?;
        let n = store::ack(&tx, &operation_ids)?;
        tx.commit()?;
        Ok(n)
    })
}
#[tauri::command]
fn store_fail(
    state: State<Store>,
    operation_id: String,
    error_code: String,
    permanent: bool,
    jitter_pct: i64,
) -> CmdResult<()> {
    with_conn(&state, |c| {
        store::fail(c, &operation_id, &error_code, permanent, jitter_pct)
    })
}
#[tauri::command]
fn store_counts(state: State<Store>) -> CmdResult<store::Counts> {
    with_conn(&state, |c| store::counts(c))
}
#[tauri::command]
fn store_list_failed(state: State<Store>) -> CmdResult<Vec<(String, String, String)>> {
    with_conn(&state, |c| store::list_failed(c))
}
#[tauri::command]
fn store_save_note(
    state: State<Store>,
    note_id: String,
    course_id: Option<String>,
    resource_id: Option<String>,
    body: String,
) -> CmdResult<()> {
    with_conn(&state, |c| {
        store::save_note(
            c,
            &note_id,
            course_id.as_deref(),
            resource_id.as_deref(),
            &body,
        )
    })
}
#[tauri::command]
fn store_list_notes(
    state: State<Store>,
    course_id: Option<String>,
) -> CmdResult<Vec<store::NoteRow>> {
    with_conn(&state, |c| store::list_notes(c, course_id.as_deref()))
}
#[tauri::command]
fn store_put_course(
    state: State<Store>,
    course_id: String,
    version: i64,
    manifest_json: String,
) -> CmdResult<()> {
    with_conn(&state, |c| {
        store::put_course(c, &course_id, version, &manifest_json)
    })
}
#[tauri::command]
fn store_list_courses(state: State<Store>) -> CmdResult<Vec<String>> {
    with_conn(&state, |c| store::list_courses(c))
}
#[tauri::command]
fn store_delete_course(state: State<Store>, course_id: String) -> CmdResult<usize> {
    with_conn(&state, |c| store::delete_course(c, &course_id))
}
#[tauri::command]
fn store_set_cursor(state: State<Store>, stream: String, value: String) -> CmdResult<()> {
    with_conn(&state, |c| store::set_cursor(c, &stream, &value))
}
#[tauri::command]
fn store_get_cursor(state: State<Store>, stream: String) -> CmdResult<Option<String>> {
    with_conn(&state, |c| store::get_cursor(c, &stream))
}
#[tauri::command]
fn store_import_legacy(
    state: State<Store>,
    export: store::LegacyExport,
) -> CmdResult<(usize, usize)> {
    with_conn(&state, |c| store::import_legacy(c, &export))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = store::open(&dir.join("platform.db"))
                .map_err(|e| format!("cannot open local database: {e}"))?;
            app.manage(Store(Mutex::new(conn)));
            let bundled = app
                .path()
                .resource_dir()
                .ok()
                .map(|d| d.join("runtimes"))
                .filter(|d| d.join("manifest.json").is_file());
            let manager = runtimes::RuntimeManager::new(dir.clone()).with_bundled(bundled.clone());
            if let Some(root) = bundled {
                warm_up_bundled(root, manager.cache_dir(), dir.join("runner"));
            }
            app.manage(manager);
            app.manage(packs::PackManager::new(dir.clone()));
            app.manage(secrets::Secrets(Box::new(secrets::KeyringSecrets)));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_auth_session,
            load_auth_session,
            delete_auth_session,
            store_save_draft,
            store_get_draft,
            store_list_drafts,
            store_mark_draft_synced,
            store_enqueue,
            store_due,
            store_ack,
            store_fail,
            store_counts,
            store_list_failed,
            store_save_note,
            store_list_notes,
            store_put_course,
            store_list_courses,
            store_delete_course,
            store_set_cursor,
            store_get_cursor,
            store_import_legacy,
            runtimes_list,
            runtimes_available,
            runtimes_install,
            runtimes_remove,
            run_custom,
            packs_install_from_url,
            packs_import_file,
            packs_list,
            packs_remove,
            packs_list_questions,
            packs_get_question,
            run_question,
            attempts_list,
            attempts_due,
            attempts_ack,
            attempts_park,
            activity_append,
            activity_seal_batch,
            activity_ack_batch,
            activity_counts,
            device_info,
            assessment_store_key,
            assessment_status
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[tauri::command]
fn runtimes_list(
    state: State<'_, Store>,
    manager: State<'_, runtimes::RuntimeManager>,
) -> CmdResult<Vec<runtimes::RuntimeInfo>> {
    runtimes::runtimes_list(&state, &manager)
}

/// Fill the bundled C/C++ compiler's cache in the background so the first student compile is fast.
fn warm_up_bundled(root: std::path::PathBuf, cache: std::path::PathBuf, work: std::path::PathBuf) {
    std::thread::spawn(move || {
        let _ = std::fs::create_dir_all(&work);
        for language in ["C", "CPP"] {
            if let Some(rt) = runtimes::bundled::resolve(&root, &cache, language)
                && let Err(e) = runner::warm_up(&rt, &work)
            {
                log::warn!("warm-up for {language} failed: {e}");
            }
        }
    });
}

#[tauri::command]
async fn runtimes_available(
    base_url: String,
    manager: State<'_, runtimes::RuntimeManager>,
) -> CmdResult<Vec<runtimes::IndexEntry>> {
    runtimes::runtimes_available(base_url, &manager).await
}

#[tauri::command]
async fn runtimes_install(
    app: tauri::AppHandle,
    state: State<'_, Store>,
    manager: State<'_, runtimes::RuntimeManager>,
    base_url: String,
    language: String,
) -> CmdResult<runtimes::RuntimeInfo> {
    runtimes::runtimes_install(app, &state, &manager, base_url, language).await
}

#[tauri::command]
fn runtimes_remove(
    state: State<'_, Store>,
    manager: State<'_, runtimes::RuntimeManager>,
    language: String,
    version: String,
) -> CmdResult<()> {
    runtimes::runtimes_remove(&state, &manager, &language, &version)
}

#[tauri::command]
fn run_custom(
    language: String,
    source: String,
    stdin: String,
    limits: runner::Limits,
    state: State<'_, Store>,
    manager: State<'_, runtimes::RuntimeManager>,
) -> CmdResult<runner::RunResult> {
    let language = language.to_ascii_uppercase();
    let rt = runtimes::resolve(&state, &manager, &language)?;
    let spec = runner::RunSpec {
        language,
        source,
        tests: vec![runner::TestCase {
            id: "custom".into(),
            input: stdin,
            expected_output: None,
            hidden: false,
        }],
        limits: runner::Limits {
            time_limit_ms: limits.time_limit_ms.clamp(100, 60_000),
            memory_limit_mb: limits.memory_limit_mb.clamp(16, 2048),
            output_limit_kb: limits.output_limit_kb.clamp(1, 1024),
        },
        mode: runner::Mode::Custom,
    };
    let root = manager.root.join("runner");
    std::fs::create_dir_all(&root).map_err(|e| format!("IO: {e}"))?;
    Ok(runner::run_tests(&spec, &rt, &root))
}

#[tauri::command]
async fn packs_install_from_url(
    url: String,
    sig_url: String,
    expected_sha256: String,
    state: State<'_, Store>,
    manager: State<'_, packs::PackManager>,
) -> CmdResult<packs::PackInfo> {
    packs::packs_install_from_url(&state, &manager, &url, &sig_url, &expected_sha256).await
}
#[tauri::command]
fn packs_import_file(
    path: String,
    state: State<'_, Store>,
    manager: State<'_, packs::PackManager>,
) -> CmdResult<packs::PackInfo> {
    packs::packs_import_file(&state, &manager, &path)
}
#[tauri::command]
fn packs_list(state: State<'_, Store>) -> CmdResult<Vec<packs::PackInfo>> {
    packs::packs_list(&state)
}
#[tauri::command]
fn packs_remove(
    pack_id: String,
    state: State<'_, Store>,
    manager: State<'_, packs::PackManager>,
) -> CmdResult<()> {
    packs::packs_remove(&state, &manager, &pack_id)
}
#[tauri::command]
fn packs_list_questions(
    pack_id: String,
    state: State<'_, Store>,
) -> CmdResult<Vec<packs::QuestionSummary>> {
    packs::packs_list_questions(&state, &pack_id)
}
#[tauri::command]
fn packs_get_question(
    pack_id: String,
    question_id: String,
    state: State<'_, Store>,
) -> CmdResult<packs::QuestionView> {
    packs::packs_get_question(&state, &pack_id, &question_id)
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn run_question(
    pack_id: String,
    question_id: String,
    language: String,
    source: String,
    mode: String,
    state: State<'_, Store>,
    pack_manager: State<'_, packs::PackManager>,
    runtime_manager: State<'_, runtimes::RuntimeManager>,
    secrets: State<'_, secrets::Secrets>,
) -> CmdResult<runner::RunResult> {
    packs::run_question(
        &state,
        &pack_manager,
        &runtime_manager,
        secrets.0.as_ref(),
        &pack_id,
        &question_id,
        &language,
        &source,
        &mode,
    )
}

// ---- Phase 05: attempts, activity, device (C6) ----

fn lock_store<'a>(
    state: &'a State<'_, Store>,
) -> CmdResult<std::sync::MutexGuard<'a, rusqlite::Connection>> {
    state
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())
}

#[tauri::command]
fn attempts_list(
    pack_id: Option<String>,
    question_id: Option<String>,
    state: State<'_, Store>,
) -> CmdResult<Vec<attempts::AttemptRow>> {
    let c = lock_store(&state)?;
    attempts::list(&c, pack_id.as_deref(), question_id.as_deref()).map_err(|e| format!("IO: {e}"))
}
#[tauri::command]
fn attempts_due(limit: i64, state: State<'_, Store>) -> CmdResult<Vec<attempts::AttemptRow>> {
    let c = lock_store(&state)?;
    attempts::due(&c, limit).map_err(|e| format!("IO: {e}"))
}
#[tauri::command]
fn attempts_ack(attempt_ids: Vec<String>, state: State<'_, Store>) -> CmdResult<usize> {
    let mut c = lock_store(&state)?;
    attempts::ack(&mut c, &attempt_ids).map_err(|e| format!("IO: {e}"))
}
#[tauri::command]
fn attempts_park(attempt_id: String, error: String, state: State<'_, Store>) -> CmdResult<usize> {
    let c = lock_store(&state)?;
    attempts::park(&c, &attempt_id, &error).map_err(|e| format!("IO: {e}"))
}
#[tauri::command]
fn activity_append(
    events: Vec<serde_json::Value>,
    state: State<'_, Store>,
    secrets: State<'_, secrets::Secrets>,
) -> CmdResult<usize> {
    let mut c = lock_store(&state)?;
    activity::append(&mut c, secrets.0.as_ref(), events)
}
#[tauri::command]
fn activity_seal_batch(
    max_events: Option<i64>,
    state: State<'_, Store>,
) -> CmdResult<Option<activity::SealedBatch>> {
    let mut c = lock_store(&state)?;
    activity::seal_batch(&mut c, max_events.unwrap_or(2000))
}
#[tauri::command]
fn activity_ack_batch(batch_id: String, state: State<'_, Store>) -> CmdResult<()> {
    let mut c = lock_store(&state)?;
    activity::ack_batch(&mut c, &batch_id)
}
#[tauri::command]
fn activity_counts(state: State<'_, Store>) -> CmdResult<activity::ActivityCounts> {
    let c = lock_store(&state)?;
    activity::counts(&c).map_err(|e| format!("IO: {e}"))
}
#[tauri::command]
fn device_info(
    state: State<'_, Store>,
    secrets: State<'_, secrets::Secrets>,
) -> CmdResult<device::DeviceInfo> {
    let c = lock_store(&state)?;
    device::ensure(&c, secrets.0.as_ref())
}

#[tauri::command]
fn assessment_store_key(
    assessment_id: String,
    key_id: String,
    key_b64: String,
    state: State<'_, Store>,
    secrets: State<'_, secrets::Secrets>,
) -> CmdResult<()> {
    let c = lock_store(&state)?;
    assessment::store_key(
        &c,
        secrets.0.as_ref(),
        &assessment_id,
        &key_id,
        &key_b64,
        assessment::now_ms(),
    )
}
#[tauri::command]
fn assessment_status(
    pack_id: String,
    state: State<'_, Store>,
    secrets: State<'_, secrets::Secrets>,
) -> CmdResult<assessment::AssessmentStatus> {
    let c = lock_store(&state)?;
    let row = store::packs_get(&c, &pack_id)
        .map_err(|e| format!("IO: {e}"))?
        .ok_or_else(|| format!("PACK_NOT_FOUND: {pack_id}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&row.manifest_json).map_err(|_| "INVALID_MANIFEST".to_string())?;
    let info = assessment::info(&manifest)?;
    let aid = row.assessment_id.ok_or("INVALID_MANIFEST: assessmentId")?;
    assessment::status(&c, secrets.0.as_ref(), &aid, &info)
}

#[cfg(target_os = "windows")]
const CREDENTIAL_SERVICE: &str = "com.platform.student";
#[cfg(target_os = "windows")]
const CREDENTIAL_USER: &str = "auth-session";

#[cfg(target_os = "windows")]
const CREDENTIAL_CHUNK_CHARS: usize = 900;

#[cfg(target_os = "windows")]
fn store_session_in_keyring(service: &str, user: &str, session: &str) -> Result<(), String> {
    // Windows Credential Manager caps CredentialBlobSize at 2560 bytes (1280 UTF-16 chars).
    // Split large Supabase session JSONs across numbered entries under the same service.
    delete_session_from_keyring(service, user)?;
    let chars: Vec<char> = session.chars().collect();
    if chars.len() <= CREDENTIAL_CHUNK_CHARS {
        let entry = keyring::Entry::new(service, user)
            .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
        return entry
            .set_password(session)
            .map_err(|error| format!("Could not store credentials securely: {error}"));
    }
    let chunks: Vec<String> = chars
        .chunks(CREDENTIAL_CHUNK_CHARS)
        .map(|c| c.iter().collect())
        .collect();
    for (idx, chunk) in chunks.iter().enumerate() {
        let entry = keyring::Entry::new(service, &format!("{user}:{idx}"))
            .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
        entry
            .set_password(chunk)
            .map_err(|error| format!("Could not store credentials securely: {error}"))?;
    }
    let header = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    header
        .set_password(&format!("chunks:{}", chunks.len()))
        .map_err(|error| format!("Could not store credentials securely: {error}"))
}

#[cfg(target_os = "windows")]
fn load_session_from_keyring(service: &str, user: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    let val = match entry.get_password() {
        Ok(session) => session,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("Could not read secure credentials: {error}")),
    };
    let Some(count_str) = val.strip_prefix("chunks:") else {
        return Ok(Some(val));
    };
    let count: usize = count_str
        .parse()
        .map_err(|_| "Corrupt secure credential header".to_string())?;
    let mut out = String::new();
    for idx in 0..count {
        let part = keyring::Entry::new(service, &format!("{user}:{idx}"))
            .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
        match part.get_password() {
            Ok(s) => out.push_str(&s),
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(error) => return Err(format!("Could not read secure credentials: {error}")),
        }
    }
    Ok(Some(out))
}

#[cfg(target_os = "windows")]
fn delete_session_from_keyring(service: &str, user: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    let existing = entry.get_password().ok();
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(format!("Could not remove secure credentials: {error}")),
    }
    if let Some(count) = existing
        .and_then(|v| v.strip_prefix("chunks:").map(str::to_owned))
        .and_then(|n| n.parse::<usize>().ok())
    {
        for idx in 0..count {
            if let Ok(part) = keyring::Entry::new(service, &format!("{user}:{idx}")) {
                let _ = part.delete_credential();
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn store_auth_session(session: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        store_session_in_keyring(CREDENTIAL_SERVICE, CREDENTIAL_USER, &session)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = session;
        Err("Secure credential storage is not configured for this platform".to_string())
    }
}

#[tauri::command]
fn load_auth_session() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        load_session_from_keyring(CREDENTIAL_SERVICE, CREDENTIAL_USER)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn delete_auth_session() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        delete_session_from_keyring(CREDENTIAL_SERVICE, CREDENTIAL_USER)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_windows_store_returns_explicit_error_and_windows_roundtrips_isolated_key() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(CREDENTIAL_SERVICE, "com.platform.student");
            assert_eq!(CREDENTIAL_USER, "auth-session");
            let test_service = "com.platform.student.unit-test";
            let test_user = "test-session-entry";
            let _ = delete_session_from_keyring(test_service, test_user);
            assert_eq!(
                load_session_from_keyring(test_service, test_user).unwrap(),
                None
            );
            store_session_in_keyring(test_service, test_user, "{\"ok\":true}").unwrap();
            assert_eq!(
                load_session_from_keyring(test_service, test_user).unwrap(),
                Some("{\"ok\":true}".to_string())
            );
            delete_session_from_keyring(test_service, test_user).unwrap();
            assert_eq!(
                load_session_from_keyring(test_service, test_user).unwrap(),
                None
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert!(store_auth_session("{}".to_string()).is_err());
            assert_eq!(load_auth_session().unwrap(), None);
            assert!(delete_auth_session().is_ok());
        }
    }
}
