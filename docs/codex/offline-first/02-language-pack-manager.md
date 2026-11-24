# Phase 02 — Desktop language pack manager

Track A. It needs phase 01 merged on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C2, C3, C4, C6 and C7 apply.

## Goal
The student picks a language, and the desktop app installs a ready-to-use toolchain into its own data folder from Oracle Object Storage:
- verified by signature and hash
- resumable after interruption
- smoke-tested before use
- with no admin rights and no system changes

## Read first
- `apps/student-desktop/src-tauri/src/lib.rs`: how commands, `Store` state and `app_data_dir` are set up.
- `apps/student-desktop/src-tauri/src/store.rs`: the migration list style and tests.
- `apps/student-desktop/src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.toml` (workspace), `src-tauri/capabilities/*`, `tauri.conf.json` (CSP).
- `apps/student-desktop/src/lib/local-store.ts`: how TS calls `invoke` and falls back outside Tauri.
- `packages/pack-format/` (phase 01): the formats you are verifying.

## Allowed paths
- Create `apps/student-desktop/src-tauri/src/runtimes/{mod.rs,index.rs,download.rs,install.rs,verify.rs,keys.rs,tests.rs}` and `apps/student-desktop/src-tauri/examples/print_ok.rs` (test helper only).
- Modify:
  - `apps/student-desktop/src-tauri/src/lib.rs`: register commands and state only.
  - `apps/student-desktop/src-tauri/src/store.rs`: add **one new migration** for `runtimes`, plus `runtimes_*` helper functions.
  - `apps/student-desktop/src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/lib/runtimes.ts`, `apps/student-desktop/src/lib/runtimes.test.ts`.
- Create `apps/student-desktop/src/components/RuntimeManager.tsx` (a component only; **do not** mount it in `App.tsx`; Claude wires it in).
- Modify `apps/student-desktop/src-tauri/tauri.conf.json`, **only** to add the Object Storage origin pattern to `connect-src` if the download happens from the webview. Downloads must happen in Rust (reqwest), so this should not be needed. If you do not change it, say so.
- Create `docs/codex/offline-first/reports/02-report.md`.

## Tasks
1. **Keys (`keys.rs`):** load the release public key as in C2.
   - Order: `option_env!("LPLATFORM_RELEASE_PUBKEY")`; then, **only** under `cfg(debug_assertions)` or `cfg(test)`, `{repo}/.local/keys/release.pub` found by walking up from `CARGO_MANIFEST_DIR`.
   - If neither is available, return `Err("PACK_KEY_NOT_CONFIGURED: release")`.
   - Expose `verify_detached(bytes, sig_b64, pubkey_b64) -> bool` (ed25519-dalek, strict verification).
2. **Index (`index.rs`):**
   - Fetch `{baseUrl}packs/lang/index.json` and `.sig` with reqwest (rustls, 30 s timeout, 1 MB size cap).
   - Verify the signature before parsing.
   - Parse into Rust structs matching C4 (`serde(rename_all = "camelCase")`, `deny_unknown_fields` off).
   - Validate with the same rules as phase 01 `validateLangIndex` (re-implement them in Rust and test them).
   - Filter to the current OS/arch (`std::env::consts`, mapped to C1 values).
   - Cache the verified index JSON and signature in `{app_data}/runtimes/index.json(.sig)`, so `runtimes_available` works offline from the cache. The cache must be re-verified when it is read.
3. **Download (`download.rs`):**
   - Stream to `{app_data}/runtimes/.partial/{language}-{version}-{os}-{arch}.zip`.
   - Resume with an HTTP `Range` header when a partial file exists and the server answers `206`. Otherwise restart.
   - Hash the stream as it arrives.
   - Abort when the received bytes exceed the index `size`.
   - Emit `runtime-install-progress` events `{ language, stage, receivedBytes, totalBytes, message }`, where stage is `download | verify | extract | smoke | done | error`, at most 10 times per second.
   - Retry network errors 3 times with backoff (1 s, 4 s, 10 s), then fail with `NETWORK: …`.
