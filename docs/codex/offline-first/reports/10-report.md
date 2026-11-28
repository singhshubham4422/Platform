# Phase 10 — Assessments, encrypted hidden tests, signed attempts, late rules and re-check

## 1. Summary

The schema, broker and re-check worker for assessments are implemented: signed offline attempts, the late rule, the attempts limit, encrypted hidden tests, key issuance and a Judge0 re-check queue. The dashboard can schedule an assessment, show honest results and let a teacher override and release a score. The desktop slice is Blocked because phases 04–05 never added `attempts.rs`, `device.rs`, `offline-sync.ts` or canonical attempt signing, so there is nothing to attach `assessment.rs`/`AssessmentView.tsx` to. Live Supabase/OCI and a real-Judge0 re-check are Blocked on owner configuration and hardware. All local checks pass.

## 2. Status table

| Task | Status | Command | Result |
| --- | --- | --- | --- |
| 0006 migration: policy, views, index, `claim_recheck` | Done | `pnpm test:supabase` | `pass 22 / fail 0` |
| `publish-pack` assessment path | Done | `node --test supabase/functions/_shared/*.test.mjs` | `tests 14 / pass 14 / fail 0` |
| `register-device`, `assessment-key`, `submit-assessment-attempts` | Done | `pnpm test:supabase`; `node --test …` | same as above |
| Re-check worker + unit test | Done | `pnpm --filter @platform/api test` | `Tests 32 passed (32)` |
| Dashboard schedule/results/override/release | Done | `pnpm --filter @platform/dashboard test` | `Tests 27 passed (27)` |
| Dashboard e2e (results route in matrix) | Done | `pnpm --filter @platform/dashboard exec playwright test` | `85 passed (26.7s)` |
| Desktop assessment slice | **Blocked** | `cargo test`; `pnpm --filter @platform/student-desktop test` | 26 and 32 pre-existing tests pass; no phase 10 Rust/TS added |
| Real Judge0 re-check | **Blocked** | requires `infra/judge/production/README.md` hardware | not run |
| Repo lint / typecheck / build | Done | `pnpm lint`, `pnpm typecheck`, `pnpm build` | all projects Done |
| Repo unit/integration tests | Done | `pnpm test`, `pnpm test:integration` | `58 passed (58)`, `24 passed (24)` |
| Rust format/clippy | Done | `cargo +stable fmt --check`, `cargo +stable clippy … -D warnings` | clean |
| Edge pack-format copy | Done | `pnpm check:edge-sync` | `Edge pack-format copy matches source.` |
| Contract docs | Done | — | `supabase/README.md`, C8/C9 rows marked `ADDED BY PHASE 10` |

## 3. Files changed

- Created `supabase/migrations/20261124000006_assessments.sql`.
- Created `supabase/functions/_shared/assessments.js`, `_shared/assessments.test.mjs`.
- Modified `supabase/functions/_shared/handlers.js` (assessment path in `publish-pack`) and `_shared/errors.js` (`denied`).
- Created `supabase/functions/{register-device,assessment-key,submit-assessment-attempts}/index.ts`.
- Created `packages/supabase-tests/test/assessments.test.mjs`.
- Created `apps/api/src/modules/judge/recheck-worker.ts`, `apps/api/src/tests/unit/recheck-worker.test.ts`; added `"recheck:worker"` to `apps/api/package.json`.
- Dashboard: modified `src/data/{types,source,supabase-source,test/mock-source}.ts`, `src/App.tsx`, `src/screens/teacher/TeacherAssessmentEditor.tsx`, `src/screens/student/StudentAssessments.tsx`, `src/app.test.tsx`, `e2e/dashboard.spec.ts`; created `src/screens/teacher/TeacherAssessmentResults.tsx`.
- Modified `supabase/README.md` and `docs/codex/offline-first/00-MASTER-PROMPT.md` (C8/C9 rows only).
- Created this report.

### Migration detail

