# Phase 10 — Assessments, encrypted hidden tests, signed attempts, late rules and re-check

Final build phase. It needs **all** phases 01–09 on `offline-first`. Read `00-MASTER-PROMPT.md` first; every contract applies, especially C2, C5, C6, C7, C8 and C9, and design §8.

## Goal
A teacher schedules an assessment. Students download it in advance, start it at the opening time (online once, to get the key), and solve it offline. Their results reach the teacher with honest labels:
- on time / late / finished offline but synced late
- the attempts limit enforced
- device signatures verified
- high-stakes submissions re-checked by a central Judge0 worker before they count

## Read first
- Design §8 and all phase reports.
- `apps/api/src/modules/judge/{judge0.provider.ts,provider.ts,worker.ts}`: the Judge0 provider to reuse for the re-check.
- `supabase/functions/*` (phase 07), `apps/dashboard` assessment screens (phase 09), `src-tauri/src/{packs,attempts,device}` (phases 04–05).

## Allowed paths
- Create `supabase/migrations/20261124000006_assessments.sql` (a new migration only; never edit earlier ones).
- Create `supabase/functions/{assessment-key,register-device,submit-assessment-attempts}/index.ts`, plus handlers and tests in `supabase/functions/_shared/`.
- Modify `supabase/functions/publish-pack` and its handler (the assessment path).
- Modify `packages/supabase-tests/**` (new tests).
- Modify the desktop:
  - `apps/student-desktop/src-tauri/src/{packs/*,attempts.rs,lib.rs}`, plus new `src-tauri/src/assessment.rs`.
  - `apps/student-desktop/src/platform/*`, plus new `src/platform/AssessmentView.tsx`.
  - `src/lib/offline-sync.ts`, `src/lib/packs.ts`.
- Modify `apps/dashboard/src/**` (enable scheduling; results screen).
- Create `apps/api/src/modules/judge/recheck-worker.ts` and `apps/api/src/tests/unit/recheck-worker.test.ts`. Add the script `"recheck:worker"` to `apps/api/package.json`. Change nothing else in `apps/api`.
- Modify `supabase/README.md`, `docs/codex/offline-first/00-MASTER-PROMPT.md` (**only** C8/C9 rows marked `ADDED BY PHASE 10`).
- Create `docs/codex/offline-first/reports/10-report.md`.

## Tasks
1. **Migration `…0006_assessments.sql`:**
   - **RLS change:** students may insert `submissions` only when `assessment_id is null`. Assessment submissions arrive only through `submit-assessment-attempts` (service role). Update the policy; do not weaken any other.
   - **View `assessment_results`** (`security_invoker = true`): one row per user and assessment question with the **final verdict**, which is `recheck_verdict` when the assessment is `high_stakes` and the re-check is `DONE`, otherwise `verdict`. It also carries `late_status`, `recheck_status`, the attempt count, the best attempt and the points earned.
     - Per-user totals: score (final `ACCEPTED` points, counting `LATE` rows at 0 unless the teacher overrides through `feedback.score_override`), solved, and pending re-checks.
   - Index `submissions (assessment_id, user_id, question_id)`.
2. **`publish-pack` assessment path:**
   - The caller must be a teacher of the assessment's class, or a college admin. The assessment must be `DRAFT`, all its questions must belong to its course, and `opens_at` must be in the future.
   - Generate a random 32-byte key and a `keyId`, and store them in `assessment_keys`.
   - Build an `ASSESSMENT` pack with encrypted hidden tests (phase 01 `encryption`) and the C5 `assessment` block (`keyId`, window, duration, attempts, grace, `highStakes`).
   - Sign it, upload it to `packs/assessment/{assessmentId}/{version}.lpack`, insert `course_pack_versions` and set the status to `SCHEDULED`.
   - Republishing a `SCHEDULED` assessment before `opens_at` makes a new version **with the same key**. After `opens_at`, republishing gives 409 `ASSESSMENT_STARTED`.
3. **`register-device`** (C8): inserts or updates `devices` for the caller. It refuses to change the public key of an existing non-revoked device (409 `DEVICE_KEY_MISMATCH`), so a stolen session cannot replace a device key silently. Called by the desktop after login.
4. **`assessment-key`** (C8):
   - The caller must be a `STUDENT` member of the assessment's class, with status `SCHEDULED`, and `now()` between `opens_at` and `closes_at`. Otherwise 403 `ASSESSMENT_NOT_OPEN`, or 403 `ASSESSMENT_CLOSED`.
   - Record `assessment_key_issues` (with `device_id` from the body, which must be a registered device).
   - Return `{ keyId, keyB64, closesAt }`.
5. **`submit-assessment-attempts`** (`ADDED BY PHASE 10` to C8). Body `{ attempts: [ <attempt row C7 shape + source> ] }`, at most 20 per call. For each attempt:
   1. The device must be registered for the caller and not revoked.
   2. Verify the Ed25519 signature over the phase 05 canonical JSON; on failure reject with `SIGNATURE_INVALID`.
   3. Check `source_sha256` against the source.
   4. Check that the question belongs to the assessment.
   5. Attempts limit: `SUBMIT` count per user, assessment and question ≤ `attempts_allowed`; otherwise reject with `ATTEMPTS_EXCEEDED`.
   6. **Late rule:** let `issued` be the first key issue time for this user.
      - `ON_TIME` when server `now() ≤ closes_at + grace`.
      - `FINISHED_OFFLINE_SYNCED_LATE` when the server time is later, but `finished_at ≤ closes_at`, `started_at ≥ issued`, `finished_at - started_at ≤ duration_minutes`, and the attempt's `monotonic_seq` is greater than every `monotonic_seq` the server has already received from that device before `issued`.
      - Otherwise `LATE`.
   7. `recheck_status = 'QUEUED'` when `high_stakes`, else `NOT_REQUIRED`.
   8. Insert with the service client, `on conflict (id) do nothing` (idempotent).
   - Response: `{ accepted: [ids], duplicates: [ids], rejected: [{ id, error }] }`. A rejected attempt is never inserted.
