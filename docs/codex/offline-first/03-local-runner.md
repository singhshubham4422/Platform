# Phase 03 — Desktop local code runner

Track A. It needs phase 02 on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C4 and C6 apply.

## Goal
Compile and run student code on the student's own machine against test cases, with time, memory, output and process limits. Return the same verdicts the server judge used. This replaces Judge0 for everyday work.

## Read first
- `apps/student-desktop/src-tauri/src/runtimes/` (phase 02): `runtimes::resolve`.
- `packages/language-config/index.js`: `LANGUAGES` (`fileName`, `compileTimeoutMs`, `defaultTimeLimitMs`), `javaMainClass`, `outputsMatch`, `VERDICTS`.
- `apps/api/src/modules/judge/local-dev.provider.ts` and `judge0.provider.ts`: how verdicts were mapped before. Keep the same meaning.

## Allowed paths
- Create `apps/student-desktop/src-tauri/src/runner/{mod.rs,spec.rs,compare.rs,limits_windows.rs,limits_unix.rs,tests.rs}`.
- Create `apps/student-desktop/src-tauri/examples/runner_probe.rs`, a test helper that can sleep, allocate, print a lot, spawn children or exit with a code, depending on its arguments.
- Modify `apps/student-desktop/src-tauri/src/lib.rs` (register `run_custom` only), `src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/lib/runner.ts`, `apps/student-desktop/src/lib/runner.test.ts`.
- Create `docs/codex/offline-first/reports/03-report.md`.

## Tasks
1. **Spec (`spec.rs`):**
   ```rust
   pub struct RunSpec { pub language: String, pub source: String, pub tests: Vec<TestCase>, pub limits: Limits, pub mode: Mode }
   pub struct TestCase { pub id: String, pub input: String, pub expected_output: Option<String>, pub hidden: bool }
   ```
   `Limits` and `RunResult` are exactly C6. `expected_output: None` is used for `CUSTOM` mode; the verdict is then `ACCEPTED` if the program exits 0 within limits.
2. **Entry point:** `pub fn run_tests(spec: &RunSpec, rt: &ResolvedRuntime, work_root: &Path) -> RunResult`.
   1. Create the work folder `work_root/run-<uuid>/` containing `src/` and `out/`. Write the source as the language's file name; Java uses `{main}.java` with `{main}` from `javaMainClass` rules.
   2. **Compile** if the template is non-null.
      - Wall limit: `compileTimeoutMs` from language-config (fall back to 10 s), memory 1024 MB, output cap 64 KB.
      - A non-zero exit, or a timeout, gives the overall verdict `COMPILE_ERROR` with `compileOutput` (stderr + stdout, truncated, with absolute work paths replaced by `<work>`). Tests are not run.
   3. **Run each test in order**, as a fresh process with the run template:
      - stdin = input, written on a separate thread then closed.
      - stdout and stderr captured on separate threads with caps. stdout is capped at `outputLimitKb`; exceeding it kills the process and gives `OUTPUT_LIMIT_EXCEEDED`. stderr is capped at 16 KB, silently truncated.
      - Time: CPU and wall limits. Wall = `timeLimitMs × 2 + 1000` ms for JVM start-up; CPU = `timeLimitMs`. Either one exceeded gives `TIME_LIMIT_EXCEEDED`.
      - Memory over `memoryLimitMb` gives `MEMORY_LIMIT_EXCEEDED`. For Java, the JVM's own `OutOfMemoryError` on stderr also maps to MLE.
      - A non-zero exit or a signal gives `RUNTIME_ERROR`.
      - Otherwise compare with `outputsMatch` rules (`compare.rs`, with a unit table test identical to `packages/language-config/index.test.mjs` cases), giving `ACCEPTED` or `WRONG_ANSWER`.
      - Record `timeMs` (wall) and `memoryKb` (peak).
      - **Stop after the first failing hidden test** in `SUBMIT` mode; the remaining hidden tests are not run and are not reported. Visible tests always all run.
   4. For hidden tests set `stdout`, `stderr`, `input` and `expectedOutput` to `None` **before** the struct leaves the function.
   5. Delete the work folder, even on panic (a guard struct with `Drop`).
