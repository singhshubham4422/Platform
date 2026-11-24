use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use sha2::Digest;
use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    process::Command,
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
};
use tempfile::tempdir;
use zip::{ZipWriter, write::SimpleFileOptions};

use super::{
    download,
    index::{self, IndexEntry, LangIndex, SmokeTest},
    install, keys,
};
use crate::store::{self, RuntimeRow, Store};

fn signed(bytes: &[u8]) -> (String, String) {
    let key = SigningKey::generate(&mut rand::rngs::OsRng);
    let sig = key.sign(bytes);
    (
        STANDARD.encode(sig.to_bytes()),
        STANDARD.encode(key.verifying_key().to_bytes()),
    )
}
fn index_entry() -> IndexEntry {
    IndexEntry {
        language: "JAVA".into(),
        version: "21.0.5".into(),
        os: "windows".into(),
        arch: "x86_64".into(),
        size: 100,
        sha256: "a".repeat(64),
        path: "packs/lang/java/21.0.5/windows-x86_64.zip".into(),
        source_file: "{main}.java".into(),
        compile: Some(vec!["{runtime}/bin/javac".into(), "{src}".into()]),
        run: vec!["{runtime}/bin/java".into(), "{main}".into()],
        smoke_test: SmokeTest {
            source: "public class Main {}".into(),
            expected_output: "ok".into(),
        },
        license_files: vec!["LICENSE".into()],
    }
}
fn test_index() -> LangIndex {
    LangIndex {
        schema_version: 1,
        generated_at: "2026-11-24T00:00:00.000Z".into(),
        packs: vec![index_entry()],
    }
}
fn write_zip(path: &Path, name: &str, contents: &[u8]) -> Result<(), String> {
    let f = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(f);
    zip.start_file(name, SimpleFileOptions::default())
        .map_err(|e| e.to_string())?;
    zip.write_all(contents).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}
fn test_server(
    data: Vec<u8>,
    truncate_first: bool,
    requests: Arc<Mutex<Vec<Option<u64>>>>,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        for n in 0..if truncate_first { 2 } else { 1 } {
            let (mut stream, _) = listener.accept().unwrap();
            let mut req = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                let got = stream.read(&mut buf).unwrap_or(0);
                if got == 0 {
                    break;
                }
                req.extend_from_slice(&buf[..got]);
                if req.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&req).to_ascii_lowercase();
            let range = text.lines().find_map(|l| {
                l.strip_prefix("range: bytes=")
                    .and_then(|v| v.trim().trim_end_matches('-').parse::<u64>().ok())
            });
            requests.lock().unwrap().push(range);
            if truncate_first && n == 0 {
                let half = data.len() / 2;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    data.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&data[..half]);
                continue;
            }
            let start = range.unwrap_or(0) as usize;
            let body = &data[start..];
            let status = if range.is_some() {
                "206 Partial Content"
            } else {
                "200 OK"
            };
            let range_header = if range.is_some() {
                format!(
                    "Content-Range: bytes {}-{}/{}\r\n",
                    start,
                    data.len() - 1,
                    data.len()
                )
            } else {
                String::new()
            };
            let head = format!(
                "HTTP/1.1 {status}\r\n{range_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
        }
    });
    format!("http://{addr}/runtime.zip")
}

fn static_server(files: HashMap<String, Vec<u8>>, count: usize) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        for _ in 0..count {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                if request.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&request);
            let path = request
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/");
            if let Some(body) = files.get(path) {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            } else {
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        }
    });
    (format!("http://{addr}/"), handle)
}

fn build_helper(path: &Path) {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/print_ok.rs");
    let compiler = option_env!("RUSTC").unwrap_or("rustc");
    assert!(
        Command::new(compiler)
            .arg(source)
            .arg("-o")
            .arg(path)
            .status()
            .unwrap()
            .success()
    );
}

fn test_store() -> Store {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    store::migrate(&mut conn).unwrap();
    Store(Mutex::new(conn))
}

