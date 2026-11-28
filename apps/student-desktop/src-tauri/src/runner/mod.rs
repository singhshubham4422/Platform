mod compare;
#[cfg(unix)]
mod limits_unix;
#[cfg(windows)]
mod limits_windows;
mod spec;
#[cfg(test)]
mod tests;

use crate::runtimes::ResolvedRuntime;
pub use spec::{Limits, Mode, RunResult, RunSpec, TestCase, TestResult};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use wait_timeout::ChildExt;

static RUN_SLOTS: std::sync::OnceLock<(std::sync::Mutex<usize>, std::sync::Condvar)> =
    std::sync::OnceLock::new();
struct RunPermit;
impl RunPermit {
    fn acquire() -> Self {
        let (lock, ready) =
            RUN_SLOTS.get_or_init(|| (std::sync::Mutex::new(0), std::sync::Condvar::new()));
        let mut n = lock.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= 2 {
            n = ready.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Self
    }
}
impl Drop for RunPermit {
    fn drop(&mut self) {
        let (lock, ready) = RUN_SLOTS.get().expect("run semaphore initialized");
        let mut n = lock.lock().unwrap_or_else(|e| e.into_inner());
        *n = n.saturating_sub(1);
        ready.notify_one();
    }
}

struct WorkDir(PathBuf);
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = (secs / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60,
        now.subsec_millis()
    )
}
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}
fn quote_template(
    args: &[String],
    rt: &ResolvedRuntime,
    src: &Path,
    out: &Path,
    exe: &Path,
    main: &str,
    mem: u64,
) -> Result<(String, Vec<String>), String> {
    let replace = |s: &str| {
        s.replace("{runtime}", &rt.path)
            .replace("{src}", &src.to_string_lossy())
            .replace("{out}", &out.to_string_lossy())
            .replace("{exe}", &exe.to_string_lossy())
            .replace("{main}", main)
            .replace("{memMb}", &mem.to_string())
    };
    let expanded = args.iter().map(|a| replace(a)).collect::<Vec<_>>();
    let Some(program) = expanded.first() else {
        return Err("IO: empty runtime command".into());
    };
    Ok((program.clone(), expanded[1..].to_vec()))
}
fn minimal_env(command: &mut Command, rt: &ResolvedRuntime, work: &Path) {
    command.env_clear();
    let runtime_bin = Path::new(&rt.path).join("bin");
    let mut paths = vec![runtime_bin];
    #[cfg(windows)]
    {
        paths.extend([
            PathBuf::from(r"C:\Windows\System32"),
            PathBuf::from(r"C:\Windows"),
        ]);
        if let Ok(v) = std::env::var("SYSTEMROOT") {
            command.env("SYSTEMROOT", v);
        }
    }
    #[cfg(unix)]
    {
        paths.extend([
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
    }
    command
        .env("PATH", std::env::join_paths(paths).unwrap_or_default())
        .env("TEMP", work)
        .env("TMP", work)
        .env("HOME", work)
        .env("USERPROFILE", work)
        .env("LANG", "C.UTF-8")
        .env("PYTHONIOENCODING", "utf-8")
        .envs(rt.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .current_dir(work)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    limits_unix::configure(command, rt.language == "JAVA");
}
struct Output {
    out: Vec<u8>,
    err: Vec<u8>,
    code: Option<i32>,
    timed: bool,
    overflow: bool,
    elapsed: u64,
    peak_kb: u64,
    memory_limit_hit: bool,
    cpu_limit_hit: bool,
}
#[allow(clippy::too_many_arguments)]
fn execute(
    program: &str,
    args: &[String],
    input: &str,
    rt: &ResolvedRuntime,
    work: &Path,
    timeout: Duration,
    cpu_time: Duration,
    out_limit: usize,
    mem_mb: u64,
    compile: bool,
) -> Result<Output, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    minimal_env(&mut cmd, rt, work);
    #[cfg(unix)]
    limits_unix::set_limits(&mut cmd, cpu_time, mem_mb, rt.language == "JAVA", compile);
    let start = Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("IO: unable to start runtime: {e}"))?;
    // Job CPU time is summed over all of a compiler's parallel processes.
    #[cfg(windows)]
    let cpu_time = if compile {
        let cores = thread::available_parallelism().map_or(4, |n| n.get()) as u32;
        cpu_time.saturating_mul(cores.max(1))
    } else {
        cpu_time
    };
    #[cfg(windows)]
    let job = {
        // Like the Unix limits, leave the JVM room for its own overhead beyond the heap.
        let job_mb = if rt.language == "JAVA" {
            mem_mb + 512
        } else {
            mem_mb
        };
        // A compiler is trusted code that may run parallel helper processes (zig/clang do).
        let (job_mb, max_processes) = if compile {
            (job_mb.max(2048), 64)
        } else {
            (job_mb, 16)
        };
        limits_windows::assign_job(Some(child.id()), job_mb, cpu_time, max_processes)
    };
    #[cfg(windows)]
    let job = match job {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "IO: stdin unavailable".to_string())?;
    let input_bytes = input.as_bytes().to_vec();
    let writer = thread::spawn(move || {
        use std::io::Write;
        let _ = stdin.write_all(&input_bytes);
    });
    let overflow = Arc::new(AtomicBool::new(false));
    let out = child
        .stdout
        .take()
        .ok_or_else(|| "IO: stdout unavailable".to_string())?;
    let err = child
        .stderr
        .take()
        .ok_or_else(|| "IO: stderr unavailable".to_string())?;
    let o = overflow.clone();
    let out_limit = out_limit.max(1);
    let out_thread = thread::spawn(move || read_capped(out, out_limit, o));
    let err_thread =
        thread::spawn(move || read_capped(err, 16 * 1024, Arc::new(AtomicBool::new(false))));
    let mut timed = false;
    let mut cpu_polled_hit = false;
    let cpu_limit_ms = cpu_time.as_millis() as u64;
    let status = loop {
        if overflow.load(Ordering::Relaxed) {
            kill_tree(&mut child);
            break child.wait().ok();
        }
        #[cfg(windows)]
        if job.cpu_ms() >= cpu_limit_ms {
            cpu_polled_hit = true;
            job.kill_all();
            kill_tree(&mut child);
            break child.wait().ok();
        }
        match child
            .wait_timeout(Duration::from_millis(10))
            .map_err(|e| format!("IO: {e}"))?
        {
            Some(s) => break Some(s),
            None if start.elapsed() >= timeout => {
                timed = true;
                #[cfg(windows)]
                job.kill_all();
                kill_tree(&mut child);
                break child.wait().ok();
            }
            None => {}
        }
    };
    let elapsed = start.elapsed().as_millis() as u64;
    // Read the job's accounting, then end any processes the program left behind BEFORE joining
    // the pipe readers: a surviving child holding stdout would otherwise block the reads.
    #[cfg(windows)]
    let stats = {
        let s = job.stats();
        job.kill_all();
        s
    };
    #[cfg(not(windows))]
    let stats = (0u64, false, false);
    let _ = writer.join();
    let out = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();
    #[cfg(windows)]
    drop(job);
    #[cfg(windows)]
    let (peak_kb, memory_limit_hit, cpu_limit_hit) = (
        stats.peak_kb,
        stats.memory_limit_hit,
        cpu_polled_hit || stats.cpu_limit_hit || stats.cpu_ms >= cpu_limit_ms,
    );
    #[cfg(not(windows))]
    let (peak_kb, memory_limit_hit, cpu_limit_hit) = {
        let _ = (cpu_polled_hit, cpu_limit_ms);
        stats
    };
    Ok(Output {
        out,
        err,
        code: status.and_then(|s| s.code()),
        timed,
        overflow: overflow.load(Ordering::Relaxed),
        elapsed,
        peak_kb,
        memory_limit_hit,
        cpu_limit_hit,
    })
}
#[cfg(unix)]
fn kill_tree(child: &mut std::process::Child) {
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}
#[cfg(windows)]
fn kill_tree(child: &mut std::process::Child) {
    let _ = child.kill();
}
fn read_capped<R: std::io::Read>(mut r: R, cap: usize, overflow: Arc<AtomicBool>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = cap.saturating_sub(out.len());
                out.extend_from_slice(&buf[..n.min(room)]);
                if n > room {
                    overflow.store(true, Ordering::Relaxed);
                }
            }
        }
    }
    out
}
fn clean(text: &[u8], work: &Path) -> String {
    String::from_utf8_lossy(text).replace(&work.to_string_lossy().to_string(), "<work>")
}