- `submissions_insert` now requires `user_id = auth.uid() AND assessment_id IS NULL AND rls_can_read_course(course_id)`.
- `submissions_guard()` recreated identically to `00003` except that the late/re-check reset is skipped for `service_role`; authenticated callers still cannot set those fields.
- Index `submissions (assessment_id, user_id, question_id)`.
- `assessment_results` (`security_invoker`): best attempt per user/assessment/question (`ACCEPTED` first, then newest), `final_verdict` (`recheck_verdict` when `high_stakes` and `DONE`, else `verdict`), `late_status`, `recheck_status`, `attempts_used`, `question_points`, latest `score_override`, `points_earned` (late counts 0 unless overridden; high-stakes 0 until `DONE`).
- `assessment_user_results` (`security_invoker`): `questions`, `solved`, `score`, `pending_rechecks`, `max_attempts_used`.
- `claim_recheck()`: `security definer`, `SERVICE_ROLE_REQUIRED` unless `auth.role() = 'service_role'`, `FOR UPDATE SKIP LOCKED`; execute granted to `service_role` only.

### Broker detail

- `publish-pack { assessmentId }`: teacher of the class or college admin; `DRAFT`/`SCHEDULED` only; future `opens_at`; every question in the course and publishable. Key created once and reused before open; `ASSESSMENT` pack with encrypted hidden tests and the C5 block, signed, uploaded to `packs/assessment/{assessmentId}/{version}.lpack`; status `SCHEDULED`; after open `409 ASSESSMENT_STARTED`.
- `register-device`: upsert; a different key for an active device is `409 DEVICE_KEY_MISMATCH`.
- `assessment-key`: student member, registered non-revoked device, `SCHEDULED` and inside the window (`403 ASSESSMENT_NOT_OPEN`/`ASSESSMENT_CLOSED`); records `assessment_key_issues`; returns `{ keyId, keyB64, closesAt }`.
- `submit-assessment-attempts`: ≤ 20 (`413`); per attempt registered device, Ed25519 over the C7 canonical JSON (`SIGNATURE_INVALID`), `source_sha256`, question-in-assessment, `ATTEMPTS_EXCEEDED`, late rule (`ON_TIME`/`FINISHED_OFFLINE_SYNCED_LATE`/`LATE`), `recheck_status` `QUEUED`/`NOT_REQUIRED`, service-role `on conflict do nothing`; response `{ accepted, duplicates, rejected: [{ id, error }] }`.

### Re-check worker

