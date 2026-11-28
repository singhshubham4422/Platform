# Phase 04 — Desktop course packs and the offline Platform UI

Track A, last phase. It needs phases 01–03 on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C2, C5, C6 and C7 apply.

## Goal
The student opens **Platform**, sees their installed course packs (and can import a `.lpack` file), opens a course, chooses a language, installs that language if needed, opens a question, writes code and presses **Run** or **Submit**. Everything works with **no network** after the pack and runtime are installed.

## Read first
- Phases 01–03 code and reports.
- `apps/student-desktop/src/App.tsx`, `src/components/Sidebar.tsx` (`AppSection`, `NAV_ITEMS`).
- `src/workspace/ProgrammingWorkspace.tsx`, `monaco-setup.ts`, `useResizable.ts`, `workspace.css`, `views.css`, `verdict-label.ts`, `preferences.ts`. Reuse the editor setup and styles; **do not edit `ProgrammingWorkspace.tsx`**.
- `src/lib/local-store.ts` (drafts) and `src/lib/outbox.ts` (`recordEvent`).

## Allowed paths
- Create `apps/student-desktop/src-tauri/src/packs/{mod.rs,read.rs,install.rs,question.rs,tests.rs}`.
- Modify:
  - `src-tauri/src/lib.rs`: register the C6 phase-04 commands.
  - `src-tauri/src/store.rs`: one new migration for `packs`, plus helpers.
  - `src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/platform/{PlatformHome.tsx,CourseView.tsx,LanguagePicker.tsx,OfflineQuestionWorkspace.tsx,platform.css}`.
- Create `apps/student-desktop/src/lib/packs.ts` and `src/lib/packs.test.ts`.
- Modify `apps/student-desktop/src/App.tsx` and `src/components/Sidebar.tsx`, **only** to add one section `platform` (label "Platform"). It is shown only when `import.meta.env.VITE_OFFLINE_FIRST === '1'`; with the flag off, the app must behave exactly as before.
- Create `docs/codex/offline-first/reports/04-report.md`.

## Tasks
1. **Pack key:** reuse phase 02 `keys.rs` with role `pack`: env `PLATFORM_PACK_PUBKEY`, dev file `.local/keys/pack.pub`.
2. **Install (`install.rs`):**
   - `packs_install_from_url(url, sigUrl, expectedSha256)`:
     - Download both into `{app_data}/packs/.partial/` (same rules as phase 02: https only except localhost in debug, size cap 200 MB, retries).
     - Check the hash, then the signature, then do a full read (task 3).
     - Move to `{app_data}/packs/{courseId or assessmentId}/{version}.lpack` plus `.sig`, and record the `packs` row with `manifest_json`.
   - `packs_import_file(path)`: the same verification for a local file with a `.sig` next to it (USB or lab distribution). The file is copied, never moved.
   - Installing the same `packId` again is a no-op that returns the existing `PackInfo`.
   - A newer version of the same course **replaces** the older one, which is deleted after the new one is recorded. Drafts are untouched (they key on `questionId`).
   - `minAppVersion` greater than `CARGO_PKG_VERSION` (semver compare) gives `APP_TOO_OLD`.
3. **Read (`read.rs`):**
   - Port the phase 01 `readPack` rules to Rust: safe paths, `files[]` hashes, manifest and question validation, zip-bomb limits.
   - Packs stay zipped on disk; entries are read on demand.
   - Re-verify the pack's signature and SHA-256 every time the app starts, lazily on first open, so a pack edited on disk is refused with `SIGNATURE_INVALID`.
4. **Queries (`question.rs`):**
   - `packs_list`, `packs_remove(packId)`, `packs_list_questions(packId)` (ordered by `order`), and `packs_get_question(packId, questionId)` returning `QuestionView` with **visible tests only**.
   - Hidden test files are never returned by any command.
5. **`run_question(packId, questionId, language, source, mode)`:**
   - Check that `language` is in `manifest.languages`, else `IO: language not offered`.
   - Load the limits and tests:
     - `RUN` uses the visible tests.
     - `SUBMIT` uses visible then hidden, where hidden comes from `.hidden.json` for `COURSE` packs.
     - For an `ASSESSMENT` pack, `SUBMIT` returns `ASSESSMENT_LOCKED: phase 10` for now. Leave `// TODO(offline-integration): phase 10 decrypt`.
   - Resolve the runtime and call `runner::run_tests`. Return `RunResult`.
   - Leave `// TODO(offline-integration): phase 05 persists attempt here` exactly where phase 05 will add persistence.
