# Phase 04 — desktop packs and Platform report

Status: **Incomplete**. Pack installation, local pack reads, C6 query/run commands, wrapper APIs and a flag-gated Platform UI are implemented. The current Rust fixtures do not yet exercise signed archive installation and mutation end to end, and the UI has not been run with a signed pack and real runtime.

## Implemented

- Pack import copies a local `.lpack` and adjacent `.lpack.sig`; URL installation accepts HTTPS (localhost HTTP in debug), enforces a 200 MB compressed cap, checks the expected SHA-256, verifies the detached pack signature, validates the full ZIP and writes it under app data.
- ZIP validation rejects traversal/absolute/backslash paths, symlinks, duplicate/unlisted entries, oversized entries and expanded packs; every listed file is checked against size and SHA-256. Manifest and question essentials are validated, and `minAppVersion` is checked against `CARGO_PKG_VERSION`.
- Installed packs are recorded in SQLite migration 3. Reinstalling a pack ID returns its existing row; installing a newer course pack replaces older course versions after the new row is recorded. Reads verify signature and hash again.
- Tauri commands implement `packs_install_from_url`, `packs_import_file`, `packs_list`, `packs_remove`, `packs_list_questions`, `packs_get_question`, and `run_question`. The question view contains visible tests only; course `SUBMIT` loads hidden tests in Rust and the runner redacts their fields. Assessment submit returns `ASSESSMENT_LOCKED: phase 10`.
- The TypeScript wrappers use C6 camelCase arguments. Catalog/download URL functions fail with `BROKER_NOT_CONNECTED` and carry integration TODOs.
- Sidebar navigation and Platform UI are shown only for `VITE_OFFLINE_FIRST=1`. Since `@tauri-apps/plugin-dialog` is not installed, pack import uses a full-path text input. Question statements are plain preformatted text because no Markdown renderer is available in the current UI stack. The editor reuses Monaco setup, editor preferences, local drafts, `useResizable`, and verdict labels.
- The question screen emits pack-scoped activity events and autosaves local drafts. Solved-state lookup is left for phase 05.

## Verification

- `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml packs` — 2 passed (path safety and repeatable migration).
- `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` — succeeded.
- `pnpm --filter @lplatform/student-desktop test` — 10 files, 32 passed.
- `pnpm --filter @lplatform/student-desktop typecheck` — succeeded.
- `pnpm --filter @lplatform/student-desktop build` — succeeded; existing Monaco bundle size warning remains.

Not verified: signed pack installation/re-install/upgrade, tamper-on-disk rejection, hidden-data serialization, `run_question` RUN/SUBMIT counts, assessment submit behavior, and the manual offline UI journey. Those end-to-end pack tests require adding a test-only injected key path and fixture pack builder; no real runtime pack is installed under `.local/runtimes-test`.

## Integration notes

- Phase 05 can persist attempts at the `TODO(offline-integration): phase 05 persists attempt here` directly before `runner::run_tests` in `packs/question.rs`.
- This duplicates some of `ProgrammingWorkspace` editor and event logic; the new UI reuses `monaco-setup.ts`, `preferences.ts`, `useResizable.ts`, `local-store` draft helpers, and `verdict-label.ts`.
- The language runtime manager is embedded when the selected language is absent; it currently shows the existing all-language manager rather than a filtered single-language view.
- Browser imports currently need a full local path. The runtime catalogue URL and broker remain unconfigured pending phases 05/07.

## TODO markers

- `// TODO(offline-integration): phase 10 decrypt`
- `// TODO(offline-integration): phase 05 persists attempt here`
- `// TODO(offline-integration): derive solved state from persisted attempts in phase 05.`
- Pack download/catalog broker connection TODOs are in `src/lib/packs.ts`.