fn installation_fixture(
    temp: &Path,
    corrupt_zip: bool,
    wrong_zip_signature: bool,
    expected_output: &str,
) -> (String, String, JoinHandle<()>, IndexEntry) {
    let helper = temp.join(if cfg!(windows) {
        "print_ok.exe"
    } else {
        "print_ok"
    });
    build_helper(&helper);
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().unix_permissions(0o755);
        zip.start_file(
            format!("bin/print_ok{}", if cfg!(windows) { ".exe" } else { "" }),
            options,
        )
        .unwrap();
        zip.write_all(&fs::read(helper).unwrap()).unwrap();
        zip.start_file("LICENSE", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"test license").unwrap();
        zip.start_file("THIRD_PARTY_NOTICES", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"test notices").unwrap();
        zip.finish().unwrap();
    }
    let mut archive = cursor.into_inner();
    let expected_sha = super::verify::sha256_hex(&archive);
    if corrupt_zip {
        let last = archive.len() - 10;
        archive[last] ^= 1;
    }
    let seed = SigningKey::generate(&mut rand::rngs::OsRng);
    let mut entry = index_entry();
    let (os, arch) = index::current_platform().unwrap();
    entry.language = "PYTHON".into();
    entry.version = "3.12.1".into();
    entry.os = os;
    entry.arch = arch;
    entry.size = archive.len() as u64;
    entry.sha256 = expected_sha;
    entry.path = "packs/lang/python/3.12.1/test.zip".into();
    entry.source_file = "main.py".into();
    entry.compile = None;
    entry.run = vec![format!(
        "{{runtime}}/bin/print_ok{}",
        if cfg!(windows) { ".exe" } else { "" }
    )];
    entry.smoke_test.expected_output = expected_output.into();
    entry.license_files = vec!["LICENSE".into(), "THIRD_PARTY_NOTICES".into()];
    let doc = LangIndex {
        schema_version: 1,
        generated_at: "2026-11-24T00:00:00.000Z".into(),
        packs: vec![entry.clone()],
    };
    let index_bytes = serde_json::to_vec(&doc).unwrap();
    let index_signature = STANDARD.encode(seed.sign(&index_bytes).to_bytes());
    let zip_signer = if wrong_zip_signature {
        SigningKey::generate(&mut rand::rngs::OsRng)
    } else {
        seed.clone()
    };
    let zip_signature = STANDARD.encode(zip_signer.sign(&archive).to_bytes());
    let mut files = HashMap::new();
    files.insert("/packs/lang/index.json".into(), index_bytes);
    files.insert(
        "/packs/lang/index.json.sig".into(),
        index_signature.into_bytes(),
    );
    files.insert(format!("/{}", entry.path), archive);
    files.insert(format!("/{}.sig", entry.path), zip_signature.into_bytes());
    let count = if corrupt_zip { 3 } else { 4 };
    let (url, server) = static_server(files, count);
    (
        url,
        STANDARD.encode(seed.verifying_key().to_bytes()),
        server,
        entry,
    )
}

#[test]
fn index_validation_accepts_contract_and_rejects_each_bad_path_or_template() {
    let good = test_index();
    assert!(index::validate_index(&good).is_ok());
    let mut bad = good.clone();
    bad.packs[0].language = "RUST".into();
    assert!(index::validate_index(&bad).is_err());
    let mut bad = good.clone();
    bad.packs[0].sha256 = "GG".into();
    assert!(index::validate_index(&bad).is_err());
    let mut bad = good.clone();
    bad.packs[0].path = "packs/lang/../escape.zip".into();
    assert!(index::validate_index(&bad).is_err());
    let mut bad = good.clone();
    bad.packs[0].run = vec!["{unknown}".into()];
    assert!(index::validate_index(&bad).is_err());
    let mut bad = good;
    bad.packs[0].compile = None;
    assert!(index::validate_index(&bad).is_err());
    let mut bad = test_index();
    bad.packs[0].source_file = "{unknown}.java".into();
    assert!(index::validate_index(&bad).is_err());
    let mut bad = test_index();
    bad.packs[0].compile = Some(Vec::new());
    assert!(index::validate_index(&bad).is_err());
}

#[test]
fn index_signature_is_checked_before_json_parse_and_cache_is_reverified() {
    let bytes = serde_json::to_vec(&test_index()).unwrap();
    let (sig, pubkey) = signed(&bytes);
    let verified = index::verify_pair_with_key(&bytes, &sig, &pubkey).unwrap();
    assert_eq!(verified.packs.len(), 1);
    let wrong_key = SigningKey::generate(&mut rand::rngs::OsRng);
    assert_eq!(
        index::verify_pair_with_key(
            &bytes,
            &sig,
            &STANDARD.encode(wrong_key.verifying_key().to_bytes())
        )
        .unwrap_err(),
        "SIGNATURE_INVALID"
    );
    assert_eq!(
        index::verify_pair_with_key(b"not-json", "bad", &pubkey).unwrap_err(),
        "SIGNATURE_INVALID"
    );
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("index.json"), &bytes).unwrap();
    fs::write(dir.path().join("index.json.sig"), &sig).unwrap();
    assert_eq!(
        index::load_cache_with_key(dir.path(), &pubkey).unwrap(),
        test_index()
    );
    fs::write(dir.path().join("index.json"), b"tampered").unwrap();
    assert!(index::load_cache_with_key(dir.path(), &pubkey).is_err());
}