6. **Desktop:**
   - **`assessment.rs`:**
     - `assessment_store_key(assessmentId, keyId, keyB64)` stores the key in `SecretStore` under `platform/assessment/{assessmentId}`.
     - `run_question` `SUBMIT` on an `ASSESSMENT` pack:
       - Load the key (no key gives `ASSESSMENT_LOCKED`), decrypt the hidden tests **in Rust memory only**, run, and drop the plaintext.
       - Enforce `attemptsAllowed` locally (`ATTEMPTS_EXCEEDED`), and the duration from the first `question_opened` of that assessment.
       - The local clock past `closesAt + grace` gives `ASSESSMENT_CLOSED`. This is user experience only; the server decides lateness.
   - **`AssessmentView.tsx`:**
     - A list of the student's assessments (Supabase `assessments`, RLS), with a **Download** button available as soon as the pack exists.
     - At opening time, a **Start** button fetches the key; this needs to be online once. With no network, show the message "Connect once at the start time to unlock".
     - Then the timer, the question list (using `OfflineQuestionWorkspace`), and attempts left.
     - After submission: "Saved on this computer — will upload when online", then "Uploaded".
   - **`offline-sync.ts`:** attempts with `assessment_id` go to `submit-assessment-attempts` instead of the direct upsert. `rejected` items are parked with their error and shown to the student.
   - After login, call `register-device` once per device.
7. **Re-check worker (`apps/api/src/modules/judge/recheck-worker.ts`):**
   - A separate process (`pnpm --filter @platform/api recheck:worker`), configured by `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN`.
   - It refuses to start unless `JUDGE_PROVIDER=judge0`. **Never** use `local-unsandboxed-dev` here.
   - It claims `QUEUED` rows (`update … set recheck_status='RUNNING' where id = (select id … for update skip locked limit 1) returning *`, through an RPC function you add in the 0006 migration, `claim_recheck()`, `security definer`, granted to `service_role` only).
   - It loads all tests from `question_tests`, runs them through the existing `Judge0Provider`, and writes `recheck_verdict`, `recheck_passed`, `recheck_total`, `recheck_at` and `DONE`.
   - On Judge0 failure it sets `FAILED` after 3 tries with backoff, and never marks a pass.
   - It logs no source code and no test data.
8. **Dashboard:**
   - **Schedule** calls `publish-pack { assessmentId }`.
   - The results screen reads `assessment_results` plus the `kpi_assessment` flags, and shows the late label, re-check status (Pending / Checked / Failed), final verdict, attempts used, and score with override.
   - A teacher can set `feedback.score_override` and release.
   - The student view shows their own final results only after the assessment closes.

## Tests
- **`packages/supabase-tests`:**
  - The direct student insert with `assessment_id` is now denied; a practice insert still works.
  - `assessment_results` final-verdict logic (high-stakes with recheck `DONE`/`QUEUED`, and normal), with RLS.
  - `claim_recheck` is callable only by `service_role`, and two concurrent claims never return the same row.
- **Edge handler tests (node):**
  - **publish assessment:** the pack has `.hidden.enc` and no plain hidden tests; `readPack` returns `hidden: null`; decrypting with the stored key gives the original tests; republish before open keeps the key; after open gives 409.
  - **assessment-key:** before open 403; after close 403; non-member 403; valid gives the key and records an issue row; an unregistered device gives 403.
  - **register-device:** a key change gives 409.
  - **submit-assessment-attempts:**
    - A bad signature is rejected; a tampered source hash is rejected.
    - The attempts limit holds.
    - Each late rule branch gives the expected label (inject `now`).
    - A duplicate is reported in `duplicates`.
    - High-stakes gives `QUEUED`.
    - Max 20 per call gives 413.
- **Rust:** an assessment `SUBMIT` with no key gives `ASSESSMENT_LOCKED`; with the key it decrypts and runs; a wrong key gives `DECRYPT_FAILED`, mapped to `ASSESSMENT_LOCKED`; the attempts limit holds; no plaintext hidden-test file is ever written to disk (assert the temp dirs contain no marker string).
- **TS:** assessment attempts are routed to the function; rejected ones are parked; the offline Start message.
- **Re-check worker unit tests,** with a mocked Supabase and a mocked Judge0 provider: a correct claim → run → update; failure → `FAILED` after 3 tries; refusal without `JUDGE_PROVIDER=judge0`.
- **Dashboard tests:** Schedule enabled; the results screen labels.
- **Blocked without hardware:** a re-check against real Judge0 (needs the college x86 Linux PC from the design). Use `infra/judge/production/README.md` for that machine.

## Verification
```
pnpm test:supabase
node --test supabase/functions/_shared
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml
pnpm --filter @platform/student-desktop test
pnpm --filter @platform/dashboard test
pnpm --filter @platform/api test
```
Plus master §7.

## Must not
- No decrypted hidden tests outside Rust memory. No key in SQLite or logs.
- No path for students to insert assessment submissions directly.
- The re-check worker must never mark `ACCEPTED` without a real Judge0 result.
- Do not edit earlier migrations.

## Integration notes to leave
- The full assessment journey as a numbered list, for Claude's end-to-end test.
- Every `TODO(offline-integration)` left anywhere in the code base (`rg "TODO\(offline-integration\)"` output).
- The final list of contract additions.
