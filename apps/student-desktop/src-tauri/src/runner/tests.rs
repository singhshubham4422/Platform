use super::*;

#[test]
fn mode_and_contract_fields_serialize_in_camel_case() {
    let result = RunResult {
        attempt_id: "id".into(),
        mode: Mode::Custom,
        verdict: "ACCEPTED".into(),
        compile_output: None,
        tests: vec![],
        passed: 0,
        total: 1,
        total_time_ms: 0,
        started_at: "2026-01-01T00:00:00.000Z".into(),
        finished_at: "2026-01-01T00:00:00.000Z".into(),
    };
    let v = serde_json::to_value(result).unwrap();
    assert_eq!(v["mode"], "CUSTOM");
    assert!(v.get("attemptId").is_some());
}
#[test]
fn java_class_matches_language_config_rules() {
    assert_eq!(
        java_main_class("public final class Solution {}"),
        "Solution"
    );
    assert_eq!(java_main_class("class Hidden {}"), "Main");
}

// ---- Behavioural tests with the `runner_probe` helper as a fake runtime (no real compilers). ----
#[cfg(windows)]
mod probe {
    use super::*;
    use crate::runtimes::ResolvedRuntime;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::OnceLock;

    /// Compiles examples/runner_probe.rs once per test binary.
    fn probe_dir() -> &'static Path {
        static DIR: OnceLock<PathBuf> = OnceLock::new();
        DIR.get_or_init(|| {
            let dir = std::env::temp_dir().join(format!("lp-probe-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/runner_probe.rs");
            let ok = Command::new(option_env!("RUSTC").unwrap_or("rustc"))
                .args(["-O", "-o"])
                .arg(dir.join("runner_probe.exe"))
                .arg(src)
                .status()
                .unwrap()
                .success();
            assert!(ok, "could not build runner_probe");
            dir
        })
    }

    fn runtime(exe: &str, args: &[&str]) -> ResolvedRuntime {
        let mut run = vec![format!("{{runtime}}/{exe}")];
        run.extend(args.iter().map(|a| a.to_string()));
        ResolvedRuntime {
            language: "PYTHON".into(),
            version: "test".into(),
            path: probe_dir().to_string_lossy().into_owned(),
            source_file: "main.py".into(),
            compile: None,
            run,
            env: Vec::new(),
        }
    }

    fn spec(tests: Vec<TestCase>, mode: Mode, time_ms: u64, mem_mb: u64, out_kb: u64) -> RunSpec {
        RunSpec {
            language: "PYTHON".into(),
            source: "print(1)".into(),
            tests,
            limits: Limits {
                time_limit_ms: time_ms,
                memory_limit_mb: mem_mb,
                output_limit_kb: out_kb,
            },
            mode,
        }
    }

    fn case(id: &str, input: &str, expected: &str, hidden: bool) -> TestCase {
        TestCase {
            id: id.into(),
            input: input.into(),
            expected_output: Some(expected.into()),
            hidden,
        }
    }

    fn run(
        args: &[&str],
        tests: Vec<TestCase>,
        time_ms: u64,
        mem_mb: u64,
        out_kb: u64,
    ) -> RunResult {
        let work = tempfile::tempdir().unwrap();
        let r = run_tests(
            &spec(tests, Mode::Run, time_ms, mem_mb, out_kb),
            &runtime("runner_probe.exe", args),
            work.path(),
        );
        assert_eq!(
            std::fs::read_dir(work.path()).unwrap().count(),
            0,
            "work folder not removed"
        );
        r
    }

    #[test]
    fn accepted_and_wrong_answer_use_output_normalisation() {
        let r = run(
            &["echo"],
            vec![case("v1", "a  \r\nb\r\n\r\n", "a\nb", false)],
            2000,
            256,
            64,
        );
        assert_eq!(r.verdict, "ACCEPTED");
        let r = run(&["echo"], vec![case("v1", "a", "b", false)], 2000, 256, 64);
        assert_eq!(r.verdict, "WRONG_ANSWER");
    }

    #[test]
    fn non_zero_exit_is_runtime_error() {
        assert_eq!(
            run(
                &["exit", "3"],
                vec![case("v1", "", "", false)],
                2000,
                256,
                64
            )
            .verdict,
            "RUNTIME_ERROR"
        );
    }

