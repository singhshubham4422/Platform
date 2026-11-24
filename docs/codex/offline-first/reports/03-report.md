# Phase 03 — local runner report

Status: **Incomplete**. The Rust runner entry point, C6 result types, runtime template expansion, a Tauri `run_custom` command, TypeScript wrapper, comparison normalization and probe example are implemented. This is not ready to claim resource isolation or adversarial containment.

## Implemented

- `run_tests(&RunSpec, &ResolvedRuntime, &Path)` creates a UUID work directory with `src` and `out`, writes language-specific source names (including Java public class naming), compiles through the signed runtime template, launches run templates without a shell, and removes the directory with a `Drop` guard.
- Each process gets a cleared/minimal environment, per-process stdin/stdout/stderr pipes, output/stderr caps, wall timeout, and at most two concurrent run permits. Hidden results have all four sensitive fields set to `null`; `SUBMIT` stops at the first failing hidden case while continuing visible tests.
- Windows builds assign a spawned child to a Job Object with memory, CPU time, active-process, kill-on-close and unhandled-exception limits. Unix builds apply `RLIMIT_CPU`, `RLIMIT_AS`, `RLIMIT_NPROC`, `RLIMIT_FSIZE`, `RLIMIT_CORE`, and `setsid`; timeout/output kills the process group.
- `run_custom` resolves installed runtime metadata, clamps limits to 60,000 ms / 2,048 MB / 1,024 KB, returns `RUNTIME_NOT_INSTALLED` when missing, and does not persist the result.
- `runner_probe` supports echo, sleep, busy loop, memory allocation, output flood, child spawning, exit code, and environment output modes.

## Verification

Verified on Windows x64:

- `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runner` — 3 passed.
- `cargo +stable build --manifest-path apps/student-desktop/Cargo.toml --examples` — succeeded.
- `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` — succeeded.
- `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` — 24 passed.
- `pnpm --filter @lplatform/student-desktop exec vitest run src/lib/runner.test.ts` — 1 file, 2 passed.
- `pnpm --filter @lplatform/student-desktop typecheck` — succeeded.

The automated Rust tests currently cover comparison normalization, Java class naming and C6 serialization only. The requested CE/WA/RE/TLE/MLE/output-limit/fork-bomb/hidden redaction/environment/cleanup adversarial cases are **not yet tested**. No real language runtime is present under `.local/runtimes-test`, so the 10-run Python overhead measurement is unavailable.

## Limitations to close

- Windows creation currently uses `std::process::Command` then assigns the child to a Job Object. It does not create the process suspended, so the required race-free job assignment and exact no-inherited-handle guarantee are not met.
- Peak memory is currently returned as `0`; memory-limit verdict behavior is only provided by the OS limit and Java OOM text detection. Unix timeout kills the process group, but `wait4` peak-RSS reporting and explicit CPU-versus-wall classification are not implemented.
- Windows and Unix adversarial suites, Linux compile/tests, and macOS compile checks remain unverified.
- `run_custom` limits use practical hard caps because C5 gives representative per-question limits but no explicit numeric maxima. The chosen bounds are 60,000 ms, 2,048 MB, and 1,024 KB.

## Integration notes

- Signature: `runner::run_tests(spec: &RunSpec, rt: &ResolvedRuntime, work_root: &Path) -> RunResult`.
- `ResolvedRuntime` is resolved from the runtime SQLite table and carries the signed compile/run templates.
- No real-runtime timings are available. Windows Job Objects provide a memory/process boundary; Unix rlimits differ in enforcement and Java receives 512 MB extra address space as specified.
- Next work should complete Windows suspended `CreateProcessW` with explicit pipes, peak memory/time accounting, and the requested probe-based adversarial tests before this runner is used for student submissions.

## TODO markers

- `// TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode`
