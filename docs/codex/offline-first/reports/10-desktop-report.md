# Phase 10 Desktop & Runner Report

## 1. Summary
Completed the Phase 10 desktop assessment slice and verified the Windows runner sandbox fixes. `assessment.rs` stores per-assessment AES-256-GCM keys in `SecretStore`, decrypts `.hidden.enc` in Rust memory only, and enforces local window, duration, and attempt limits. `runner/limits_windows.rs` and `runner/mod.rs` enforce CPU time (with active 100 ns accounting polling), memory limits, peak memory reporting, and job cleanup; all 8 `runner_probe` behavioral tests pass. `AssessmentView.tsx` and `OfflineApp.tsx` provide the assessment list, pack download, online-once `Start` key fetch, countdown timer, and per-question attempt counter.

## 2. Status table
| Task | Status | Exact command | Result |
| --- | --- | --- | --- |
| Runner fixes & behavioral probes (ACCEPTED, WA, RE, TLE, MLE, OLE, fork bomb, env isolation, hidden isolation) | **Verified** | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` | `test result: ok. 50 passed; 0 failed; 0 ignored` |
| Rust formatting & lint | **Verified** | `cargo +stable fmt --manifest-path apps/student-desktop/Cargo.toml --all -- --check` & `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` | Exit 0, 0 warnings |
| Desktop `AssessmentView.tsx` & `OfflineApp.tsx` integration | **Verified** | `pnpm --filter @lplatform/student-desktop test` | `Test Files 15 passed (15)`, `Tests 57 passed (57)` |
| Desktop TypeScript & ESLint | **Verified** | `pnpm --filter @lplatform/student-desktop typecheck` & `pnpm --filter @lplatform/student-desktop lint` | Exit 0 |
| End-to-end live assessment run (real Supabase/OCI/Judge0) | **Blocked** | – | Needs owner Supabase project, OCI bucket, release/pack keys, and x86 Linux Judge0 host |

## 3. Files changed
- `apps/student-desktop/Cargo.lock`
- `apps/student-desktop/src-tauri/Cargo.toml`
- `apps/student-desktop/src-tauri/examples/runner_probe.rs`
- `apps/student-desktop/src-tauri/src/assessment.rs` (new)
- `apps/student-desktop/src-tauri/src/attempts.rs`
- `apps/student-desktop/src-tauri/src/lib.rs`
- `apps/student-desktop/src-tauri/src/packs/question.rs`
- `apps/student-desktop/src-tauri/src/runner/limits_windows.rs`
- `apps/student-desktop/src-tauri/src/runner/mod.rs`
- `apps/student-desktop/src-tauri/src/runner/tests.rs`
- `apps/student-desktop/src-tauri/src/secrets.rs`
- `apps/student-desktop/src/lib/packs.ts`
- `apps/student-desktop/src/offline/OfflineApp.tsx`
- `apps/student-desktop/src/platform/AssessmentView.tsx` (new)
- `apps/student-desktop/src/platform/AssessmentView.test.tsx` (new)
- `docs/codex/offline-first/reports/10-desktop-report.md` (new)

## 4. Contract changes
None. Uses `assessment_store_key` (C6) and `assessment-key` (C8). (`assessment_status` is a local helper command reading `SecretStore` + local SQLite cursor.)

## 5. Integration notes for Claude
- `OfflineApp.tsx` exposes **Platform** and **Assessments** sections.
- `AssessmentView.tsx` caches fetched assessments in `sync_cursors` (`assessments:v1`) and merges with `packsList()` (`kind === 'ASSESSMENT'`) so downloaded packs remain accessible offline.
- `offline-sync.ts` routes assessment `SUBMIT` attempts to `submit-assessment-attempts` and parks rejected attempts with their server error.
- `apps/student-desktop/rust-toolchain.toml` and `docs/operations/release-readiness.md` had pre-existing modifications and were left unstaged.

## 6. Blocked items
- Live Supabase project (migrations `0001`–`0006`, Edge Functions deployed, Brevo SMTP).
- Oracle Object Storage bucket, API key, and read-only PAR for `packs/lang/`.
- Release and pack Ed25519 signing keys.
- x86 Linux PC for Judge0 re-check worker.
