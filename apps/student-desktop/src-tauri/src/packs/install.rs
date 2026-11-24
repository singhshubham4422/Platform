use super::{PackInfo, PackManager, read};
use crate::store::{self, PackRow, Store};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub async fn packs_install_from_url(
    store: &Store,
    manager: &PackManager,
    url: &str,
    sig_url: &str,
    expected: &str,
) -> Result<PackInfo, String> {
    if !safe_url(url) || !safe_url(sig_url) {
        return Err("NETWORK: HTTPS required".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("NETWORK: {e}"))?;
    let bytes = fetch(&client, url).await?;
    let sig = fetch(&client, sig_url).await?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("UNSAFE_ARCHIVE: pack too large".into());
    }
    install_bytes(
        store,
        manager,
        &bytes,
        &String::from_utf8_lossy(&sig),
        Some(expected),
    )
}
pub fn packs_import_file(
    store: &Store,
    manager: &PackManager,
    path: &str,
) -> Result<PackInfo, String> {
    let source = Path::new(path);
    if source.extension().and_then(|x| x.to_str()) != Some("lpack") {
        return Err("IO: expected .lpack".into());
    }
    let sig = PathBuf::from(format!("{path}.sig"));
    let b = fs::read(source).map_err(|e| format!("IO: {e}"))?;
    let s = fs::read_to_string(sig).map_err(|e| format!("SIGNATURE_INVALID: {e}"))?;
    install_bytes(store, manager, &b, &s, None)
}
async fn fetch(c: &reqwest::Client, u: &str) -> Result<Vec<u8>, String> {
    let r = c.get(u).send().await.map_err(|e| format!("NETWORK: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("NETWORK: HTTP {}", r.status()));
    }
    if r.content_length().is_some_and(|n| n > 200 * 1024 * 1024) {
        return Err("UNSAFE_ARCHIVE: pack too large".into());
    }
    let b = r.bytes().await.map_err(|e| format!("NETWORK: {e}"))?;
    if b.len() > 200 * 1024 * 1024 {
        return Err("UNSAFE_ARCHIVE: pack too large".into());
    }
    Ok(b.to_vec())
}
fn safe_url(s: &str) -> bool {
    s.starts_with("https://")
        || cfg!(debug_assertions)
            && (s.starts_with("http://127.0.0.1") || s.starts_with("http://localhost"))
}
fn install_bytes(
    store: &Store,
    mgr: &PackManager,
    bytes: &[u8],
    sig: &str,
    expected: Option<&str>,
) -> Result<PackInfo, String> {
    let _lock = mgr
        .busy
        .lock()
        .map_err(|_| "IO: pack lock poisoned".to_string())?;
    fs::create_dir_all(mgr.root.join("packs/.partial")).map_err(|e| format!("IO: {e}"))?;
    let tmp = mgr
        .root
        .join("packs/.partial")
        .join(format!("{}.lpack", uuid::Uuid::new_v4()));
    let sigpath = PathBuf::from(format!("{}.sig", tmp.display()));
    fs::write(&tmp, bytes).map_err(|e| format!("IO: {e}"))?;
    fs::write(&sigpath, sig).map_err(|e| format!("IO: {e}"))?;
    let parsed = read::read_verified(&tmp, &sigpath, expected);
    let _ = fs::remove_file(&tmp);
    let _ = fs::remove_file(&sigpath);
    let data = parsed?;
    let m = &data.manifest;
    let pack_id = m["packId"].as_str().ok_or("INVALID_MANIFEST")?.to_owned();
    let version = m["version"].as_i64().ok_or("INVALID_MANIFEST")?;
    let kind = m["kind"].as_str().unwrap().to_owned();
    let course = m["courseId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_owned();
    let assessment = m["assessmentId"].as_str().map(str::to_owned);
    let title = m["title"].as_str().unwrap_or("Untitled pack").to_owned();
    let key = if kind == "ASSESSMENT" {
        assessment.as_deref().unwrap_or("")
    } else {
        &course
    };
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("INVALID_MANIFEST".into());
    }
    {
        let c = store
            .0
            .lock()
            .map_err(|_| "IO: local database lock poisoned".to_string())?;
        if let Some(row) = store::packs_get(&c, &pack_id).map_err(|e| format!("IO: {e}"))? {
            return super::info(row);
        }
    }
    let destdir = mgr.root.join("packs").join(key);
    fs::create_dir_all(&destdir).map_err(|e| format!("IO: {e}"))?;
    let dest = destdir.join(format!("{version}.lpack"));
    let sigdest = PathBuf::from(format!("{}.sig", dest.display()));
    let part = destdir.join(format!("{version}.tmp-{}.lpack", uuid::Uuid::new_v4()));
    let ps = PathBuf::from(format!("{}.sig", part.display()));
    fs::write(&part, bytes).map_err(|e| format!("IO: {e}"))?;
    fs::write(&ps, sig).map_err(|e| format!("IO: {e}"))?;
    fs::rename(&part, &dest).map_err(|e| format!("IO: {e}"))?;
    fs::rename(&ps, &sigdest).map_err(|e| format!("IO: {e}"))?;
    let hash = Sha256::digest(bytes)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect();
    let row = PackRow {
        pack_id: pack_id.clone(),
        kind,
        course_id: course.clone(),
        assessment_id: assessment,
        version,
        title,
        path: dest.to_string_lossy().into_owned(),
        sha256: hash,
        manifest_json: serde_json::to_string(m).map_err(|e| format!("IO: {e}"))?,
        installed_at: chrono_lite_now(),
    };
    let mut old = Vec::new();
    {
        let c = store
            .0
            .lock()
            .map_err(|_| "IO: local database lock poisoned".to_string())?;
        if row.kind == "COURSE" {
            old = store::packs_list(&c)
                .map_err(|e| format!("IO: {e}"))?
                .into_iter()
                .filter(|p| p.course_id == row.course_id && p.pack_id != row.pack_id)
                .collect()
        }
        store::packs_put(&c, &row).map_err(|e| format!("IO: {e}"))?;
    }
    for p in old {
        let _ = fs::remove_file(&p.path);
        let _ = fs::remove_file(format!("{}.sig", p.path));
        let c = store
            .0
            .lock()
            .map_err(|_| "IO: local database lock poisoned".to_string())?;
        let _ = store::packs_remove(&c, &p.pack_id);
    }
    super::info(row)
}
fn chrono_lite_now() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = (n.as_secs() / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    let sec = n.as_secs() % 86400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        sec / 3600,
        sec / 60 % 60,
        sec % 60,
        n.subsec_millis()
    )
}
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}
