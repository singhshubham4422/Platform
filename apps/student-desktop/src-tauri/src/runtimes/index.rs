use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, time::Duration};

use super::keys;

const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LangIndex {
    pub schema_version: u32,
    pub generated_at: String,
    pub packs: Vec<IndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub language: String,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub size: u64,
    pub sha256: String,
    pub path: String,
    pub source_file: String,
    pub compile: Option<Vec<String>>,
    pub run: Vec<String>,
    pub smoke_test: SmokeTest,
    pub license_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SmokeTest {
    pub source: String,
    pub expected_output: String,
}

pub fn is_language(v: &str) -> bool {
    matches!(v, "PYTHON" | "C" | "CPP" | "JAVA")
}
pub fn current_platform() -> Result<(String, String), String> {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        _ => return Err("NETWORK: unsupported operating system".into()),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => return Err("NETWORK: unsupported architecture".into()),
    };
    Ok((os.into(), arch.into()))
}

pub fn validate_url(base: &str) -> Result<(), String> {
    if !base.ends_with('/') {
        return Err("NETWORK: invalid base url".into());
    }
    if base.starts_with("https://") {
        return Ok(());
    }
    #[cfg(debug_assertions)]
    if base.starts_with("http://localhost:")
        || base.starts_with("http://127.0.0.1:")
        || base == "http://localhost/"
        || base == "http://127.0.0.1/"
    {
        return Ok(());
    }
    Err("NETWORK: invalid base url".into())
}

pub fn validate_index(index: &LangIndex) -> Result<(), String> {
    let timestamp = index.generated_at.as_bytes();
    if index.schema_version != 1
        || timestamp.len() != 24
        || timestamp[4] != b'-'
        || timestamp[7] != b'-'
        || timestamp[10] != b'T'
        || timestamp[13] != b':'
        || timestamp[16] != b':'
        || timestamp[19] != b'.'
        || timestamp[23] != b'Z'
        || timestamp
            .iter()
            .enumerate()
            .any(|(i, b)| !matches!(i, 4 | 7 | 10 | 13 | 16 | 19 | 23) && !b.is_ascii_digit())
    {
        return Err("INVALID_INDEX: schemaVersion or generatedAt".into());
    }
    for p in &index.packs {
        if !is_language(&p.language)
            || !matches!(p.os.as_str(), "windows" | "macos" | "linux")
            || !matches!(p.arch.as_str(), "x86_64" | "aarch64")
        {
            return Err("INVALID_INDEX: platform value".into());
        }
        if p.version.is_empty()
            || p.size == 0
            || p.sha256.len() != 64
            || !p
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("INVALID_INDEX: version, size or sha256".into());
        }
        if !p.path.starts_with("packs/lang/")
            || p.path.contains('\\')
            || p.path.len() > 200
            || p.path
                .split('/')
                .any(|part| part == ".." || part == "." || part.is_empty())
        {
            return Err("INVALID_INDEX: path".into());
        }
        if (p.language == "PYTHON") != p.compile.is_none()
            || p.compile.as_ref().is_some_and(|args| args.is_empty())
        {
            return Err("INVALID_INDEX: compile template".into());
        }
        if p.run.is_empty()
            || p.source_file.is_empty()
            || p.smoke_test.source.is_empty()
            || p.license_files.is_empty()
        {
            return Err("INVALID_INDEX: runtime metadata".into());
        }
        if p.source_file.len() > 200
            || p.source_file.starts_with('/')
            || p.source_file.contains('\\')
            || p.source_file
                .split('/')
                .any(|s| s.is_empty() || s == ".." || s == ".")
        {
            return Err("INVALID_INDEX: sourceFile".into());
        }
        if p.license_files.iter().any(|f| {
            f.is_empty()
                || f.len() > 200
                || f.starts_with('/')
                || f.contains('\\')
                || f.split('/').any(|s| s.is_empty() || s == ".." || s == ".")
        }) {
            return Err("INVALID_INDEX: licenseFiles".into());
        }
        for token in p
            .compile
            .iter()
            .flatten()
            .chain(p.run.iter())
            .chain(std::iter::once(&p.source_file))
        {
            let mut rest = token.as_str();
            while let Some(open) = rest.find('{') {
                let after = &rest[open + 1..];
                let Some(close) = after.find('}') else {
                    return Err("INVALID_INDEX: malformed placeholder".into());
                };
                if !matches!(
                    &after[..close],
                    "runtime" | "src" | "out" | "exe" | "memMb" | "main"
                ) {
                    return Err("INVALID_INDEX: unknown placeholder".into());
                }
                rest = &after[close + 1..];
            }
        }
    }
    Ok(())
}

