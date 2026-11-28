//! Compilers and interpreters shipped inside the installer.
//!
//! `scripts/fetch-runtimes.mjs` places portable toolchains under `src-tauri/runtimes/` and
//! writes `manifest.json`; Tauri copies that folder into the app's resource directory. These
//! runtimes are read-only and work offline, so students never install a compiler themselves.
//! A runtime downloaded later as a signed language pack takes precedence over the bundled one.
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use super::{RuntimeInfo, install::ResolvedRuntime};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    runtimes: Vec<BundledRuntime>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledRuntime {
    pub language: String,
    pub version: String,
    pub dir: String,
    pub source_file: String,
    pub compile: Option<Vec<String>>,
    pub run: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// Bundled runtimes described by `<root>/manifest.json`; empty when none were bundled.
pub fn load(root: &Path) -> Vec<BundledRuntime> {
    let Ok(bytes) = fs::read(root.join("manifest.json")) else {
        return Vec::new();
    };
    serde_json::from_slice::<Manifest>(&bytes)
        .map(|m| {
            m.runtimes
                .into_iter()
                .filter(|r| safe_dir(&r.dir) && root.join(&r.dir).is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve a bundled runtime. `{cache}` in environment values becomes `cache`, a writable
/// folder in app data (the C/C++ compiler keeps its build cache there).
pub fn resolve(root: &Path, cache: &Path, language: &str) -> Option<ResolvedRuntime> {
    let entry = load(root).into_iter().find(|r| r.language == language)?;
    let path = plain(root.join(&entry.dir));
    let cache = plain(cache.to_path_buf());
    let cache_text = cache.to_string_lossy().into_owned();
    let env = entry
        .env
        .into_iter()
        .map(|(k, v)| {
            let value = v.replace("{cache}", &cache_text);
            if v.contains("{cache}") {
                let _ = fs::create_dir_all(&value);
            }
            (k, value)
        })
        .collect();
    Some(ResolvedRuntime {
        language: entry.language,
        version: entry.version,
        path: path.to_string_lossy().into_owned(),
        source_file: entry.source_file,
        compile: entry.compile,
        run: entry.run,
        env,
    })
}

pub fn list(root: &Path) -> Vec<RuntimeInfo> {
    load(root)
        .into_iter()
        .map(|r| RuntimeInfo {
            path: plain(root.join(&r.dir)).to_string_lossy().into_owned(),
            language: r.language,
            version: r.version,
            installed_at: "bundled".into(),
        })
        .collect()
}

fn safe_dir(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

/// Drop the Windows `\\?\` prefix so runtime templates can join paths with `/`.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_bundled_runtime_and_expands_cache() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("bundle");
        fs::create_dir_all(root.join("zig")).unwrap();
        fs::write(
            root.join("manifest.json"),
            r#"{"runtimes":[{"language":"C","version":"0.13.0","dir":"zig","sourceFile":"main.c",
              "compile":["{runtime}/zig","cc","{src}"],"run":["{exe}"],
              "env":{"ZIG_GLOBAL_CACHE_DIR":"{cache}/zig"}},
             {"language":"JAVA","version":"21","dir":"missing","sourceFile":"Main.java","compile":null,"run":["x"]},
             {"language":"PYTHON","version":"3","dir":"../escape","sourceFile":"main.py","compile":null,"run":["x"]}]}"#,
        )
        .unwrap();
        let cache = tmp.path().join("cache");
        let rt = resolve(&root, &cache, "C").expect("bundled C");
        assert_eq!(rt.source_file, "main.c");
        assert_eq!(rt.path, root.join("zig").to_string_lossy());
        let zig_cache = cache.join("zig");
        assert_eq!(
            rt.env,
            vec![(
                "ZIG_GLOBAL_CACHE_DIR".to_string(),
                format!("{}/zig", cache.to_string_lossy())
            )]
        );
        assert!(zig_cache.is_dir());
        assert!(resolve(&root, &cache, "JAVA").is_none(), "missing folder");
        assert!(resolve(&root, &cache, "PYTHON").is_none(), "unsafe dir");
        assert_eq!(list(&root).len(), 1);
    }

    /// End-to-end check of the real toolchains. Run `node scripts/fetch-runtimes.mjs` first, then
    /// `cargo test -- --ignored bundled_toolchains`.
    #[test]
    #[ignore = "needs runtimes fetched by scripts/fetch-runtimes.mjs"]
    fn bundled_toolchains_compile_and_run() {
        use crate::runner::{Limits, Mode, RunSpec, TestCase, run_tests};
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("runtimes");
        assert!(
            root.join("manifest.json").is_file(),
            "run fetch-runtimes first"
        );
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let work = tmp.path().join("work");
        fs::create_dir_all(&work).unwrap();
        let cases = [
            (
                "PYTHON",
                r#"import sys
print(sum(map(int, sys.stdin.read().split())))
"#,
            ),
            (
                "C",
                r#"#include <stdio.h>
int main(void) { int a, b; if (scanf("%d %d", &a, &b) != 2) return 1; printf("%d\n", a + b); return 0; }
"#,
            ),
            (
                "CPP",
                r#"#include <iostream>
#include <vector>
int main() { int a, b; std::cin >> a >> b; std::vector<int> v{a, b}; std::cout << v[0] + v[1] << std::endl; }
"#,
            ),
            (
                "JAVA",
                r#"import java.util.*;
public class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt() + s.nextInt()); } }
"#,
            ),
        ];
        for (lang, source) in cases {
            let rt = resolve(&root, &cache, lang).unwrap_or_else(|| panic!("{lang} not bundled"));
            let spec = RunSpec {
                language: lang.into(),
                source: source.into(),
                tests: vec![TestCase {
                    id: "1".into(),
                    input: "2 40\n".into(),
                    expected_output: Some("42\n".into()),
                    hidden: false,
                }],
                limits: Limits {
                    time_limit_ms: 10_000,
                    memory_limit_mb: 512,
                    output_limit_kb: 64,
                },
                mode: Mode::Run,
            };
            let result = run_tests(&spec, &rt, &work);
            assert_eq!(
                result.verdict, "ACCEPTED",
                "{lang}: {:?} {:?}",
                result.compile_output, result.tests
            );
        }
    }

    #[test]
    fn no_manifest_means_no_bundled_runtimes() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path()).is_empty());
        assert!(resolve(tmp.path(), tmp.path(), "PYTHON").is_none());
    }
}
