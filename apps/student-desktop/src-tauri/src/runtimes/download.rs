use futures_util::StreamExt;
use reqwest::{
    Client, StatusCode,
    header::{CONTENT_RANGE, RANGE},
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::{Duration, Instant},
};

use super::RuntimeInstallProgress;

pub(super) async fn download_with_progress<F>(
    url: &str,
    destination: &Path,
    language: &str,
    expected_size: u64,
    mut notify: F,
) -> Result<[u8; 32], String>
where
    F: FnMut(RuntimeInstallProgress),
{
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("NETWORK: {e}"))?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
    }
    let delays = [1, 4, 10];
    let mut last_error = String::new();
    for attempt in 0..=delays.len() {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(delays[attempt - 1])).await;
        }
        match download_once(
            &client,
            &mut notify,
            url,
            destination,
            language,
            expected_size,
        )
        .await
        {
            Ok(hash) => return Ok(hash),
            Err(e) => {
                if e.starts_with("SIZE_LIMIT:") {
                    return Err(format!("NETWORK: {e}"));
                }
                last_error = e
            }
        }
    }
    Err(format!("NETWORK: {last_error}"))
}

async fn download_once<F>(
    client: &Client,
    notify: &mut F,
    url: &str,
    destination: &Path,
    language: &str,
    expected_size: u64,
) -> Result<[u8; 32], String>
where
    F: FnMut(RuntimeInstallProgress),
{
    let mut current = fs::metadata(destination).map(|m| m.len()).unwrap_or(0);
    if current > expected_size {
        fs::remove_file(destination).map_err(|e| format!("IO: {e}"))?;
        current = 0;
    }
    let mut request = client.get(url);
    if current > 0 {
        request = request.header(RANGE, format!("bytes={current}-"));
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let append = if current > 0 && response.status() == StatusCode::PARTIAL_CONTENT {
        let range = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !range.starts_with(&format!("bytes {current}-")) {
            return Err("server returned an invalid range".into());
        }
        true
    } else if response.status() == StatusCode::OK {
        current = 0;
        false
    } else {
        return Err(format!("HTTP {}", response.status()));
    };
    let mut digest = Sha256::new();
    if append {
        let mut existing = File::open(destination).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 65536];
        loop {
            let n = existing.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            digest.update(&buf[..n]);
        }
    }
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(destination)
        .map_err(|e| format!("IO: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut received = current;
    let mut last_emit = Instant::now();
    notify(RuntimeInstallProgress {
        language: language.into(),
        stage: "download".into(),
        received_bytes: received,
        total_bytes: expected_size,
        message: "Downloading runtime".into(),
    });
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received = received.saturating_add(chunk.len() as u64);
        if received > expected_size {
            let _ = fs::remove_file(destination);
            return Err("SIZE_LIMIT: download exceeded index size".into());
        }
        digest.update(&chunk);
        output.write_all(&chunk).map_err(|e| format!("IO: {e}"))?;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            notify(RuntimeInstallProgress {
                language: language.into(),
                stage: "download".into(),
                received_bytes: received,
                total_bytes: expected_size,
                message: "Downloading runtime".into(),
            });
            last_emit = Instant::now();
        }
    }
    output.flush().map_err(|e| format!("IO: {e}"))?;
    if received != expected_size {
        return Err(format!(
            "connection ended at {received} of {expected_size} bytes"
        ));
    }
    Ok(digest.finalize().into())
}

pub async fn download_signature(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("NETWORK: signature HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n > 4096) {
        return Err("NETWORK: signature too large".into());
    }
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if body.len() > 4096 {
        return Err("NETWORK: signature too large".into());
    }
    String::from_utf8(body.to_vec())
        .map(|s| s.trim().to_owned())
        .map_err(|_| "SIGNATURE_INVALID".into())
}