async fn bounded_body(response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|len| len > max as u64)
    {
        return Err("NETWORK: index response too large".into());
    }
    let mut stream = response.bytes_stream();
    let mut out = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("NETWORK: {e}"))?;
        if out.len().saturating_add(chunk.len()) > max {
            return Err("NETWORK: index response too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

async fn fetch_pair(base: &str) -> Result<(Vec<u8>, String), String> {
    validate_url(base)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("NETWORK: {e}"))?;
    let index_url = format!("{base}packs/lang/index.json");
    let sig_url = format!("{index_url}.sig");
    let first = client
        .get(index_url)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if first.status() != StatusCode::OK {
        return Err(format!("NETWORK: index HTTP {}", first.status()));
    }
    let content = bounded_body(first, MAX_INDEX_BYTES).await?;
    let second = client
        .get(sig_url)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if second.status() != StatusCode::OK {
        return Err(format!("NETWORK: signature HTTP {}", second.status()));
    }
    let signature = String::from_utf8(bounded_body(second, MAX_SIGNATURE_BYTES).await?)
        .map_err(|_| "SIGNATURE_INVALID".to_string())?;
    Ok((content, signature.trim().to_owned()))
}

pub(super) fn verify_pair_with_key(
    content: &[u8],
    signature: &str,
    key: &str,
) -> Result<LangIndex, String> {
    if !keys::verify_detached(content, signature, key) {
        return Err("SIGNATURE_INVALID".into());
    }
    let index: LangIndex =
        serde_json::from_slice(content).map_err(|e| format!("INVALID_INDEX: {e}"))?;
    validate_index(&index)?;
    Ok(index)
}

pub async fn load_verified(base: &str, runtimes_dir: &Path) -> Result<LangIndex, String> {
    let key = keys::release_public_key()?;
    load_verified_with_key(base, runtimes_dir, &key).await
}

pub(super) async fn load_verified_with_key(
    base: &str,
    runtimes_dir: &Path,
    key: &str,
) -> Result<LangIndex, String> {
    match fetch_pair(base).await {
        Ok((content, sig)) => {
            let index = verify_pair_with_key(&content, &sig, key)?;
            fs::create_dir_all(runtimes_dir).map_err(|e| format!("IO: {e}"))?;
            atomic_write(&runtimes_dir.join("index.json"), &content)?;
            atomic_write(&runtimes_dir.join("index.json.sig"), sig.as_bytes())?;
            Ok(index)
        }
        Err(network_error) => load_cache_with_key(runtimes_dir, key).or(Err(network_error)),
    }
}

pub(super) fn load_cache_with_key(dir: &Path, key: &str) -> Result<LangIndex, String> {
    let content = fs::read(dir.join("index.json")).map_err(|e| format!("NETWORK: {e}"))?;
    let sig =
        fs::read_to_string(dir.join("index.json.sig")).map_err(|e| format!("NETWORK: {e}"))?;
    verify_pair_with_key(&content, &sig, key)
}
fn atomic_write(target: &Path, data: &[u8]) -> Result<(), String> {
    let temp = target.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temp, data).map_err(|e| format!("IO: {e}"))?;
    if let Err(error) = fs::rename(&temp, target) {
        if target.exists() {
            fs::remove_file(target).map_err(|e| format!("IO: {e}"))?;
            fs::rename(temp, target).map_err(|e| format!("IO: {e}"))
        } else {
            Err(format!("IO: {error}"))
        }
    } else {
        Ok(())
    }
}
