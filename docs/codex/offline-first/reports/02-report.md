# Phase 02 report — desktop language pack manager

**Summary:** Added the signed runtime-index client and offline cache, range-resumable downloads, size/hash/signature verification, safe extraction, smoke checks, SQLite runtime records, Tauri commands, typed frontend wrappers and the standalone `RuntimeManager` component. Local HTTP tests exercised the install and failure paths. The optional real Object Storage install was not run because no release key or packs base URL is configured.

**Overall status:** Verified (automated checks); optional live runtime install not verified.

## Status table

| Task | Status | Exact command | Result |
| --- | --- | --- | --- |
| 1. Release key loading and strict Ed25519 verification | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | Key selection and malformed signature tests passed. |
| 2. Signed index fetch, validation, platform filtering and cache | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | Signature-before-parse, wrong-key refusal, index validation and tampered-cache refusal passed. The index client caps the JSON body at 1 MiB and signature at 4 KiB. |
| 3. Resumable runtime download and progress events | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | Local HTTP server interrupted the first request; the retry resumed with `Range` and verified the complete SHA-256. Oversize response was aborted. |
| 4. Signature/hash verification, extraction, smoke test and version retention | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | Valid install, hash mismatch, wrong signature, unsafe path, smoke failure without DB record, and oldest-version removal tests passed. |
| 5. Runtime commands and `ResolvedRuntime` | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` | Tauri command registration compiled; the full suite passed, including runtime resolution after installation. Templates are stored in `.platform-runtime.json` inside the installed runtime folder. |
| 6. Base URL validation | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | HTTPS and debug localhost passed; malformed and non-local HTTP URLs were refused. |
| 7. TypeScript wrapper | Verified | `pnpm --filter @platform/student-desktop exec vitest run src/lib/runtimes.test.ts` | 3 tests passed: browser-only rejection, missing base URL and progress-event type guard. |
| 8. `RuntimeManager` component | Verified | `pnpm --filter @platform/student-desktop typecheck` | Component type-check passed. It remains intentionally unmounted for Claude’s integration pass. |

## Repository checks

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Verified — lockfile up to date. |
| `pnpm lint` | Verified — all workspace lint scripts completed. |
| `pnpm typecheck` | Verified — API, web and desktop TypeScript checks completed after the build. |
| `pnpm test` | Verified — language config 4, pack format 10, API 27, desktop 28 and web 58 tests passed. |
| `pnpm test:integration` | Verified — 3 files and 24 integration tests passed. |
| `cargo +stable fmt --manifest-path apps/student-desktop/Cargo.toml --all -- --check` | Verified — exit code 0. |
| `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` | Verified — completed without warnings. |
| `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` | Verified — 21 passed, 0 failed. |
| `pnpm build` | Verified — API, desktop and web builds completed. Vite reported its existing large Monaco chunk warning. |
| `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes` | Verified — 14 runtime tests passed. |
| `pnpm --filter @platform/student-desktop test` | Verified — 8 files and 28 tests passed. |
| `pnpm --filter @platform/student-desktop typecheck` | Verified — completed. |
| `pnpm --filter @platform/student-desktop exec vitest run src/lib/runtimes.test.ts` | Verified — 3 tests passed. |

## Files changed

- `apps/student-desktop/src-tauri/src/runtimes/{mod.rs,index.rs,download.rs,install.rs,verify.rs,keys.rs,tests.rs}`
- `apps/student-desktop/src-tauri/examples/print_ok.rs`
- `apps/student-desktop/src-tauri/src/lib.rs`
- `apps/student-desktop/src-tauri/src/store.rs`
- `apps/student-desktop/src-tauri/Cargo.toml`
- `apps/student-desktop/Cargo.lock`
- `apps/student-desktop/src/lib/runtimes.ts`
- `apps/student-desktop/src/lib/runtimes.test.ts`
- `apps/student-desktop/src/components/RuntimeManager.tsx`
- `docs/codex/offline-first/reports/02-report.md`

## Contract changes

None.

## Integration notes for Claude

- `ResolvedRuntime` is `runtimes::ResolvedRuntime` (defined in `runtimes::install`) and returns `language`, `version`, `path`, `sourceFile`, `compile` and `run`. Runtime templates are stored as `.platform-runtime.json` alongside the runtime files.
- Progress uses event `runtime-install-progress` with `{ language, stage, receivedBytes, totalBytes, message }`; stages are `download`, `verify`, `extract`, `smoke`, `done` and `error`.
- Configure compile-time `PLATFORM_RELEASE_PUBKEY` for release builds and desktop env `VITE_LANG_PACKS_BASE_URL`. Debug/test builds may read `.local/keys/release.pub`.
- Downloads use Rust `reqwest`; no `tauri.conf.json` CSP change was needed.
- The component is created but is not mounted in `App.tsx`, as required. The optional real Windows runtime install remains for the owner after providing the packs base URL and release public key.
- `// TODO(offline-integration): switch smoke test to runner::run_tests` remains for phase 03 integration.

## Blocked items

- Optional live Object Storage install: owner must provide `VITE_LANG_PACKS_BASE_URL`, a matching release public key (or release build configuration), and a signed language pack. Automated local-server verification passed.

## Commit

- `feat(desktop): language pack manager (phase 02)` — hash is recorded in `FINAL-SUMMARY.md` after the phase commit.