6. **TS API (`src/lib/packs.ts`):**
   - Typed wrappers for every phase-04 command. Outside Tauri they throw `DESKTOP_ONLY`.
   - Add `getPackDownloadUrl(packId)` and `listCatalog()` that **throw `Error('BROKER_NOT_CONNECTED')`**, with `TODO(offline-integration)` comments. Phases 05 and 07 implement them; do not fake catalog data.
7. **UI (in `src/platform/`):**
   - **`PlatformHome`:**
     - Grid of installed packs (title, question count, languages, version).
     - An **Import pack file** button using the Tauri dialog. If `@tauri-apps/plugin-dialog` is not installed, use a simple path text input and say so in the report. Do not add the plugin without listing it as a dependency change.
     - A disabled **Browse catalog** button with the text "Available when online sync is connected".
     - An empty state.
   - **`CourseView`:** question list grouped by topic, with difficulty badges, points and solved state.
     - Solved state comes from the local attempts table **after phase 05**. For now show none, and leave `TODO(offline-integration)`.
     - Language picker (`LanguagePicker`) limited to `manifest.languages`.
     - If the chosen language's runtime is not installed, show the phase 02 `RuntimeManager` inline for just that language, then continue.
     - The last chosen language per course is remembered in `preferences.ts` storage (follow its style).
   - **`OfflineQuestionWorkspace`:**
     - The statement (render Markdown with the same approach the app already uses; if none exists, show plain preformatted text and say so), the Monaco editor using `monaco-setup.ts`, and resizable panes via `useResizable`.
     - Buttons: **Run** (visible tests), **Custom input** (`run_custom`) and **Submit**.
     - A results panel with per-test verdicts using `verdict-label.ts`. Hidden tests show only "Hidden test N: <verdict>", time and memory.
     - Starter code comes from the question, falling back to the `starterCode` in `packages/language-config`.
     - Drafts autosave through the existing `local-store` draft API with `assignmentId = assessmentId ?? null`.
     - Emit the C10 activity events through the existing `recordEvent`, with the same names and metadata as C10 (`question_opened`, `code_changed` bursts, `paste_detected`, `run_requested`, `execution_completed`, `submission_created`, `question_completed`, focus and idle). Phase 05 changes where these events go. Here, only make sure they are emitted with the right metadata, and include `packId` in ctx (add it to `ActivityEvent` as an optional field, `ADDED BY PHASE 04`).
   - The look must match the existing desktop styling. It must work at the app's minimum width of 1100 px with no horizontal scroll, and support keyboard focus order and visible focus rings.

## Tests
- **Rust:** a pack built in the test (re-implement the minimal zip build in Rust test code, or check in no binaries).
  - Valid install and list.
  - Wrong signature: `SIGNATURE_INVALID`.
  - Tampered entry: `HASH_MISMATCH`.
  - `../` entry: `UNSAFE_ARCHIVE`.
  - Too new: `APP_TOO_OLD`.
  - Re-install is a no-op; a newer version replaces the old.
  - The pack is edited on disk after install and is refused on next read.
  - `packs_get_question` JSON never contains any hidden test input or expected output (serialise and search for a unique marker string placed in the hidden tests).
  - `run_question` RUN vs SUBMIT test counts, using the `runner_probe` runtime from phase 03.
  - Assessment SUBMIT gives `ASSESSMENT_LOCKED`.
- **TS (vitest, Tauri `invoke` mocked):**
  - The `packs.ts` wrappers pass the correct argument names.
  - `BROKER_NOT_CONNECTED` stubs throw.
  - `OfflineQuestionWorkspace` renders a question, calls `run_question` with mode `RUN` on Run and `SUBMIT` on Submit, shows hidden tests without data, and emits `question_opened` and `submission_created` with C10 metadata.
  - With `VITE_OFFLINE_FIRST` unset, the sidebar has no Platform item.

## Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml packs
pnpm --filter @platform/student-desktop test
pnpm --filter @platform/student-desktop build
```
**Manual, if a real runtime pack is available:**
1. Build the J bank pack (phase 01 commands).
2. Run `$env:VITE_OFFLINE_FIRST='1'; pnpm --filter @platform/student-desktop tauri dev`.
3. Import the pack, pick Java, install Java, solve "Hello World Program", Submit, and get `ACCEPTED`.
4. Disconnect the network and repeat with another question.

Record the steps, or mark them **Implemented, not verified**.

## Must not
- Do not edit `ProgrammingWorkspace.tsx` or any server-backed view.
- No catalog or demo packs bundled in the app.
- No hidden test data in the JS layer, the DOM, logs or the error text.

## Integration notes to leave
- Where the attempt persistence hook is.
- Which existing components and styles you reused.
- Any duplicated editor logic that Claude should later merge with `ProgrammingWorkspace`.
