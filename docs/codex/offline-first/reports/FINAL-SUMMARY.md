# Offline-First Implementation — Final Summary

Branch: `offline-first` (local only, unpushed).

## Phase Status

| Phase | Title | Status | Notes |
| --- | --- | --- | --- |
| 01 | Pack format & signing | **Verified (Node) / Blocked (Deno)** | `packages/pack-format`: 10/10 Node tests pass; Deno runtime not installed locally. |
| 02 | Language pack manager | **Verified (unit) / Blocked (live PAR)** | Rust download, hash/Ed25519 verify, safe zip extract, smoke test pass; live `packs/lang/` PAR blocked on owner. |
| 03 | Local code runner | **Verified (probe tests)** | Windows Job Object CPU/memory/process/output/env/hidden-isolation probes pass (50/50 Rust tests). Real compiler packs blocked on live runtimes. |
| 04 | Course packs UI | **Verified (unit)** | `PlatformHome`, `CourseView`, `OfflineQuestionWorkspace` implemented and tested. |
| 05 | Desktop attempts, activity & sync | **Verified (unit) / Blocked (live)** | SQLite outbox, Ed25519 device signing, `OfflineSync`, `SupabaseLogin`, `SyncStatus` pass unit tests; live sync blocked on Supabase/OCI. |
| 06 | Supabase schema, RLS & auth | **Verified (schema/tests) / Blocked (live)** | Migrations `0001`–`0005` + `packages/supabase-tests` pass (23/23); live project push & Brevo SMTP blocked on owner. |
| 07 | Broker Edge Functions | **Verified (Node) / Blocked (Deno & live)** | Shared handlers tested in Node; Deno CLI and live OCI PARs blocked on owner. |
| 08 | ATP KPI pipeline | **Verified (oracle) / Blocked (live ATP)** | `packages/kpi-calc` (7/7 tests) & ATP SQL verified locally; live `LPKPI`/`LPKPI_VERIFY` schemas blocked on owner. |
| 09 | Static dashboards (GitHub Pages) | **Verified (unit & build) / Blocked (deploy)** | `apps/dashboard` builds cleanly with no `service_role` material; live OTP sign-in & GitHub Pages deploy blocked on owner. |
| 10 | Assessments, trust & re-check (server + desktop) | **Verified (unit) / Blocked (live & Judge0)** | Migration `0006`, broker functions, `recheck-worker.ts`, `assessment.rs`, `AssessmentView.tsx`, and runner fixes verified locally; live E2E and x86 Linux Judge0 blocked on owner. |

## Master §7 Verification Results

- `pnpm lint`: **Passed** (all workspace packages)
- `pnpm typecheck`: **Passed** (`dashboard`, `api`, `web`, `student-desktop`)
- `pnpm test`: **Passed** (`kpi-calc` 7/7, `language-config` 4/4, `pack-format` 10/10, `supabase/functions/_shared` 23/23, `api` unit 32/32, `dashboard` 27/27, `student-desktop` 57/57, `web` 8 test files)
- `pnpm test:integration`: **Passed** (`apps/api` integration: 3 test files passed)
- `pnpm test:supabase`: **Passed** (23 passed, 0 failed, 0 skipped)
- `pnpm check:edge-sync`: **Passed** (`Edge pack-format copy matches source.`)
- `pnpm build`: **Passed** (`api`, `dashboard`, `student-desktop`, `web`)
- `cargo +stable fmt --manifest-path apps/student-desktop/Cargo.toml --all -- --check`: **Passed**
- `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings`: **Passed** (0 warnings)
- `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml`: **Passed** (50 passed, 0 failed)

## Remaining `TODO(offline-integration)` Markers

- `apps/student-desktop/src-tauri/src/runner/mod.rs:309` — `// TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode`
- `apps/student-desktop/src-tauri/src/runtimes/install.rs:411` — `// TODO(offline-integration): switch smoke test to runner::run_tests`
- `oracle/atp/README.md:20` — `TODO(offline-integration): replace the manually inserted Supabase service key with an OCI Vault secret reference.`
- `supabase/migrations/20261124000005_rls.sql:118` — `-- TODO(offline-integration): phase 10 late/recheck` (left intentionally because earlier migrations are frozen; implemented in `supabase/migrations/20261124000006_assessments.sql`).

## Known Gaps

- Phase 03 and 04 tests are thin (UI coverage for `PlatformHome`/`CourseView` and real-compiler integration tests are minimal).
- On Windows, the student process is assigned to its Job Object immediately after `Command::spawn` rather than created suspended (`CREATE_SUSPENDED`), leaving a microsecond window before limits attach.
- Assessment question text (`questions/{id}.json`) is readable on disk before the start time; only `tests/{id}.hidden.enc` is encrypted.
- There is no secure key storage implementation (`SecretStore`) on macOS/Linux, so attempts on those platforms are unsigned.

## Blocked on the Owner

- A Supabase project with migrations `0001`–`0006` applied, Edge Functions deployed, and Brevo SMTP configured for Auth email OTP.
- An Oracle Object Storage bucket, OCI API key, and a read-only PAR for `packs/lang/`.
- Production Ed25519 release and pack signing keys (`LPLATFORM_RELEASE_PUBKEY`, `LPLATFORM_PACK_PUBKEY`, `PACK_SIGNING_KEY`).
- Oracle ATP access with the `LPKPI` and `LPKPI_VERIFY` schemas.
- A domain for hosting / callbacks.
- An x86 Linux PC for the Judge0 re-check worker (`infra/judge/production/README.md`).