3. **Windows limits (`limits_windows.rs`):**
   - Create the process suspended (`CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`).
   - Assign it to a new Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` (or `JOB_MEMORY`), `JOB_OBJECT_LIMIT_PROCESS_TIME` (CPU), `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` = 16 (fork-bomb guard; Java needs a few) and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Also apply `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION` so no crash dialogs appear.
   - Then resume the process.
   - Read the peak memory from `JOBOBJECT_EXTENDED_LIMIT_INFORMATION.PeakProcessMemoryUsed`.
   - Kill means `TerminateJobObject`; always close the job handle (the guard kills any leftovers).
   - If std `Command` cannot create the process suspended, use `CreateProcessW` via `windows-sys` with explicit pipes, and quote arguments with a correct Windows quoting function. Test it with spaces and quotes.
4. **Unix limits (`limits_unix.rs`), compile-checked; run its tests on Linux CI only if available:**
   - `pre_exec` with `setrlimit`: `RLIMIT_CPU`, `RLIMIT_AS` (memory; for Java use `memoryLimitMb + 512` because the JVM reserves address space, and rely on `-Xmx`), `RLIMIT_NPROC` = 64, `RLIMIT_FSIZE` = 16 MB, `RLIMIT_CORE` = 0.
   - `setsid()`; kill the process group on timeout.
   - Peak memory from `wait4` rusage.
5. **Environment for every process:**
   - Clear the environment, then set only `PATH` (the runtime's `bin` and the minimum system dirs), `SYSTEMROOT`, `TEMP` and `TMP` (pointing to the work folder), `HOME`/`USERPROFILE` (pointing to the work folder) and `LANG=C.UTF-8` / `PYTHONIOENCODING=utf-8`.
   - The working directory is the work folder.
   - No inherited handles other than the three pipes.
6. **Concurrency:** at most 2 runs at the same time (a semaphore), so a student's laptop stays usable. Further calls wait.
7. **Command `run_custom(language, source, stdin, limits)`:**
   - Resolves the runtime (`RUNTIME_NOT_INSTALLED` if missing), runs one test with id `custom` in `CUSTOM` mode, and returns `RunResult` with a new `attemptId`.
   - It is not stored anywhere.
   - Limits are clamped to the C5 maximums.
8. **TS wrapper (`src/lib/runner.ts`):** `runCustom(...)`, typed exactly as C6. Outside Tauri it throws `DESKTOP_ONLY`. Export `verdictLabel` re-use: import the existing `src/workspace/verdict-label.ts` if present; do not duplicate it.

## Tests (`runner/tests.rs`; use the `runner_probe` example binary as a fake "runtime", so no real compilers are needed)
- `ACCEPTED`: the probe echoes stdin, and the expected output matches with CRLF and trailing spaces.
- `WRONG_ANSWER`.
- `RUNTIME_ERROR`: exit code 3.
- `TIME_LIMIT_EXCEEDED` (busy loop) **and** a wall-limit case (sleep).
- `MEMORY_LIMIT_EXCEEDED`: allocate 512 MB with a 64 MB limit.
- `OUTPUT_LIMIT_EXCEEDED`: print 10 MB.
- **Fork bomb contained:** the probe spawns children in a loop. The run ends with RE or TLE, and **no probe processes remain** afterwards (check with the job/process list in the test).
- `COMPILE_ERROR` path: the fake compile template exits 1 with a message; tests are not run; `compileOutput` contains no absolute path.
- **Hidden-field nulling:** for hidden tests every sensitive field is `None` and serialises to `null`, and nothing beyond the first failing hidden test is reported.
- **Environment:** the probe prints its environment; it contains none of the parent's variables (set `PLATFORM_SECRET_TEST=1` in the parent first, and assert it is absent).
- **Arguments with spaces and quotes** reach the probe unchanged (Windows quoting).
- **The work folder is removed** after success, failure and timeout.
- **Real languages (optional):** if `.local/runtimes-test/<lang>/` exists (the owner can unpack real packs there), run Hello World, WA, CE and TLE for each language present. Otherwise skip and print why.

## Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runner
cargo +stable build --manifest-path apps/student-desktop/Cargo.toml --examples
```
Plus master §7. Record the measured overhead: the time for 10 runs of an empty Python program, if a real runtime is available.

## Must not
- No shell. No `cmd`, `powershell`, `sh` or `bash` anywhere in the runner.
- Do not return hidden test data through any path, including error messages or logs. Do not log source code.
- Do not loosen limits to make a slow machine pass. Adjust the test sizes instead.
- No network blocking in v1 (out of scope). Leave `// TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode`.

## Integration notes to leave
- `run_tests` signature and `ResolvedRuntime` usage.
- Measured timings.
- Known differences between the Windows and unix limits.