    #[test]
    fn busy_loop_hits_the_cpu_limit_and_sleep_hits_the_wall_limit() {
        let r = run(&["busy"], vec![case("v1", "", "", false)], 500, 256, 64);
        assert_eq!(r.verdict, "TIME_LIMIT_EXCEEDED");
        // CPU limit (500 ms) must stop it well before the wall limit (2 × 500 + 1000 ms).
        assert!(r.tests[0].time_ms < 1900, "took {} ms", r.tests[0].time_ms);
        assert_eq!(
            run(&["sleep"], vec![case("v1", "", "", false)], 300, 256, 64).verdict,
            "TIME_LIMIT_EXCEEDED"
        );
    }

    #[test]
    fn allocation_over_the_limit_is_memory_limit_exceeded() {
        let r = run(
            &["alloc", "512"],
            vec![case("v1", "", "", false)],
            4000,
            64,
            64,
        );
        assert_eq!(r.verdict, "MEMORY_LIMIT_EXCEEDED", "got {r:?}");
        let ok = run(
            &["alloc", "8"],
            vec![case("v1", "", "", false)],
            6000,
            256,
            64,
        );
        assert_eq!(
            ok.tests[0].verdict, "ACCEPTED",
            "8 MB under a 256 MB limit must run normally"
        );
        assert!(
            ok.tests[0].memory_kb >= 8 * 1024,
            "peak memory reported: {}",
            ok.tests[0].memory_kb
        );
    }

    #[test]
    fn flooding_stdout_is_output_limit_exceeded() {
        assert_eq!(
            run(&["flood"], vec![case("v1", "", "", false)], 4000, 256, 64).verdict,
            "OUTPUT_LIMIT_EXCEEDED"
        );
    }

    #[test]
    fn fork_bomb_is_contained_and_leaves_no_processes() {
        let exe = "runner_probe_fork.exe";
        std::fs::copy(probe_dir().join("runner_probe.exe"), probe_dir().join(exe)).unwrap();
        let work = tempfile::tempdir().unwrap();
        let started = std::time::Instant::now();
        let r = run_tests(
            &spec(vec![case("v1", "", "", false)], Mode::Run, 1000, 256, 64),
            &runtime(exe, &["children"]),
            work.path(),
        );
        assert!(
            matches!(r.verdict.as_str(), "RUNTIME_ERROR" | "TIME_LIMIT_EXCEEDED"),
            "{}",
            r.verdict
        );
        assert!(
            started.elapsed().as_secs() < 10,
            "run hung: {:?}",
            started.elapsed()
        );
        std::thread::sleep(std::time::Duration::from_millis(300));
        let list = Command::new("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {exe}"), "/NH"])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&list.stdout);
        assert!(!text.contains(exe), "probe processes survived:\n{text}");
    }

    #[test]
    fn student_process_does_not_inherit_the_parent_environment() {
        // SAFETY: single test touching this variable; set before spawning.
        unsafe { std::env::set_var("PLATFORM_SECRET_TEST", "1") };
        let r = run(
            &["env"],
            vec![TestCase {
                id: "custom".into(),
                input: String::new(),
                expected_output: None,
                hidden: false,
            }],
            2000,
            256,
            64,
        );
        let out = r.tests[0].stdout.clone().unwrap_or_default();
        assert!(!out.contains("PLATFORM_SECRET_TEST"), "parent env leaked");
        assert!(out.to_uppercase().contains("PATH="));
    }

    #[test]
    fn hidden_results_carry_no_data_and_stop_after_first_hidden_failure() {
        let work = tempfile::tempdir().unwrap();
        let r = run_tests(
            &spec(
                vec![
                    case("v1", "x", "x", false),
                    case("h1", "SECRET-IN-1", "nope", true),
                    case("h2", "SECRET-IN-2", "SECRET-IN-2", true),
                ],
                Mode::Submit,
                2000,
                256,
                64,
            ),
            &runtime("runner_probe.exe", &["echo"]),
            work.path(),
        );
        assert_eq!(r.verdict, "WRONG_ANSWER");
        assert_eq!(
            r.tests.len(),
            2,
            "stops after the first failing hidden test"
        );
        assert_eq!(r.total, 3);
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("SECRET"), "hidden data leaked: {json}");
        assert!(
            r.tests[1].stdout.is_none()
                && r.tests[1].input.is_none()
                && r.tests[1].expected_output.is_none()
        );
    }
}
