use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs::{self, File},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use wait_timeout::ChildExt;
use zip::ZipArchive;

use super::{
    RuntimeInfo, RuntimeInstallProgress, RuntimeManager, delete_row, emit_progress, index, keys,
    rows_for_language, save_row, verify,
};
use crate::{
    runtimes::download,
    store::{RuntimeRow, Store},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntime {
    pub language: String,
    pub version: String,
    pub path: String,
    pub source_file: String,
    pub compile: Option<Vec<String>>,
    pub run: Vec<String>,
    /// Extra environment for compile and run (already expanded).
    #[serde(default)]
    pub env: Vec<(String, String)>,
}

pub async fn install(
    app: &tauri::AppHandle,
    store: &Store,
    manager: &RuntimeManager,
    base: &str,
    language: &str,
) -> Result<RuntimeInfo, String> {
    let pubkey = keys::release_public_key()?;
    install_with_key(store, manager.root.clone(), base, language, &pubkey, |p| {
        emit_progress(app, p)
    })
    .await
}

pub(super) async fn install_with_key<F>(
    store: &Store,
    app_data: PathBuf,
    base: &str,
    language: &str,
    pubkey: &str,
    mut notify: F,
) -> Result<RuntimeInfo, String>
where
    F: FnMut(RuntimeInstallProgress),
{
    let app_runtimes = app_data.join("runtimes");
    let doc = index::load_verified_with_key(base, &app_runtimes, pubkey).await?;
    let (os, arch) = index::current_platform()?;
    let mut entries = doc
        .packs
        .into_iter()
        .filter(|p| p.language == language && p.os == os && p.arch == arch)
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| version_cmp(&a.version, &b.version));
    let entry = entries
        .pop()
        .ok_or_else(|| format!("RUNTIME_NOT_INSTALLED: {language}"))?;
    if !safe_version(&entry.version) {
        return Err("UNSAFE_ARCHIVE: invalid runtime version".into());
    }
    let partial = app_runtimes
        .join(".partial")
        .join(format!("{language}-{}-{os}-{arch}.zip", entry.version));
    let url = format!("{}{}", base, entry.path);
    let calculated =
        download::download_with_progress(&url, &partial, language, entry.size, &mut notify).await?;
    let hex = calculated
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    notify(progress(
        language,
        "verify",
        entry.size,
        entry.size,
        "Verifying runtime",
    ));
    if hex != entry.sha256 {
        return Err("HASH_MISMATCH".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("NETWORK: {e}"))?;
    let signature = download::download_signature(&client, &format!("{url}.sig")).await?;
    verify::verify_archive(&partial, &signature, &entry, pubkey)?;
    let language_dir = app_runtimes.join(language);
    fs::create_dir_all(&language_dir).map_err(|e| format!("IO: {e}"))?;
    let temp = language_dir.join(format!("{}.tmp-{}", entry.version, uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp).map_err(|e| format!("IO: {e}"))?;
    let install_result = (|| {
        notify(progress(
            language,
            "extract",
            0,
            entry.size,
            "Extracting runtime",
        ));
        extract_zip(&partial, &temp, entry.size)?;
        if entry
            .license_files
            .iter()
            .any(|name| !safe_archive_path(name) || !temp.join(name).is_file())
        {
            return Err("UNSAFE_ARCHIVE: declared license file missing".into());
        }
        notify(progress(
            language,
            "smoke",
            entry.size,
            entry.size,
            "Checking runtime",
        ));
        smoke_test(&temp, &entry)?;
        let final_path = language_dir.join(&entry.version);
        let backup = language_dir.join(format!("{}.old-{}", entry.version, uuid::Uuid::new_v4()));
        if final_path.exists() {
            fs::rename(&final_path, &backup).map_err(|e| format!("IO: {e}"))?;
        }
        if let Err(e) = fs::rename(&temp, &final_path) {
            if backup.exists() {
                let _ = fs::rename(&backup, &final_path);
            }
            return Err(format!("IO: {e}"));
        }
        let templates = ResolvedRuntime {
            language: language.into(),
            version: entry.version.clone(),
            path: final_path.to_string_lossy().into_owned(),
            source_file: entry.source_file.clone(),
            compile: entry.compile.clone(),
            run: entry.run.clone(),
            env: Vec::new(),
        };
        if let Err(e) = fs::write(
            final_path.join(".platform-runtime.json"),
            serde_json::to_vec(&templates).map_err(|e| format!("IO: {e}"))?,
        ) {
            let _ = fs::remove_dir_all(&final_path);
            if backup.exists() {
                let _ = fs::rename(&backup, &final_path);
            }
            return Err(format!("IO: {e}"));
        }
        let row = RuntimeRow {
            language: language.into(),
            version: entry.version.clone(),
            path: final_path.to_string_lossy().into_owned(),
            sha256: entry.sha256.clone(),
            installed_at: utc_now(),
        };
        if let Err(e) = save_row(store, &row) {
            let _ = fs::remove_dir_all(&final_path);
            if backup.exists() {
                let _ = fs::rename(&backup, &final_path);
            }
            return Err(e);
        }
        if backup.exists() {
            let _ = fs::remove_dir_all(&backup);
        }
        keep_two(store, &language_dir, language, &entry.version)?;
        Ok(RuntimeInfo {
            language: language.into(),
            version: entry.version.clone(),
            path: final_path.to_string_lossy().into_owned(),
            installed_at: row.installed_at,
        })
    })();
    let _ = fs::remove_file(&partial);
    if install_result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    if install_result.is_ok() {
        notify(progress(
            language,
            "done",
            entry.size,
            entry.size,
            "Runtime installed",
        ));
    }
    install_result
}

fn progress(
    lang: &str,
    stage: &str,
    received: u64,
    total: u64,
    message: &str,
) -> RuntimeInstallProgress {
    RuntimeInstallProgress {
        language: lang.into(),
        stage: stage.into(),
        received_bytes: received,
        total_bytes: total,
        message: message.into(),
    }
}

pub(super) fn keep_two(
    store: &Store,
    language_dir: &Path,
    language: &str,
    current: &str,
) -> Result<(), String> {
    let mut rows = rows_for_language(store, language)?;
    rows.sort_by(|a, b| b.installed_at.cmp(&a.installed_at));
    for row in rows.into_iter().filter(|r| r.version != current).skip(1) {
        let path = PathBuf::from(&row.path);
        if safe_version(&row.version) && path == language_dir.join(&row.version) {
            let _ = fs::remove_dir_all(path);
            delete_row(store, language, &row.version)?;
        }
    }
    Ok(())
}

pub fn resolve(
    store: &Store,
    manager: &RuntimeManager,
    language: &str,
) -> Result<ResolvedRuntime, String> {
    let lang = language.to_ascii_uppercase();
    let mut rows = rows_for_language(store, &lang)?;
    rows.sort_by(|a, b| b.installed_at.cmp(&a.installed_at));
    let Some(row) = rows.first() else {
        return manager
            .bundled
            .as_deref()
            .and_then(|root| super::bundled::resolve(root, &manager.cache_dir(), &lang))
            .ok_or_else(|| format!("RUNTIME_NOT_INSTALLED: {lang}"));
    };
    let path = PathBuf::from(&row.path);
    if !safe_version(&row.version)
        || path != manager.root.join("runtimes").join(&lang).join(&row.version)
    {
        return Err("IO: runtime path outside app data".into());
    }
    serde_json::from_slice(
        &fs::read(path.join(".platform-runtime.json")).map_err(|e| format!("IO: {e}"))?,
    )
    .map_err(|e| format!("IO: invalid runtime metadata: {e}"))
}

pub fn extract_zip(archive_path: &Path, dest: &Path, archive_size: u64) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("IO: {e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|_| "UNSAFE_ARCHIVE".to_string())?;
    if zip.len() > 10_000 {
        return Err("UNSAFE_ARCHIVE".into());
    }
    let max_total = (archive_size.saturating_mul(4)).min(2 * 1024 * 1024 * 1024);
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| "UNSAFE_ARCHIVE".to_string())?;
        let name = entry.name().replace('\\', "/");
        if !safe_archive_path(&name) || entry.size() > 1024 * 1024 * 1024 {
            return Err("UNSAFE_ARCHIVE".into());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("UNSAFE_ARCHIVE".into());
        }
        total = total.checked_add(entry.size()).ok_or("UNSAFE_ARCHIVE")?;
        if total > max_total {
            return Err("UNSAFE_ARCHIVE".into());
        }
        let out = dest.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("IO: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
        }
        let mut target = File::create(&out).map_err(|e| format!("IO: {e}"))?;
        let copied = std::io::copy(&mut entry, &mut target).map_err(|e| format!("IO: {e}"))?;
        if copied != entry.size() {
            return Err("UNSAFE_ARCHIVE".into());
        }
        #[cfg(unix)]
        if name.starts_with("bin/") {
            let mut perms = fs::metadata(&out)
                .map_err(|e| format!("IO: {e}"))?
                .permissions();
            perms.set_mode(perms.mode() | 0o111);
            fs::set_permissions(&out, perms).map_err(|e| format!("IO: {e}"))?;
        }
    }
    Ok(())
}

