# Phase 05 — Desktop attempts, activity batches, Supabase login and sync

Integration phase. It needs Track A (01–04) and Track B (06, 07) merged on `offline-first`. Read `00-MASTER-PROMPT.md` first; contracts C6, C7, C8, C9 and C10 apply.

## Goal
Everything the student does offline is stored safely on the PC, and reaches the cloud when a connection exists:
- `SUBMIT` attempts go to Supabase `submissions`.
- Activity goes as signed-URL uploads of gzip JSONL to Oracle Object Storage.
- New pack versions and released feedback come back.

The desktop signs in with Supabase Auth (email OTP) when `VITE_OFFLINE_FIRST=1`. With the flag off, the old API login and sync must work exactly as before.

## Read first
- `apps/student-desktop/src/lib/{outbox.ts,local-store.ts,api.ts,coding-api.ts}`, `src/App.tsx`, `src/components/Login.tsx`.
- `src-tauri/src/lib.rs`: `store_auth_session`, `load_auth_session` and `delete_auth_session` (Windows keychain via `keyring`).
- `src-tauri/src/store.rs`: the outbox/backoff logic to reuse.
- Phases 04, 06 and 07 reports (the hook location, the C9 columns, the function URLs).

## Allowed paths
- Create `apps/student-desktop/src-tauri/src/{attempts.rs,activity.rs,device.rs,secrets.rs}` and their tests.
- Modify `src-tauri/src/lib.rs` (register commands), `src-tauri/src/store.rs` (new migrations for `attempts`, `activity_events`, `activity_batches` and `device` only), `src-tauri/src/packs/*` (only the persistence hook in `run_question`), `src-tauri/Cargo.toml`, `Cargo.lock`.
- Create `apps/student-desktop/src/lib/{supabase-client.ts,offline-sync.ts,catalog.ts}` and tests; `src/components/{SupabaseLogin.tsx,SyncStatus.tsx}`.
- Modify:
  - `src/lib/packs.ts`: implement `getPackDownloadUrl` and `listCatalog`.
  - `src/lib/outbox.ts`: route `recordEvent` to `activity_append` when the flag is on.
  - `src/platform/*`: solved state, catalog browsing, sync status.
  - `src/App.tsx`: choose the login and sync engine by flag.
  - `apps/student-desktop/package.json`: add `@supabase/supabase-js`.
  - `.env.example` at the repo root: add the new `VITE_*` names with empty values.
- Create `docs/codex/offline-first/reports/05-report.md`.

## Tasks
1. **Secrets abstraction (`secrets.rs`):**
   - A trait `SecretStore { get, set, delete }`, with a keyring implementation (Windows; on other OSes it returns `IO: secure storage unavailable`) and an in-memory implementation used only under `cfg(test)`.
   - Move nothing that exists. Only add new uses: the device private key (`lplatform/device-key`), and later the phase 10 assessment keys.
2. **Device (`device.rs`):**
   - On first use, generate `deviceId` (UUID v4) and an Ed25519 key pair. The private seed goes to `SecretStore`; the `device_id` and `public_key` go to the C7 `device` row with `monotonic_seq = 0`.
   - `next_seq()` increments and persists **in the same SQLite transaction** as the row that uses it, so it never repeats after a crash.
   - Command `device_info` (C6).
   - `sign(bytes)` is used by attempts.
