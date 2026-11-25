use super::{PackInfo, PackManager, QuestionSummary, QuestionView, VisibleTest, read};
use crate::{
    assessment, attempts,
    runner::{self, Mode, RunResult, RunSpec, TestCase},
    runtimes::{self, RuntimeManager},
    secrets::SecretStore,
    store::{self, Store},
};
use std::{fs, path::PathBuf};
fn verified(store: &Store, id: &str) -> Result<(store::PackRow, read::PackData), String> {
    let row = super::row(store, id)?;
    let p = PathBuf::from(&row.path);
    let data = read::read_verified(
        &p,
        &PathBuf::from(format!("{}.sig", row.path)),
        Some(&row.sha256),
    )?;
    Ok((row, data))
}
pub fn packs_list(store: &Store) -> Result<Vec<PackInfo>, String> {
    let c = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::packs_list(&c)
        .map_err(|e| format!("IO: {e}"))?
        .into_iter()
        .map(super::info)
        .collect()
}
pub fn packs_remove(store: &Store, mgr: &PackManager, id: &str) -> Result<(), String> {
    let row = super::row(store, id)?;
    let p = PathBuf::from(&row.path);
    let root = mgr.root.join("packs");
    if !p.starts_with(&root) {
        return Err("IO: pack path outside app data".into());
    }
    fs::remove_file(&p).map_err(|e| format!("IO: {e}"))?;
    let _ = fs::remove_file(format!("{}.sig", p.display()));
    let c = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())?;
    store::packs_remove(&c, id).map_err(|e| format!("IO: {e}"))?;
    Ok(())
}
pub fn packs_list_questions(store: &Store, id: &str) -> Result<Vec<QuestionSummary>, String> {
    let (_, d) = verified(store, id)?;
    let mut q = d.manifest["questions"]
        .as_array()
        .ok_or("INVALID_MANIFEST")?
        .iter()
        .map(summary)
        .collect::<Result<Vec<_>, _>>()?;
    q.sort_by_key(|x| x.order);
    Ok(q)
}
fn summary(q: &serde_json::Value) -> Result<QuestionSummary, String> {
    Ok(QuestionSummary {
        id: q["id"].as_str().ok_or("INVALID_MANIFEST")?.into(),
        title: q["title"].as_str().unwrap_or("").into(),
        topics: q["topics"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect(),
        difficulty: q["difficulty"].as_str().unwrap_or("EASY").into(),
        points: q["points"].as_i64().unwrap_or(0),
        order: q["order"].as_i64().unwrap_or(0),
    })
}
pub fn packs_get_question(store: &Store, id: &str, qid: &str) -> Result<QuestionView, String> {
    let (_, d) = verified(store, id)?;
    let qmeta = d.manifest["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|q| q["id"] == qid)
        .ok_or_else(|| format!("QUESTION_NOT_FOUND: {qid}"))?;
    let q: serde_json::Value = serde_json::from_slice(
        d.files
            .get(qmeta["path"].as_str().ok_or("INVALID_MANIFEST")?)
            .ok_or("UNSAFE_ARCHIVE")?,
    )
    .map_err(|_| "INVALID_MANIFEST")?;
    let tests = q["visibleTests"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| VisibleTest {
            id: t["id"].as_str().unwrap_or("").into(),
            input: t["input"].as_str().unwrap_or("").into(),
            expected_output: t["expectedOutput"].as_str().unwrap_or("").into(),
        })
        .collect();
    Ok(QuestionView {
        summary: summary(qmeta)?,
        statement_md: q["statementMd"].as_str().unwrap_or("").into(),
        limits: runner::Limits {
            time_limit_ms: q["timeLimitMs"].as_u64().unwrap_or(2000),
            memory_limit_mb: q["memoryLimitMb"].as_u64().unwrap_or(256),
            output_limit_kb: q["outputLimitKb"].as_u64().unwrap_or(64),
        },
        starter_code: q["starterCode"].clone(),
        visible_tests: tests,
    })
}
#[allow(clippy::too_many_arguments)]
pub fn run_question(
    store: &Store,
    pack_mgr: &PackManager,
    rt_mgr: &RuntimeManager,
    secrets: &dyn SecretStore,
    id: &str,
    qid: &str,
    language: &str,
    source: &str,
    mode: &str,
) -> Result<RunResult, String> {
    let mode = match mode {
        "RUN" => Mode::Run,
        "SUBMIT" => Mode::Submit,
        _ => return Err("IO: invalid mode".into()),
    };
    let (row, d) = verified(store, id)?;
    let m = &d.manifest;
    // Phase 10: assessment packs need the key (fetched online at Start), an open local window,
    // remaining time and, for SUBMIT, remaining attempts. The server re-checks all of it.
    let assessment = if row.kind == "ASSESSMENT" {
        let info = assessment::info(m)?;
        let aid = row
            .assessment_id
            .clone()
            .ok_or("INVALID_MANIFEST: assessmentId")?;
        let c = store
            .0
            .lock()
            .map_err(|_| "IO: local database lock poisoned".to_string())?;
        assessment::check_can_run(&c, secrets, &aid, &info, assessment::now_ms())?;
        if mode == Mode::Submit {
            assessment::check_attempts(&c, &aid, qid, &info)?;
        }
        Some((aid, info))
    } else {
        None
    };
    let langs = m["languages"].as_array().ok_or("INVALID_MANIFEST")?;
    if !langs.iter().any(|l| l.as_str() == Some(language)) {
        return Err("IO: language not offered".into());
    }
    let qmeta = m["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|q| q["id"] == qid)
        .ok_or_else(|| format!("QUESTION_NOT_FOUND: {qid}"))?;
    let q: serde_json::Value = serde_json::from_slice(
        d.files
            .get(qmeta["path"].as_str().ok_or("INVALID_MANIFEST")?)
            .ok_or("UNSAFE_ARCHIVE")?,
    )
    .map_err(|_| "INVALID_MANIFEST")?;
    let mut tests = q["visibleTests"]
        .as_array()
        .ok_or("INVALID_MANIFEST")?
        .iter()
        .map(test_case)
        .collect::<Result<Vec<_>, _>>()?;
    if mode == Mode::Submit {
        let hpath = qmeta["hiddenTestsPath"]
            .as_str()
            .ok_or("INVALID_MANIFEST")?;
        let bytes = d.files.get(hpath).ok_or("UNSAFE_ARCHIVE")?;
        match (&assessment, hpath.ends_with(".hidden.enc")) {
            (Some((aid, info)), true) => {
                tests.extend(assessment::hidden_tests(bytes, secrets, aid, info)?);
            }
            (None, false) if hpath.ends_with(".hidden.json") => {
                let hidden: serde_json::Value =
                    serde_json::from_slice(bytes).map_err(|_| "INVALID_MANIFEST")?;
                for t in hidden["tests"].as_array().into_iter().flatten() {
                    let mut c = test_case(t)?;
                    c.hidden = true;
                    tests.push(c)
                }
            }
            // Assessment packs must be encrypted; practice packs must not be.
            _ => return Err("INVALID_MANIFEST: hidden tests".into()),
        }
    }
    let runtime = runtimes::resolve(store, rt_mgr, language)?;
    let spec = RunSpec {
        language: language.into(),
        source: source.into(),
        tests,
        limits: runner::Limits {
            time_limit_ms: q["timeLimitMs"].as_u64().unwrap_or(2000),
            memory_limit_mb: q["memoryLimitMb"].as_u64().unwrap_or(256),
            output_limit_kb: q["outputLimitKb"].as_u64().unwrap_or(64),
        },
        mode,
    };
    let root = pack_mgr.root.join("runner");
    fs::create_dir_all(&root).map_err(|e| format!("IO: {e}"))?;
    let result = runner::run_tests(&spec, &runtime, &root);
    persist(store, secrets, &row, qid, language, source, &result)?;
    Ok(result)
}

/// Phase 05: every RUN/SUBMIT is stored and signed. A SUBMIT that cannot be stored is an error
/// (the student must not believe it was saved); a RUN storage failure is only logged.
fn persist(
    store: &Store,
    secrets: &dyn SecretStore,
    row: &store::PackRow,
    qid: &str,
    language: &str,
    source: &str,
    result: &RunResult,
) -> Result<(), String> {
    let ctx = attempts::AttemptContext {
        pack_id: &row.pack_id,
        question_id: qid,
        assessment_id: row.assessment_id.as_deref(),
        language,
        source,
    };
    let outcome = store
        .0
        .lock()
        .map_err(|_| "IO: local database lock poisoned".to_string())
        .and_then(|mut c| attempts::record(&mut c, secrets, &ctx, result));
    match outcome {
        Ok(_) => Ok(()),
        Err(e) if result.mode == Mode::Run => {
            log::warn!("could not store run attempt: {e}");
            Ok(())
        }
        Err(e) => Err(e),
    }
}
fn test_case(t: &serde_json::Value) -> Result<TestCase, String> {
    Ok(TestCase {
        id: t["id"].as_str().ok_or("INVALID_MANIFEST")?.into(),
        input: t["input"].as_str().unwrap_or("").into(),
        expected_output: Some(
            t["expectedOutput"]
                .as_str()
                .ok_or("INVALID_MANIFEST")?
                .into(),
        ),
        hidden: false,
    })
}