fn safe_archive_path(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 200
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.contains('\\')
        || name.as_bytes().get(1) == Some(&b':')
    {
        return false;
    }
    let path = Path::new(name);
    !path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) && path.components().all(|c| !matches!(c, Component::CurDir))
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

fn expand(
    arg: &str,
    runtime: &Path,
    src: &Path,
    out: &Path,
    exe: &Path,
    main: &str,
    mem_mb: u64,
) -> String {
    arg.replace("{runtime}", &runtime.to_string_lossy())
        .replace("{src}", &src.to_string_lossy())
        .replace("{out}", &out.to_string_lossy())
        .replace("{exe}", &exe.to_string_lossy())
        .replace("{main}", main)
        .replace("{memMb}", &mem_mb.to_string())
}
fn java_main(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at..].starts_with(b"public") {
            let mut p = at + 6;
            while p < bytes.len() && bytes[p].is_ascii_whitespace() {
                p += 1;
            }
            if bytes[p..].starts_with(b"final") {
                p += 5;
                while p < bytes.len() && bytes[p].is_ascii_whitespace() {
                    p += 1;
                }
            }
            if bytes[p..].starts_with(b"class") {
                p += 5;
                while p < bytes.len() && bytes[p].is_ascii_whitespace() {
                    p += 1;
                }
                let start = p;
                while p < bytes.len()
                    && (bytes[p].is_ascii_alphanumeric() || bytes[p] == b'_' || bytes[p] == b'$')
                {
                    p += 1;
                }
                if p > start {
                    return source[start..p].to_owned();
                }
            }
        }
        at += 1;
    }
    "Main".into()
}
fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let left = a.split(['.', '-', '+']).collect::<Vec<_>>();
    let right = b.split(['.', '-', '+']).collect::<Vec<_>>();
    for (x, y) in left.iter().zip(right.iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(x), Ok(y)) => x.cmp(&y),
            _ => x.cmp(y),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    left.len().cmp(&right.len())
}
fn outputs_match(actual: &str, expected: &str) -> bool {
    fn norm(s: &str) -> String {
        s.replace("\r\n", "\n")
            .replace('\r', "\n")
            .split('\n')
            .map(|l| l.trim_end_matches([' ', '\t']))
            .collect::<Vec<_>>()
            .join("\n")
            .trim_end_matches('\n')
            .to_owned()
    }
    norm(actual) == norm(expected)
}