3. **Attempts (`attempts.rs`), the hook in `run_question`:**
   - After every `RUN` and `SUBMIT`, insert an `attempts` row (C7) with `source_sha256`, `results_json` (hidden fields already null), `monotonic_seq = next_seq()`, and `signature = base64(sign(canonical_json))`.
     - `canonical_json` is the attempt fields in this fixed key order: `attemptId, packId, questionId, assessmentId, language, mode, sourceSha256, verdict, passed, total, totalTimeMs, startedAt, finishedAt, monotonicSeq, deviceId`. Write it down in a code comment; phase 10 verifies it server-side.
   - `CUSTOM` runs are not stored.
   - Commands:
     - `attempts_list(packId?, questionId?)`: newest first, max 200.
     - `attempts_due(limit)`: unsynced `SUBMIT` attempts, oldest first.
     - `attempts_ack(attemptIds)`: sets `synced_at`.
   - Source text is kept locally (the student's own work).
4. **Activity (`activity.rs`):**
   - `activity_append(events)`: assigns `seq = next_seq()` and `deviceId` (overriding whatever the client sent), validates `eventType` against the C10 list (unknown types are rejected and counted, not stored), and caps each event's `payload_json` at 4 KB.
   - `activity_seal_batch(maxEvents)`: takes up to `maxEvents` (default 2,000) unbatched events in `seq` order and builds JSONL (one C10 object per line, `schemaVersion: 2`). It gzips the result (`flate2`), computes its SHA-256, stores the batch row (`gz` BLOB), marks the events with the `batch_id` and returns `{ batchId, gzBase64, sha256, sizeBytes, eventCount }`.
     - With no events it returns `null`.
     - If an unuploaded sealed batch exists, it returns that batch instead of sealing a new one, so the order is kept.
   - `activity_ack_batch(batchId)`: sets `uploaded_at`, then deletes that batch's events and BLOB.
   - **Retention guard:** if more than 200,000 events are pending, the oldest `code_changed` events are merged into hourly summaries (same type; metadata summed). Never drop submission or assessment events. Log the merge count.
5. **Supabase client (`supabase-client.ts`):**
   - `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, { auth: { storage: keychainStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`.
   - `keychainStorage` stores the session JSON with the existing `store_auth_session`, `load_auth_session` and `delete_auth_session` commands.
   - It never uses `localStorage` for tokens in Tauri.
6. **Login (`SupabaseLogin.tsx`):**
   - Email, then OTP code (`shouldCreateUser: false`), using the same generic message rule as phase 09.
   - Load the profile. With the role not `STUDENT`, show "Use the web dashboard" and sign out.
   - After login, set the identity used for activity events (`userId`, `organizationId`).
   - Reuse the existing `Login.tsx` styling.
7. **Catalog (`catalog.ts`, `packs.ts`):**
   - `listCatalog()` selects the readable published courses with their latest `course_pack_versions` row (RLS filters them) and marks each as installed, update available, or not installed.
   - `getPackDownloadUrl(packId)` calls the broker `pack-download-url`, then `packs_install_from_url`.
   - In `PlatformHome`, **Browse catalog** now works.
8. **Sync engine (`offline-sync.ts`):**
   - Runs on start (if online), on the `online` event, every 5 minutes while online, and from a **Sync now** button.
   - One run at a time. Exponential backoff with jitter on failure (30 s up to 30 minutes).
   - Order:
     1. Get the session. With none, or a refresh failure (401), pause and show "Sign in to sync".
     2. **Attempts:** take `attempts_due(50)`, map them to `submissions` rows (C9; `course_id` from the pack manifest; `organization_id` left to the trigger), and `upsert` with `onConflict: 'id', ignoreDuplicates: true`. On success, `attempts_ack`. On a 4xx other than 401, park the attempt with its error, shown in `SyncStatus`, and do not retry endlessly. Repeat until none are left.
     3. **Activity:** `activity_seal_batch`, then broker `activity-upload-url` with `{ batchId, sizeBytes, sha256 }`, then `PUT` the gz bytes to `uploadUrl` with `Content-Type: application/gzip`, then `activity_ack_batch`. Repeat while batches exist, at most 10 per run.
     4. **Pull:** check `listCatalog()` for installed courses with a newer version. Auto-install if the pack is under 50 MB; otherwise show **Update available**. Fetch released `feedback` for the user's submissions and cache it for display with `store_put_course` style JSON caching, or a small new cache. Document which.
   - **Duplicate safety:** a crash between upload and ack re-sends the same `batchId`. The object path is the same, so it overwrites with identical bytes; this is harmless. Attempts are idempotent by ID.
9. **Activity identity:**
   - With the flag on, `recordEvent` adds `userId`, `organizationId`, `packId`, `language` and `assessmentId` from the current context, and calls `activity_append` (batching calls every 2 s or 50 events).
   - It emits `session_started`, `session_ended` and `idle_period` (60 s without input in the workspace) per C10.
   - With the flag off, the old `postEvents` path is unchanged.
10. **UI:**
    - `SyncStatus` in the sidebar footer shows pending submissions, pending activity batches, parked errors, the last successful sync time, and **Sync now**.
    - `CourseView` solved state uses `attempts_list` (a question is solved when any `SUBMIT` was `ACCEPTED`).
    - The workspace shows the attempt history for the question.
    - Released feedback is shown in the question view.

## Tests
- **Rust:**
  - `seq` is strictly increasing across store reopen, and no duplicate appears after a simulated crash (drop the connection mid-way).
  - Attempt rows for `RUN`/`SUBMIT` have hidden fields nulled.
  - The signature verifies with the stored public key over the documented canonical JSON.
  - `CUSTOM` is not stored.
  - `attempts_due` returns only unsynced `SUBMIT` attempts.
  - `seal_batch` returns the same unuploaded batch until acked; the gz decompresses to valid C10 lines with the correct `deviceId` and `seq`.
  - An unknown event type is rejected.
  - The retention guard merges only `code_changed`.
  - `SecretStore` is in-memory in tests; nothing touches the real keychain during tests.
- **TS (vitest; mock Tauri `invoke`, supabase-js and `fetch`):**
  - The sync order is attempts → activity → pull.
  - A 401 pauses the engine.
  - A PUT failure keeps the batch (no ack) and backs off.
  - A duplicate attempt upsert counts as success.
  - A parked 4xx attempt does not block later attempts.
  - Flag off: `recordEvent` still calls `postEvents`, and the Supabase client is never created.
  - Login rejects non-student roles.
  - The catalog marks update available correctly.
- **Optional live run (Blocked without the owner's Supabase project and bucket):** sign in, do work offline, sync, and confirm the rows in `submissions` and the object in `raw/activity/…`.

## Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml
pnpm --filter @lplatform/student-desktop test
$env:VITE_OFFLINE_FIRST='1'; pnpm --filter @lplatform/student-desktop build
pnpm --filter @lplatform/student-desktop build
```
Plus master §7.

## Must not
- No tokens or keys in SQLite, logs or `localStorage` (in Tauri).
- No changes to the API-backed flow when the flag is off.
- No direct writes to Object Storage except through broker-issued URLs.
- Never sync `RUN` attempts or hidden test data.

## Integration notes to leave
- The canonical JSON definition.
- The env vars.
- Where feedback is cached.
- Measured sync time for 1,000 events and 50 attempts against mocks.
