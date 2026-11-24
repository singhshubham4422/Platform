mod install;
mod question;
mod read;
#[cfg(test)]
mod tests;
pub use install::{packs_import_file, packs_install_from_url};
pub use question::{
    packs_get_question, packs_list, packs_list_questions, packs_remove, run_question,
};

use crate::store::{self, PackRow, Store};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub pack_id: String,
    pub kind: String,
    pub course_id: String,
    pub assessment_id: Option<String>,
    pub version: i64,
    pub title: String,
    pub languages: Vec<String>,
    pub question_count: usize,
    pub installed_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSummary {
    pub id: String,
    pub title: String,
    pub topics: Vec<String>,
    pub difficulty: String,
    pub points: i64,
    pub order: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionView {
    #[serde(flatten)]
    pub summary: QuestionSummary,
    pub statement_md: String,
    pub limits: crate::runner::Limits,
    pub starter_code: serde_json::Value,
    pub visible_tests: Vec<VisibleTest>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTest {
    pub id: String,
    pub input: String,
    pub expected_output: String,
}
pub struct PackManager {
    pub root: PathBuf,
    pub busy: Mutex<()>,
}
impl PackManager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            busy: Mutex::new(()),
        }
    }
}
pub(crate) fn info(row: PackRow) -> Result<PackInfo, String> {
    let m: serde_json::Value =
        serde_json::from_str(&row.manifest_json).map_err(|_| "INVALID_MANIFEST".to_string())?;
    Ok(PackInfo {
        pack_id: row.pack_id,
        kind: row.kind,
        course_id: row.course_id,
        assessment_id: row.assessment_id,
        version: row.version,
        title: row.title,
        languages: m["languages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect(),
        question_count: m["questions"].as_array().map_or(0, Vec::len),
        installed_at: row.installed_at,
    })
}
pub(crate) fn row(store: &Store, id: &str) -> Result<PackRow, String> {
    let c = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::packs_get(&c, id)
        .map_err(|e| format!("IO: {e}"))?
        .ok_or_else(|| format!("PACK_NOT_FOUND: {id}"))
}