#[test]
fn base_url_policy_allows_https_and_debug_localhost_only() {
    assert!(index::validate_url("https://example.invalid/p/").is_ok());
    assert!(index::validate_url("https://example.invalid/p").is_err());
    #[cfg(debug_assertions)]
    assert!(index::validate_url("http://127.0.0.1:8787/").is_ok());
    #[cfg(not(debug_assertions))]
    assert!(index::validate_url("http://127.0.0.1:8787/").is_err());
    assert!(index::validate_url("http://example.invalid/").is_err());
}

#[test]
fn archive_rejects_parent_paths_and_extracts_only_inside_destination() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("bad.zip");
    write_zip(&archive, "../evil", b"nope").unwrap();
    let target = temp.path().join("runtime");
    fs::create_dir_all(&target).unwrap();
    assert_eq!(
        install::extract_zip(&archive, &target, fs::metadata(&archive).unwrap().len()).unwrap_err(),
        "UNSAFE_ARCHIVE"
    );
    assert!(!temp.path().join("evil").exists());
}

#[test]
fn archive_verification_checks_hash_before_detached_signature() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("runtime.zip");
    write_zip(&archive, "bin/runtime", b"valid zip payload").unwrap();
    let bytes = fs::read(&archive).unwrap();
    let (sig, pubkey) = signed(&bytes);
    let mut entry = index_entry();
    entry.sha256 = super::verify::sha256_hex(&bytes);
    assert!(super::verify::verify_archive(&archive, &sig, &entry, &pubkey).is_ok());
    fs::write(&archive, b"tampered").unwrap();
    assert_eq!(
        super::verify::verify_archive(&archive, &sig, &entry, &pubkey).unwrap_err(),
        "HASH_MISMATCH"
    );
    entry.sha256 = super::verify::sha256_hex(b"tampered");
    assert_eq!(
        super::verify::verify_archive(&archive, &sig, &entry, &pubkey).unwrap_err(),
        "SIGNATURE_INVALID"
    );
}

#[test]
fn smoke_uses_a_native_helper_without_a_shell_and_checks_output() {
    let temp = tempdir().unwrap();
    let runtime = temp.path().join("runtime");
    let bin = runtime.join("bin");
    fs::create_dir_all(&bin).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/print_ok.rs");
    let helper = bin.join(if cfg!(windows) {
        "print_ok.exe"
    } else {
        "print_ok"
    });
    let compiler = option_env!("RUSTC").unwrap_or("rustc");
    let status = Command::new(compiler)
        .arg(source)
        .arg("-o")
        .arg(&helper)
        .status()
        .unwrap();
    assert!(status.success());
    let mut entry = index_entry();
    entry.source_file = "main.c".into();
    entry.compile = None;
    entry.run = vec![format!(
        "{{runtime}}/bin/print_ok{}",
        if cfg!(windows) { ".exe" } else { "" }
    )];
    entry.smoke_test = SmokeTest {
        source: "fixture".into(),
        expected_output: "ok".into(),
    };
    install::smoke_test(&runtime, &entry).unwrap();
    entry.smoke_test.expected_output = "wrong".into();
    assert_eq!(
        install::smoke_test(&runtime, &entry).unwrap_err(),
        "SMOKE_TEST_FAILED"
    );
}

#[test]
fn malformed_signature_fails_closed() {
    assert!(!keys::verify_detached(b"payload", "bad", "bad"));
}

#[test]
fn interrupted_download_resumes_with_range_and_hashes_the_complete_file() {
    tauri::async_runtime::block_on(async {
        let bytes = (0..240_000).map(|i| (i % 251) as u8).collect::<Vec<_>>();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let url = test_server(bytes.clone(), true, requests.clone());
        let dir = tempdir().unwrap();
        let path = dir.path().join("runtime.zip");
        let hash =
            download::download_with_progress(&url, &path, "JAVA", bytes.len() as u64, |_| {})
                .await
                .unwrap();
        let expected: [u8; 32] = sha2::Sha256::digest(&bytes).into();
        assert_eq!(hash, expected);
        assert_eq!(fs::read(path).unwrap(), bytes);
        let seen = requests.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0], None);
        assert!(seen[1].is_some_and(|v| v > 0));
    });
}

