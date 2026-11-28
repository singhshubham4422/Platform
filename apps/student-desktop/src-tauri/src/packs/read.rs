use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path},
};
use zip::ZipArchive;

pub struct PackData {
    pub manifest: serde_json::Value,
    pub files: HashMap<String, Vec<u8>>,
}
pub fn pack_key() -> Result<String, String> {
    if let Some(k) = option_env!("PLATFORM_PACK_PUBKEY").filter(|s| !s.trim().is_empty()) {
        return Ok(k.trim().into());
    }
    #[cfg(debug_assertions)]
    {
        let mut p = Path::new(env!("CARGO_MANIFEST_DIR"));
        while let Some(parent) = p.parent() {
            let f = parent.join(".local/keys/pack.pub");
            if let Ok(s) = fs::read_to_string(f) {
                return Ok(s.trim().into());
            }
            p = parent;
        }
    }
    Err("PACK_KEY_NOT_CONFIGURED: pack".into())
}
fn verify_sig(data: &[u8], sig: &str, key: &str) -> bool {
    let (Ok(pk), Ok(sb)) = (STANDARD.decode(key.trim()), STANDARD.decode(sig.trim())) else {
        return false;
    };
    let (Ok(pk), Ok(sig)) = (
        <[u8; 32]>::try_from(pk.as_slice()),
        Signature::from_slice(&sb),
    ) else {
        return false;
    };
    let Ok(k) = VerifyingKey::from_bytes(&pk) else {
        return false;
    };
    k.verify(data, &sig).is_ok()
}
pub fn safe_path(s: &str) -> bool {
    if s.is_empty()
        || s.len() > 200
        || s.starts_with('/')
        || s.starts_with('\\')
        || s.contains('\\')
        || s.as_bytes().get(1) == Some(&b':')
    {
        return false;
    }
    let p = Path::new(s);
    p.components().all(|c| matches!(c, Component::Normal(_)))
        && p.components().count() == s.split('/').count()
}
pub fn read_verified(
    path: &Path,
    sig_path: &Path,
    expected: Option<&str>,
) -> Result<PackData, String> {
    let bytes = fs::read(path).map_err(|e| format!("IO: {e}"))?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("UNSAFE_ARCHIVE: pack too large".into());
    }
    let hash = hex(&Sha256::digest(&bytes));
    if expected.is_some_and(|v| v != hash) {
        return Err("HASH_MISMATCH".into());
    }
    let signature = fs::read_to_string(sig_path).map_err(|e| format!("SIGNATURE_INVALID: {e}"))?;
    if !verify_sig(&bytes, &signature, &pack_key()?) {
        return Err("SIGNATURE_INVALID".into());
    }
    let mut zip =
        ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "UNSAFE_ARCHIVE".to_string())?;
    if zip.len() > 5000 {
        return Err("UNSAFE_ARCHIVE: too many entries".into());
    }
    let mut files = HashMap::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "UNSAFE_ARCHIVE".to_string())?;
        let name = f.name().to_owned();
        if !safe_path(&name) || f.is_symlink() || f.size() > 50 * 1024 * 1024 {
            return Err("UNSAFE_ARCHIVE".into());
        }
        total = total.saturating_add(f.size());
        if total > 250 * 1024 * 1024 {
            return Err("UNSAFE_ARCHIVE: expanded pack too large".into());
        }
        let mut b = Vec::with_capacity(f.size() as usize);
        std::io::Read::read_to_end(&mut f, &mut b).map_err(|e| format!("IO: {e}"))?;
        if files.insert(name, b).is_some() {
            return Err("UNSAFE_ARCHIVE: duplicate entry".into());
        }
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        files
            .get("manifest.json")
            .ok_or("UNSAFE_ARCHIVE: manifest missing")?,
    )
    .map_err(|_| "INVALID_MANIFEST: malformed JSON".to_string())?;
    validate_manifest(&manifest, &files)?;
    Ok(PackData { manifest, files })
}
fn validate_manifest(
    m: &serde_json::Value,
    files: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    if m["schemaVersion"] != 1
        || !m["kind"].is_string()
        || !m["questions"].is_array()
        || !m["files"].is_array()
    {
        return Err("INVALID_MANIFEST".into());
    }
    let kind = m["kind"].as_str().unwrap();
    if kind != "COURSE" && kind != "ASSESSMENT" {
        return Err("INVALID_MANIFEST".into());
    }
    let id = if kind == "COURSE" {
        &m["courseId"]
    } else {
        &m["assessmentId"]
    };
    let pack_id = format!(
        "{}@{}",
        id.as_str().ok_or("INVALID_MANIFEST")?,
        m["version"].as_i64().ok_or("INVALID_MANIFEST")?
    );
    if m["packId"] != pack_id {
        return Err("INVALID_MANIFEST".into());
    }
    let mut listed = std::collections::HashSet::new();
    for f in m["files"].as_array().unwrap() {
        let p = f["path"].as_str().ok_or("INVALID_MANIFEST")?;
        if !safe_path(p) || !listed.insert(p.to_owned()) {
            return Err("UNSAFE_ARCHIVE".into());
        }
        let data = files.get(p).ok_or("UNSAFE_ARCHIVE: listed file missing")?;
        if f["size"].as_u64() != Some(data.len() as u64)
            || f["sha256"].as_str() != Some(hex(&Sha256::digest(data)).as_str())
        {
            return Err("HASH_MISMATCH".into());
        }
    }
    for name in files.keys() {
        if name != "manifest.json" && !listed.contains(name) {
            return Err("UNSAFE_ARCHIVE: unlisted file".into());
        }
    }
    if listed.len() + 1 != files.len() {
        return Err("UNSAFE_ARCHIVE".into());
    }
    let questions = m["questions"].as_array().unwrap();
    for q in questions {
        for key in ["path", "hiddenTestsPath"] {
            let p = q[key].as_str().ok_or("INVALID_MANIFEST")?;
            if !safe_path(p) || !listed.contains(p) {
                return Err("UNSAFE_ARCHIVE".into());
            }
        }
        let qpath = q["path"].as_str().unwrap();
        let v: serde_json::Value = serde_json::from_slice(files.get(qpath).unwrap())
            .map_err(|_| "INVALID_MANIFEST: malformed question".to_string())?;
        if v["id"] != q["id"]
            || !v["visibleTests"].is_array()
            || !v["timeLimitMs"].is_u64()
            || !v["memoryLimitMb"].is_u64()
            || !v["outputLimitKb"].is_u64()
        {
            return Err("INVALID_MANIFEST: invalid question".into());
        }
    }
    if m["kind"] == "ASSESSMENT" && m["assessment"].is_null() {
        return Err("INVALID_MANIFEST".into());
    }
    let min = m["minAppVersion"].as_str().ok_or("INVALID_MANIFEST")?;
    if version_gt(min, env!("CARGO_PKG_VERSION")) {
        return Err("APP_TOO_OLD".into());
    }
    Ok(())
}
fn version_gt(a: &str, b: &str) -> bool {
    fn parts(s: &str) -> Vec<u64> {
        s.split('.')
            .map(|x| x.split('-').next().unwrap_or("0").parse().unwrap_or(0))
            .collect()
    }
    let x = parts(a);
    let y = parts(b);
    for i in 0..x.len().max(y.len()) {
        match x.get(i).unwrap_or(&0).cmp(y.get(i).unwrap_or(&0)) {
            std::cmp::Ordering::Greater => return true,
            std::cmp::Ordering::Less => return false,
            _ => (),
        }
    }
    false
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}