4. **Verify and install (`verify.rs`, `install.rs`):**
   - Check the SHA-256 against the index (`HASH_MISMATCH`), then the detached signature of the zip from `path + ".sig"` (`SIGNATURE_INVALID`).
   - Extract into `{app_data}/runtimes/{language}/{version}.tmp-<uuid>/`:
     - Reject absolute paths, `..`, drive prefixes, symlinks and entries over 1 GB (`UNSAFE_ARCHIVE`).
     - Total extracted size must not exceed 4× the zip size or 2 GB.
     - Set executable bits on unix for files under `bin/`.
   - **Smoke test:** compile and run `smokeTest.source` with the index's `compile`/`run` templates.
     - Fill placeholders per C4; `{main}` is detected with the same regex as `javaMainClass`.
     - Use a plain `std::process::Command` with a 20 s timeout. Phase 03's limited runner does not exist yet; leave `// TODO(offline-integration): switch smoke test to runner::run_tests` for Claude.
     - The output must match `expectedOutput` after normalisation like `outputsMatch` (CRLF → LF, trailing spaces per line and trailing blank lines ignored), else `SMOKE_TEST_FAILED`.
   - Atomically rename the temp folder to `{app_data}/runtimes/{language}/{version}/` and record the row in `runtimes` (C7) with `sha256`.
   - Keep at most two versions per language. Delete older folders only after the new one is recorded.
   - **Concurrency:** only one install at a time per language (a mutex in state). A second call returns the error `IO: install already running`.
5. **Commands (C6):** `runtimes_list`, `runtimes_available(baseUrl)`, `runtimes_install(baseUrl, language)` (async; runs off the main thread), `runtimes_remove(language, version)` (deletes the folder, then the row).
   - Expose a Rust function `runtimes::resolve(language) -> Result<ResolvedRuntime, String>` returning the newest installed runtime with its index templates, so phase 03 can use it. If none is installed, return `RUNTIME_NOT_INSTALLED: <LANG>`.
   - Store the templates in the DB row or alongside it as `{version}/.lplatform-runtime.json`; your choice, but document it.
6. **Base URL rules:** `baseUrl` must start with `https://` and end with `/`. `http://localhost` and `http://127.0.0.1` are allowed only in debug builds, for tests. Anything else gives `NETWORK: invalid base url`.
7. **TypeScript wrapper (`src/lib/runtimes.ts`):**
   - Typed functions for the four commands, plus `onInstallProgress(cb) → unlisten`.
   - Read the base URL from `import.meta.env.VITE_LANG_PACKS_BASE_URL`. If it is missing, throw a clear error; never hard-code a URL.
   - Outside Tauri, every function throws `Error('DESKTOP_ONLY')`.
8. **Component (`RuntimeManager.tsx`):**
   - Lists available and installed runtimes, with Install, Remove and progress bar per language.
   - Shows error codes as readable messages.
   - Follows the existing desktop styling (classes from `src/styles` / `workspace.css`) and adds no new UI library.

## Tests
- **Rust unit tests (`runtimes/tests.rs`):**
  - Use `tempfile` and a tiny local HTTP server on `127.0.0.1` built with `std::net::TcpListener` in the test. No external crates beyond the allowed list.
  - Generate an Ed25519 key in the test and build a small fake runtime zip.
  - Never use a shell script (`.cmd`, `.bat`, `.sh`) as the fake runtime; the installer must not need a shell.
  - Give the fake runtime's `run` template a helper binary that prints `ok`. Build it as a Cargo example or test helper (`src-tauri/examples/print_ok.rs`, which you may create) and copy it into the fake zip as `bin/print_ok[.exe]`. Document the approach in the report.
  - Cases:
    - Valid install records the row and creates the folder.
    - Tampered zip: `HASH_MISMATCH`.
    - Wrong signature: `SIGNATURE_INVALID`.
    - Zip with `../evil`: `UNSAFE_ARCHIVE`.
    - Index signed with the wrong key is refused.
    - Resume: the server serves the first half and drops; the second call resumes with `Range` and succeeds.
    - Size over the index: aborted.
    - Smoke failure: `SMOKE_TEST_FAILED`, and nothing is recorded.
    - Third version install deletes the oldest.
    - The cached index is re-verified (tampered cache is refused).
    - A release build with no key gives `PACK_KEY_NOT_CONFIGURED`: test the function directly with an injected `None`.
- **Store migration test:** it applies on an existing database created by the current migrations, and leaves existing tables unchanged.
- **TS test (`runtimes.test.ts`, vitest):** `DESKTOP_ONLY` outside Tauri; a missing env var gives a clear error; the progress event type guard works.

## Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes
pnpm --filter @lplatform/student-desktop test
```
Plus master §7. **Optional, manual:** build a real Windows Python embeddable pack with phase 01 `lang-pack`, serve `.local/` with `npx http-server .local -p 8787` in debug, and install it through `RuntimeManager` in `pnpm --filter @lplatform/student-desktop tauri dev`. Record it if done, else mark it **Implemented, not verified**.

## Must not
- No `cmd /c`, `sh -c` or PowerShell to run anything.
- No writes outside `{app_data}/runtimes/`. No PATH or registry changes. No elevation.
- Do not mount the component in `App.tsx` and do not touch the workspace UI.
- Do not download real toolchains in tests.

## Integration notes to leave
- The `ResolvedRuntime` struct and where templates are stored.
- The event name and payload.
- The env var names, and which CSP change (if any) is needed.
