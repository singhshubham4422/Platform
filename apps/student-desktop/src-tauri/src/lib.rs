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
            let conn = store::open(&dir.join("lplatform.db"))
                .map_err(|e| format!("cannot open local database: {e}"))?;
            app.manage(Store(Mutex::new(conn)));
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
            store_import_legacy
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(target_os = "windows")]
const CREDENTIAL_SERVICE: &str = "com.lplatform.student";
#[cfg(target_os = "windows")]
const CREDENTIAL_USER: &str = "auth-session";

#[cfg(target_os = "windows")]
fn store_session_in_keyring(service: &str, user: &str, session: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    entry
        .set_password(session)
        .map_err(|error| format!("Could not store credentials securely: {error}"))
}

#[cfg(target_os = "windows")]
fn load_session_from_keyring(service: &str, user: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    match entry.get_password() {
        Ok(session) => Ok(Some(session)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read secure credentials: {error}")),
    }
}

#[cfg(target_os = "windows")]
fn delete_session_from_keyring(service: &str, user: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service, user)
        .map_err(|error| format!("Windows Credential Manager unavailable: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove secure credentials: {error}")),
    }
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
            assert_eq!(CREDENTIAL_SERVICE, "com.lplatform.student");
            assert_eq!(CREDENTIAL_USER, "auth-session");
            let test_service = "com.lplatform.student.unit-test";
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