pub(super) fn smoke_test(runtime: &Path, entry: &super::IndexEntry) -> Result<(), String> {
    // TODO(offline-integration): switch smoke test to runner::run_tests
    let smoke = runtime.join(format!(".smoke-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&smoke).map_err(|e| format!("IO: {e}"))?;
    let main = java_main(&entry.smoke_test.source);
    let source_name = entry.source_file.replace("{main}", &main);
    if !safe_archive_path(&source_name) {
        let _ = fs::remove_dir_all(&smoke);
        return Err("SMOKE_TEST_FAILED".into());
    }
    let source = smoke.join(&source_name);
    if let Some(parent) = source.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
    }
    fs::write(&source, &entry.smoke_test.source).map_err(|e| format!("IO: {e}"))?;
    let out = smoke.join("out");
    fs::create_dir_all(&out).map_err(|e| format!("IO: {e}"))?;
    let mut exe = smoke.join("program");
    if cfg!(windows) {
        exe.set_extension("exe");
    }
    if let Some(compile) = &entry.compile {
        run_command(compile, runtime, &smoke, &source, &out, &exe, &main)
            .map_err(|_| "SMOKE_TEST_FAILED".to_string())?;
    }
    let output = run_command(&entry.run, runtime, &smoke, &source, &out, &exe, &main)
        .map_err(|_| "SMOKE_TEST_FAILED".to_string())?;
    let _ = fs::remove_dir_all(&smoke);
    if !outputs_match(
        &String::from_utf8_lossy(&output.stdout),
        &entry.smoke_test.expected_output,
    ) {
        return Err("SMOKE_TEST_FAILED".into());
    }
    Ok(())
}
fn run_command(
    args: &[String],
    runtime: &Path,
    cwd: &Path,
    source: &Path,
    out: &Path,
    exe: &Path,
    main: &str,
) -> Result<std::process::Output, String> {
    let Some((program, rest)) = args.split_first() else {
        return Err("empty command".into());
    };
    let program = expand(program, runtime, source, out, exe, main, 256);
    let mut cmd = Command::new(program);
    cmd.args(
        rest.iter()
            .map(|x| expand(x, runtime, source, out, exe, main, 256)),
    )
    .current_dir(cwd)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if child
        .wait_timeout(Duration::from_secs(20))
        .map_err(|e| e.to_string())?
        .is_none()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("smoke command timed out".into());
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("smoke command exited with {}", output.status));
    }
    Ok(output)
}

fn utc_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sec = (millis / 1000) as i64;
    let ms = millis % 1000;
    let days = sec.div_euclid(86400);
    let sod = sec.rem_euclid(86400);
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    if m <= 2 {
        y += 1;
    }
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}