#[test]
fn download_aborts_when_stream_exceeds_index_size() {
    tauri::async_runtime::block_on(async {
        let bytes = vec![1u8; 100];
        let url = test_server(bytes, false, Arc::new(Mutex::new(Vec::new())));
        let dir = tempdir().unwrap();
        let path = dir.path().join("too-large.zip");
        let error = download::download_with_progress(&url, &path, "JAVA", 50, |_| {})
            .await
            .unwrap_err();
        assert!(error.contains("SIZE_LIMIT"));
        assert!(!path.exists());
    });
}

#[test]
fn valid_runtime_install_records_metadata_and_leaves_the_runtime_folder() {
    tauri::async_runtime::block_on(async {
        let temp = tempdir().unwrap();
        let (base, pubkey, server, entry) = installation_fixture(temp.path(), false, false, "ok");
        let store = test_store();
        let installed = install::install_with_key(
            &store,
            temp.path().to_path_buf(),
            &base,
            "PYTHON",
            &pubkey,
            |_| {},
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(installed.language, "PYTHON");
        assert_eq!(installed.version, entry.version);
        assert!(
            Path::new(&installed.path)
                .join(".lplatform-runtime.json")
                .is_file()
        );
        assert_eq!(
            store::runtimes_list(&store.0.lock().unwrap())
                .unwrap()
                .len(),
            1
        );
        let resolved = install::resolve(
            &store,
            &super::RuntimeManager::new(temp.path().to_path_buf()),
            "PYTHON",
        )
        .unwrap();
        assert_eq!(resolved.path, installed.path);
    });
}

#[test]
fn install_rejects_tampering_bad_signature_and_smoke_failure_without_recording() {
    for (corrupt, wrong_signature, output, expected) in [
        (true, false, "ok", "HASH_MISMATCH"),
        (false, true, "ok", "SIGNATURE_INVALID"),
        (false, false, "wrong", "SMOKE_TEST_FAILED"),
    ] {
        tauri::async_runtime::block_on(async {
            let temp = tempdir().unwrap();
            let (base, pubkey, server, _) =
                installation_fixture(temp.path(), corrupt, wrong_signature, output);
            let store = test_store();
            let error = install::install_with_key(
                &store,
                temp.path().to_path_buf(),
                &base,
                "PYTHON",
                &pubkey,
                |_| {},
            )
            .await
            .unwrap_err();
            server.join().unwrap();
            assert!(error.contains(expected), "unexpected error: {error}");
            assert!(
                store::runtimes_list(&store.0.lock().unwrap())
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                fs::read_dir(temp.path().join("runtimes/PYTHON"))
                    .map(|items| items.count())
                    .unwrap_or(0),
                0
            );
        });
    }
}

#[test]
fn third_runtime_version_deletes_only_the_oldest_after_new_row_exists() {
    let temp = tempdir().unwrap();
    let lang_dir = temp.path().join("runtimes/JAVA");
    fs::create_dir_all(&lang_dir).unwrap();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    store::migrate(&mut conn).unwrap();
    let store = Store(Mutex::new(conn));
    for (version, stamp) in [
        ("17", "2026-01-01T00:00:00.000Z"),
        ("21", "2026-02-01T00:00:00.000Z"),
        ("22", "2026-03-01T00:00:00.000Z"),
    ] {
        let path = lang_dir.join(version);
        fs::create_dir_all(&path).unwrap();
        store::runtimes_put(
            &store.0.lock().unwrap(),
            &RuntimeRow {
                language: "JAVA".into(),
                version: version.into(),
                path: path.to_string_lossy().into_owned(),
                sha256: "a".repeat(64),
                installed_at: stamp.into(),
            },
        )
        .unwrap();
    }
    install::keep_two(&store, &lang_dir, "JAVA", "22").unwrap();
    let rows = store::runtimes_list(&store.0.lock().unwrap()).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(!lang_dir.join("17").exists());
    assert!(lang_dir.join("21").exists());
    assert!(lang_dir.join("22").exists());
}
