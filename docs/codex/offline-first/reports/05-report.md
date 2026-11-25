# Phase 05 report — attempts, activity batches, Supabase login and sync

Written by Claude, 2026-11-25. Codex skipped this phase; Claude built it.

## 1. Summary
- Every Run and Submit is now stored in local SQLite and signed with a per-device Ed25519 key, whose seed lives in the OS keychain.
- Activity events are stored locally with a crash-safe monotonic `seq`, then sealed into gzip JSONL batches for Object Storage.
- With `VITE_OFFLINE_FIRST=1`, the desktop opens a separate shell: Supabase e-mail OTP sign-in (active students only), Platform with a working catalog and download, solved state, per-question submission history with upload state and released feedback, and a sync status panel.
- The sync engine runs in this order: session → device registration → attempts → activity → pull (pack updates, feedback).
- With the flag unset, the legacy app runs unchanged (tested).

## 2. Status table
| Task | Status | Command | Result |
| --- | --- | --- | --- |
| Secret store abstraction (keychain + in-memory for tests) | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` | 37 passed |
| Device id, key, monotonic seq (crash-safe, key-loss rotation) | Verified | same | 4 device tests |
| Attempts stored, hidden fields nulled, signed canonical JSON | Verified | same | 4 attempt tests, including the byte-exact server fixture |
| Activity append / seal / ack / backlog compaction | Verified | same | 3 activity tests |
| Canonical JSON identical on the server | Verified | `node --test supabase/functions/_shared/canonical-attempt.test.mjs` | 1 pass |
| Supabase client with keychain session storage | Verified | `pnpm --filter @lplatform/student-desktop test` | 54 passed (all desktop TS) |
| Sign-in: generic message, students only, disabled refused | Verified | same | `SupabaseLogin.test.tsx` (jsdom) |
| Sync engine order, 401 pause, PUT failure keeps batch, park 4xx, duplicate = success, assessment route | Verified | same | `offline-sync.test.ts`, 9 tests |
| Flag off keeps the legacy outbox; flag on routes to the activity queue | Verified | same | `outbox-flag.test.ts` |
| Catalog states | Verified | same | `offline-modules.test.ts` |
| Rust fmt / clippy | Verified | `cargo +stable clippy … -- -D warnings` | exit 0 |
| Desktop typecheck, lint, build (flag off and on) | Verified | `pnpm build`, `VITE_OFFLINE_FIRST=1 pnpm build` | both built |
| Live run against real Supabase and bucket | Blocked | – | needs the owner's project, functions deployed, and the bucket |

## 3. Files changed
- **Rust:** new `src-tauri/src/{secrets,device,attempts,activity}.rs`; `store.rs` (migration 4); `packs/question.rs` (persistence hook); `lib.rs` (commands and state); `Cargo.toml`/`Cargo.lock` (`flate2`, `rand` moved to normal dependencies).
- **TS:** new `src/lib/{offline-config,supabase-client,broker,activity-queue,offline-store,catalog,offline-sync,offline-runtime}.ts`, `src/components/{SupabaseLogin,SyncStatus}.tsx`, `src/offline/OfflineApp.tsx`, `src/platform/AttemptHistory.tsx`, plus tests. Modified `outbox.ts`, `packs.ts`, `App.tsx`, `platform/{PlatformHome,CourseView,OfflineQuestionWorkspace}.tsx` and `packs.test.ts`.
- `package.json`: `@supabase/supabase-js` 2.119.2; dev `@testing-library/react`, `jsdom`. `.env.example`: the `VITE_*` names.
- `supabase/functions/_shared/canonical-attempt.test.mjs`.

## 4. Contract changes (ADDED BY PHASE 05)
- C7 `attempts`: columns `device_id` and `sync_error`. C6 commands: `attempts_park(attemptId, error)` and `activity_counts()`.
- `ActivityEvent` (TS): optional `assessmentId` and `language`.
- Local cursors (`sync_cursors` table): `feedback:v1` (released feedback cache), `profile:v1` (the last signed-in profile, so the app opens offline; display only), and `device-registered:v1`.
- Activity batches seal at most **1,000** events (the spec suggested 2,000). At up to 4 KB per event, a batch then always stays under the broker's 5 MB limit.

## 5. Integration notes for Claude
- **Offline start:** the app opens offline only if a session exists in the keychain and `profile:v1` matches its user. Every permission is still decided by RLS and the broker when syncing.
- **Device registration:** `register-device` runs once per (deviceId, publicKey). A lost keychain seed rotates to a new device id, so the server never sees a changed key for an existing id.
- **Unsigned devices:** on non-Windows there is no secure store yet, so attempts are unsigned. Practice sync still works; assessment uploads will be refused (`SIGNATURE_INVALID`).
- **Backlog guard:** beyond 200,000 pending events, the oldest `code_changed` events are merged per hour. `typed_chars` is preserved, but `active_minutes` can drop slightly for those hours.
- **Legacy views:** the offline shell is separate from the legacy sidebar app, and none of the legacy views are shown in offline mode.

## 6. Blocked items
- A Supabase project with migrations 0001–0006 applied and the functions deployed, `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, the OCI bucket and secrets, and Brevo SMTP configured in Supabase Auth.

## 7. Commit
`feat(desktop): attempts, activity batches, Supabase login and sync (phase 05)`