`SupabaseRecheckStore` (REST + `claim_recheck`), `recheckOnce` (loads `question_tests`, requires `JUDGE_PROVIDER=judge0` behaviour and `provider === 'judge0'`, writes `recheck_verdict/passed/total/at` + `DONE`; requeue then `FAILED` after 3 tries), `startRecheckWorker` (requires `JUDGE_PROVIDER=judge0`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JUDGE0_URL`; optional `JUDGE0_AUTH_TOKEN`, `RECHECK_POLL_MS`; logs no source or test data).

### Dashboard

Schedule calls `publish-pack { assessmentId }` and shows `Pack v{n} scheduled.` New results screen `/teacher/assessments/:id/results` reads `assessment_results` + `assessment_user_results` + `kpi_assessment` flags, shows late labels, re-check badges (Pending / Checked / Failed / Not required), final verdict, attempts used and points, and writes `feedback.score_override` + `released`. Students see results only once the assessment is `CLOSED`.

## 4. Contract changes

- **C8:** `register-device`, `assessment-key`, `submit-assessment-attempts` (`ADDED BY PHASE 10`); `publish-pack` accepts `{ assessmentId }`.
- **Error codes:** `ASSESSMENT_NOT_FOUND`, `ASSESSMENT_NOT_SCHEDULABLE`, `ASSESSMENT_STARTED`, `NOT_PUBLISHABLE`, `QUESTION_COURSE_MISMATCH`, `ASSESSMENT_KEY_UNAVAILABLE`, `DEVICE_KEY_MISMATCH`, `DEVICE_NOT_REGISTERED`, `ASSESSMENT_NOT_OPEN`, `ASSESSMENT_CLOSED`, `SIGNATURE_INVALID`, `SOURCE_SHA256_MISMATCH`, `ATTEMPTS_EXCEEDED`, `QUESTION_NOT_IN_ASSESSMENT`, `INVALID_ATTEMPT`.
- **C9:** views `assessment_results`, `assessment_user_results`; `claim_recheck()` (service role only); `submissions (assessment_id, user_id, question_id)` index; tightened `submissions_insert` (`ADDED BY PHASE 10`).
- **C7 envelope:** the function accepts the attempt plus `source`/`signature`, camelCase or snake_case; the signed string is exactly `canonicalAttemptJson()`.
- **Statuses:** `late_status` ∈ `ON_TIME | FINISHED_OFFLINE_SYNCED_LATE | LATE`; `recheck_status` ∈ `NOT_REQUIRED | QUEUED | RUNNING | DONE | FAILED`.
- **Storage:** assessment packs at `packs/assessment/{assessmentId}/{version}.lpack` with detached signature; hidden tests only in `.hidden.enc` entries.

## 5. Integration notes for Claude

### The full assessment journey (numbered, for the end-to-end test)

1. Teacher creates an assessment draft (class, course, questions, window, duration, attempts, high stakes).
2. Teacher presses **Schedule** → `publish-pack { assessmentId }` → key created/reused, encrypted signed pack uploaded, status `SCHEDULED`.
3. Student desktop (after phase 05) lists the assessment and **Downloads** the pack before the window.
4. Desktop calls `register-device` once per device after login.
5. At `opens_at`, **Start** (online once) calls `assessment-key`; server records the issue and returns `{ keyId, keyB64, closesAt }`; the key goes to the OS keychain, hidden tests are decrypted in memory only.
6. Student solves offline; `SUBMIT` runs decrypted tests under local attempts/duration limits.
7. Attempts are signed (canonical JSON + `source_sha256`) and queued in the outbox with `assessment_id`.
8. Online, the desktop calls `submit-assessment-attempts` in batches ≤ 20; the server verifies device/signature/hash/question/attempts, labels `ON_TIME`/`FINISHED_OFFLINE_SYNCED_LATE`/`LATE`, and queues high-stakes re-checks.
9. Student sees own final results only after `CLOSED`.
10. The re-check worker claims `QUEUED` via `claim_recheck()`, runs `question_tests` through Judge0, writes `DONE` (or `FAILED` after 3 tries); never `ACCEPTED` without a real Judge0 result.
11. Teacher opens the results screen: late label, re-check badge, final verdict, attempts used, points, totals and `kpi_assessment` flags.
12. Teacher sets `score_override` and releases; `points_earned` reflects it.
13. Republishing before open keeps the key; after `opens_at` returns `409 ASSESSMENT_STARTED`.

Steps 3–8 are Blocked on phase 05.

### TODO markers in the code base

`rg "TODO\(offline-integration\)"` (code paths; spec/report occurrences omitted):

- `supabase/migrations/20261124000005_rls.sql:118` — `-- TODO(offline-integration): phase 10 late/recheck`. Intentionally left (earlier migrations are frozen); `0006` implements it.
- `apps/student-desktop/src-tauri/src/packs/question.rs:126` — `// TODO(offline-integration): phase 10 decrypt`.
- `apps/student-desktop/src-tauri/src/packs/question.rs:180` — `// TODO(offline-integration): phase 05 persists attempt here`.
- `apps/student-desktop/src-tauri/src/runtimes/install.rs:411` — `// TODO(offline-integration): switch smoke test to runner::run_tests`.
- `apps/student-desktop/src-tauri/src/runner/mod.rs:270` — `// TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode`.
- `apps/student-desktop/src/platform/CourseView.tsx:17` — solved state from persisted attempts (phase 05).
- `apps/student-desktop/src/lib/packs.ts:15,17` — broker catalog/download (phases 05/07).
- `oracle/atp/README.md:20` — OCI Vault secret reference for the ATP service key.

The phase 09 dashboard marker (`enable assessment scheduling in phase 10`) is resolved and removed.

### Configuration needed

- Supabase functions: existing secrets plus nothing new for the broker (`PACK_SIGNING_KEY`, OCI_*).
- Re-check worker: `JUDGE_PROVIDER=judge0`, `JUDGE0_URL`, optional `JUDGE0_AUTH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `RECHECK_POLL_MS`.
- Deploy the three new functions and apply `20261124000006_assessments.sql` after `0001`–`0005`.

## 6. Blocked items

- **Desktop assessment slice** needs phase 05 (`attempts.rs`, `device.rs`, `offline-sync.ts`, keychain device key, canonical attempt JSON + signing). Therefore `assessment.rs`, `AssessmentView.tsx`, `SUBMIT` decryption, `ASSESSMENT_LOCKED`/`ASSESSMENT_CLOSED`, local attempts/duration and attempt upload — and their Rust/TS tests — are not present.
- **Real Judge0 re-check** needs the college x86 Linux PC (`infra/judge/production/README.md`). Only mocked tests ran.
- **Live journey** needs the owner's Supabase project/secrets, OCI bucket and SMTP.

## 7. Commit

`feat(assessments): assessments, signed attempts and re-check (phase 10)`