pub fn run_tests(spec: &RunSpec, rt: &ResolvedRuntime, work_root: &Path) -> RunResult {
    // TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode
    let _slot = RunPermit::acquire();
    run_tests_inner(spec, rt, work_root)
}
fn run_tests_inner(spec: &RunSpec, rt: &ResolvedRuntime, work_root: &Path) -> RunResult {
    let started = timestamp();
    let attempt = uuid::Uuid::new_v4().to_string();
    let total = spec.tests.len();
    let root = work_root.join(format!("run-{}", uuid::Uuid::new_v4()));
    let _guard = WorkDir(root.clone());
    let srcdir = root.join("src");
    let outdir = root.join("out");
    let _ = fs::create_dir_all(&srcdir);
    let _ = fs::create_dir_all(&outdir);
    let source_name = if spec.language == "JAVA" {
        format!("{}.java", java_main_class(&spec.source))
    } else {
        rt.source_file.clone()
    };
    let src = srcdir.join(source_name);
    let _ = fs::write(&src, &spec.source);
    let exe = outdir.join(if cfg!(windows) { "main.exe" } else { "main" });
    let main = src.file_stem().and_then(|s| s.to_str()).unwrap_or("Main");
    let mut compile_output = None;
    if let Some(template) = &rt.compile {
        let compiled = quote_template(
            template,
            rt,
            &src,
            &outdir,
            &exe,
            main,
            spec.limits.memory_limit_mb,
        );
        let compiled_result = compiled.and_then(|(p, a)| {
            execute(
                &p,
                &a,
                "",
                rt,
                &root,
                Duration::from_millis(compile_timeout(&spec.language)),
                Duration::from_millis(compile_timeout(&spec.language)),
                64 * 1024,
                1024,
                true,
            )
        });
        match compiled_result {
            Ok(o) if o.code == Some(0) && !o.timed => {}
            Ok(o) => {
                compile_output = Some(clean(&[o.err, o.out].concat(), &root));
                return result(
                    spec,
                    attempt,
                    started,
                    compile_output,
                    vec![],
                    "COMPILE_ERROR",
                    0,
                    total,
                    0,
                );
            }
            Err(e) => {
                compile_output = Some(e);
                return result(
                    spec,
                    attempt,
                    started,
                    compile_output,
                    vec![],
                    "COMPILE_ERROR",
                    0,
                    total,
                    0,
                );
            }
        }
    }
    let run_template = quote_template(
        &rt.run,
        rt,
        &src,
        &outdir,
        &exe,
        main,
        spec.limits.memory_limit_mb,
    );
    let Ok((program, args)) = run_template else {
        return result(
            spec,
            attempt,
            started,
            Some("Invalid runtime template".into()),
            vec![],
            "RUNTIME_ERROR",
            0,
            total,
            0,
        );
    };
    let mut tests = Vec::new();
    let mut passed = 0;
    let mut overall = "ACCEPTED";
    let mut total_time = 0;
    for case in &spec.tests {
        let timeout = Duration::from_millis(
            spec.limits
                .time_limit_ms
                .saturating_mul(2)
                .saturating_add(1000),
        );
        let o = execute(
            &program,
            &args,
            &case.input,
            rt,
            &root,
            timeout,
            Duration::from_millis(spec.limits.time_limit_ms),
            (spec.limits.output_limit_kb * 1024) as usize,
            spec.limits.memory_limit_mb,
            false,
        );
        let (verdict, out, err, time, memory) = match o {
            Ok(o) => {
                let out = clean(&o.out, &root);
                let err = clean(&o.err, &root);
                let v = if o.overflow {
                    "OUTPUT_LIMIT_EXCEEDED"
                } else if o.memory_limit_hit && (o.code != Some(0) || o.timed) {
                    "MEMORY_LIMIT_EXCEEDED"
                } else if o.timed || o.cpu_limit_hit {
                    "TIME_LIMIT_EXCEEDED"
                } else if o.code != Some(0)
                    && (spec.language == "JAVA" && err.contains("OutOfMemoryError"))
                {
                    "MEMORY_LIMIT_EXCEEDED"
                } else if o.code != Some(0) {
                    "RUNTIME_ERROR"
                } else if case
                    .expected_output
                    .as_ref()
                    .is_none_or(|e| compare::outputs_match(&out, e))
                {
                    "ACCEPTED"
                } else {
                    "WRONG_ANSWER"
                };
                (v, out, err, o.elapsed, o.peak_kb)
            }
            Err(e) => ("RUNTIME_ERROR", String::new(), e, 0, 0),
        };
        if verdict != "ACCEPTED" && overall == "ACCEPTED" {
            overall = verdict;
        }
        if verdict == "ACCEPTED" {
            passed += 1;
        }
        total_time += time;
        let hidden = case.hidden;
        tests.push(TestResult {
            test_id: case.id.clone(),
            hidden,
            verdict: verdict.into(),
            time_ms: time,
            memory_kb: memory,
            stdout: (!hidden).then_some(out),
            stderr: (!hidden).then_some(err),
            expected_output: if hidden {
                None
            } else {
                case.expected_output.clone()
            },
            input: (!hidden).then(|| case.input.clone()),
        });
        if verdict != "ACCEPTED" && hidden && spec.mode == Mode::Submit {
            break;
        }
    }
    result(
        spec,
        attempt,
        started,
        compile_output,
        tests,
        overall,
        passed,
        total,
        total_time,
    )
}
#[allow(clippy::too_many_arguments)]
fn result(
    spec: &RunSpec,
    attempt_id: String,
    started_at: String,
    compile_output: Option<String>,
    tests: Vec<TestResult>,
    verdict: &str,
    passed: usize,
    total: usize,
    total_time_ms: u64,
) -> RunResult {
    RunResult {
        attempt_id,
        mode: spec.mode.clone(),
        verdict: verdict.into(),
        compile_output,
        tests,
        passed,
        total,
        total_time_ms,
        started_at,
        finished_at: timestamp(),
    }
}
/// Compile a tiny program once so the first real compile is fast (fills compiler caches).
pub fn warm_up(rt: &ResolvedRuntime, work_root: &Path) -> Result<(), String> {
    let Some(template) = &rt.compile else {
        return Ok(());
    };
    let root = work_root.join(format!("warm-{}", uuid::Uuid::new_v4()));
    let _guard = WorkDir(root.clone());
    let srcdir = root.join("src");
    let outdir = root.join("out");
    fs::create_dir_all(&srcdir).map_err(|e| format!("IO: {e}"))?;
    fs::create_dir_all(&outdir).map_err(|e| format!("IO: {e}"))?;
    let (name, source) = match rt.language.as_str() {
        "JAVA" => (
            "Main.java",
            "public class Main { public static void main(String[] a) { System.out.println(1); } }",
        ),
        "CPP" => (
            "main.cpp",
            "#include <iostream>\nint main() { std::cout << 1 << std::endl; return 0; }\n",
        ),
        _ => (
            "main.c",
            "#include <stdio.h>\nint main(void) { printf(\"1\\n\"); return 0; }\n",
        ),
    };
    let name = if rt.language == "JAVA" {
        name.to_string()
    } else {
        rt.source_file.clone()
    };
    let src = srcdir.join(name);
    fs::write(&src, source).map_err(|e| format!("IO: {e}"))?;
    let exe = outdir.join(if cfg!(windows) { "main.exe" } else { "main" });
    let (program, args) = quote_template(template, rt, &src, &outdir, &exe, "Main", 1024)?;
    let limit = Duration::from_secs(600);
    let out = execute(
        &program,
        &args,
        "",
        rt,
        &root,
        limit,
        limit,
        64 * 1024,
        2048,
        true,
    )?;
    if out.code == Some(0) && !out.timed {
        Ok(())
    } else {
        Err(clean(&[out.err, out.out].concat(), &root))
    }
}

fn compile_timeout(lang: &str) -> u64 {
    match lang {
        "PYTHON" => 10_000,
        // The first C/C++ compile builds the bundled compiler's C library cache.
        "C" => 300_000,
        "CPP" => 300_000,
        "JAVA" => 30_000,
        _ => 10_000,
    }
}
fn java_main_class(source: &str) -> String {
    let b = source.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if source[i..].starts_with("public ") {
            let rest = &source[i + 7..];
            let r = rest.strip_prefix("final ").unwrap_or(rest);
            if let Some(x) = r.strip_prefix("class ") {
                let name = x
                    .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '$')
                    .next()
                    .unwrap_or("");
                if !name.is_empty() {
                    return name.into();
                }
            }
        }
        i += source[i..].chars().next().unwrap_or(' ').len_utf8();
    }
    "Main".into()
}
