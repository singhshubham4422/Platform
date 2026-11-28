pub mod bundled;
mod download;
mod index;
mod install;
mod keys;
mod verify;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use tauri::Emitter;

use crate::store::{self, RuntimeRow, Store};

pub use index::{IndexEntry, LangIndex};
pub use install::ResolvedRuntime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub language: String,
    pub version: String,
    pub path: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstallProgress {
    pub language: String,
    pub stage: String,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

pub struct RuntimeManager {
    pub root: PathBuf,
    /// Read-only folder of runtimes shipped with the installer (see `bundled`).
    pub bundled: Option<PathBuf>,
    installing: Mutex<HashSet<String>>,
}

impl RuntimeManager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            bundled: None,
            installing: Mutex::new(HashSet::new()),
        }
    }
    pub fn with_bundled(mut self, bundled: Option<PathBuf>) -> Self {
        self.bundled = bundled;
        self
    }
    /// Writable cache folder for bundled toolchains.
    pub fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }
    fn acquire(&self, language: &str) -> Result<(), String> {
        let mut guard = self
            .installing
            .lock()
            .map_err(|_| "IO: install lock poisoned".to_string())?;
        if !guard.insert(language.to_owned()) {
            return Err("IO: install already running".into());
        }
        Ok(())
    }
    fn release(&self, language: &str) {
        if let Ok(mut guard) = self.installing.lock() {
            guard.remove(language);
        }
    }
}

pub fn runtimes_list(store: &Store, manager: &RuntimeManager) -> Result<Vec<RuntimeInfo>, String> {
    let conn = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    let mut list: Vec<RuntimeInfo> = store::runtimes_list(&conn)
        .map_err(|e| format!("IO: {e}"))?
        .into_iter()
        .map(|r| RuntimeInfo {
            language: r.language,
            version: r.version,
            path: r.path,
            installed_at: r.installed_at,
        })
        .collect();
    if let Some(root) = &manager.bundled {
        for b in bundled::list(root) {
            if !list.iter().any(|r| r.language == b.language) {
                list.push(b);
            }
        }
    }
    Ok(list)
}

pub async fn runtimes_available(
    base_url: String,
    manager: &RuntimeManager,
) -> Result<Vec<IndexEntry>, String> {
    let index = index::load_verified(&base_url, &manager.root.join("runtimes")).await?;
    let (os, arch) = index::current_platform()?;
    Ok(index
        .packs
        .into_iter()
        .filter(|p| p.os == os && p.arch == arch)
        .collect())
}

pub async fn runtimes_install(
    app: tauri::AppHandle,
    store: &Store,
    manager: &RuntimeManager,
    base_url: String,
    language: String,
) -> Result<RuntimeInfo, String> {
    let language = language.to_ascii_uppercase();
    if !index::is_language(&language) {
        return Err(format!("NETWORK: unsupported language {language}"));
    }
    manager.acquire(&language)?;
    let result = install::install(&app, store, manager, &base_url, &language).await;
    manager.release(&language);
    if result.is_err() {
        emit_progress(
            &app,
            RuntimeInstallProgress {
                language: language.clone(),
                stage: "error".into(),
                received_bytes: 0,
                total_bytes: 0,
                message: "Runtime installation failed".into(),
            },
        );
    }
    result
}

pub fn runtimes_remove(
    store: &Store,
    manager: &RuntimeManager,
    language: &str,
    version: &str,
) -> Result<(), String> {
    let language = language.to_ascii_uppercase();
    if !index::is_language(&language) {
        return Err(format!("RUNTIME_NOT_INSTALLED: {language}"));
    }
    let conn = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    let row = store::runtimes_get(&conn, &language, version)
        .map_err(|e| format!("IO: {e}"))?
        .ok_or_else(|| format!("RUNTIME_NOT_INSTALLED: {language}"))?;
    let path = PathBuf::from(&row.path);
    if !safe_version(version) || path != manager.root.join("runtimes").join(&language).join(version)
    {
        return Err("IO: runtime path outside app data".into());
    }
    std::fs::remove_dir_all(path).map_err(|e| format!("IO: {e}"))?;
    store::runtimes_remove(&conn, &language, version).map_err(|e| format!("IO: {e}"))?;
    Ok(())
}

pub fn resolve(
    store: &Store,
    manager: &RuntimeManager,
    language: &str,
) -> Result<ResolvedRuntime, String> {
    install::resolve(store, manager, language)
}

fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
}

pub(crate) fn emit_progress(app: &tauri::AppHandle, p: RuntimeInstallProgress) {
    let _ = app.emit("runtime-install-progress", p);
}

pub(crate) fn save_row(store: &Store, row: &RuntimeRow) -> Result<(), String> {
    let conn = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::runtimes_put(&conn, row).map_err(|e| format!("IO: {e}"))
}

pub(crate) fn delete_row(store: &Store, language: &str, version: &str) -> Result<(), String> {
    let conn = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::runtimes_remove(&conn, language, version).map_err(|e| format!("IO: {e}"))?;
    Ok(())
}

pub(crate) fn rows_for_language(store: &Store, language: &str) -> Result<Vec<RuntimeRow>, String> {
    let conn = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::runtimes_list(&conn)
        .map(|rows| {
            rows.into_iter()
                .filter(|r| r.language == language)
                .collect()
        })
        .map_err(|e| format!("IO: {e}"))
}
