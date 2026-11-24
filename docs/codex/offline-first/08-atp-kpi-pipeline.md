# Phase 08 — KPI calculation: reference calculator and the Oracle ATP pipeline

Track B. It needs phase 06 (KPI tables). It does not need phases 05 or 07 to be finished. Read `00-MASTER-PROMPT.md` first; contracts C3, C9, C10 and C11 apply.

## Goal
Each night, Oracle ATP:
1. loads new raw activity files from Object Storage
2. pulls question and assessment metadata from Supabase
3. calculates the C11 KPIs for every affected student
4. pushes the results into the Supabase `kpi_*` tables

A JavaScript reference calculator defines the exact numbers and is the test oracle for the SQL. The SQL must give **identical** results on the same fixtures.

## Read first
- Master C10 (event format) and C11 (formulas): these are the specification.
- `supabase/migrations/*0004_kpi.sql` (phase 06): the target tables and their keys.
- Oracle documentation (current version for Autonomous Database Serverless):
  - `DBMS_CLOUD.CREATE_CREDENTIAL`, `LIST_OBJECTS`, `COPY_DATA` / `CREATE_EXTERNAL_TABLE` with JSON format and gzip compression
  - `DBMS_CLOUD.SEND_REQUEST`
  - `DBMS_NETWORK_ACL_ADMIN`
  - `DBMS_SCHEDULER`
  - `JSON_TABLE`
  
  Cite the doc page title in comments wherever you rely on a specific option.

## Allowed paths
- Create `packages/kpi-calc/**` (plain ESM + `.d.ts`, `node --test`, no runtime dependencies).
- Create `oracle/atp/sql/{001_setup_admin.sql,002_tables.sql,003_ingest.sql,004_dimensions.sql,005_kpi.sql,006_publish.sql,007_scheduler.sql}`.
- Create `oracle/atp/{README.md,verify.mjs,keepalive.mjs}`, `oracle/atp/package.json` (dependency `oracledb` 6, thin mode only; scripts `verify` and `keepalive`), and `oracle/atp/fixtures/**`.
- Create `.github/workflows/atp-keepalive.yml`.
- Modify `pnpm-workspace.yaml`, **only** to add `oracle/atp`. Say so in the report.
- Create `docs/codex/offline-first/reports/08-report.md`.

## Tasks
1. **`packages/kpi-calc`**, pure functions with no I/O:
   - `normaliseEvents(events)`: drops duplicate `eventId`s (keeps the first by `seq`) and invalid events (missing `userId`, `clientTs` or `eventType`). Returns the events sorted by `userId`, then `seq`.
   - `computeStudentDaily(events, { computedAt })` → `kpi_student_daily` rows (snake_case keys exactly as the table).
   - `computeStudentTopic(events, questionMeta, { computedAt })` → `kpi_student_topic` rows. `questionMeta` is `Map<questionId, { topics: string[], points: number }>`. Questions missing from the map are ignored, and their count is reported in a second return value `{ rows, skippedQuestions }`.
   - `computeAssessment(events, assessments, questionMeta, { computedAt })` → `kpi_assessment` rows. `assessments` is `Map<assessmentId, { organizationId, questionIds }>`.
   - Implement C11 exactly, including:
     - the 120 s gap cap
     - idle exclusion: a gap is zero when an `idle_period` event lies between the two events, or is the second event
     - rounding: half away from zero, done once at the end, never on intermediate values
     - UTC day grouping
     - `FAST_SOLVE` and the other flag rules
   - Write a `FORMULAS.md` restating each formula, with a worked example taken from a fixture.
2. **Fixtures (`oracle/atp/fixtures/`):**
   - `events-*.jsonl`, C10 lines written by hand; at least 6 files covering:
     - one normal student day
     - a day crossing midnight UTC
     - duplicate event IDs
     - idle periods
     - external and editor pastes
     - an assessment with the `HIGH_PASTE`, `FAST_SOLVE` and `MANY_FOCUS_LOSS` triggers
     - a question missing from the metadata
     - two orgs
   - `questions.json` and `assessments.json`: metadata.
   - `expected-*.json`: the expected rows. **Calculate them by hand** and show the arithmetic in `FORMULAS.md`, at least for the normal-day and assessment cases. Then confirm that `kpi-calc` matches them. Do not generate expected files from the code under test.
   - Fixtures are synthetic. Use obviously fake UUIDs (`00000000-0000-4000-8000-0000000000xx`). They are never loaded into a real tenant.
3. **ATP SQL** (Oracle 23ai; run as the schema user `LPKPI`, except `001`, which runs as `ADMIN`):
   - **`001_setup_admin.sql`**, a template with `&` substitution variables and **no secret values**:
     - Create user `LPKPI` with only the quota and grants it needs (`DBMS_CLOUD`, `DBMS_SCHEDULER` create job).
     - Network ACL: HTTPS to the Supabase host only.
     - `DBMS_CLOUD.CREATE_CREDENTIAL('LP_OCI_CRED', …)` using an OCI API key, or a resource principal if available (document both).
   - **`002_tables.sql`:**
     - `lp_ingested_files(object_name pk, etag, loaded_at, row_count)`
     - `lp_stg_activity(event_id pk, seq, event_type, client_ts timestamp with time zone, user_id, organization_id, device_id, pack_id, question_id, assessment_id, attempt_id, language, metadata json, object_name, loaded_at)`
     - `lp_dim_question(question_id pk, topics json, points)`
     - `lp_dim_assessment(assessment_id pk, organization_id, question_ids json)`
     - result tables mirroring the three Supabase `kpi_*` tables, plus `published_at` and `changed_at`
     - `lp_runs(run_id, started_at, finished_at, status, files_loaded, events_loaded, rows_published, error_text)`
     - `lp_secrets(name pk, value)`, which **the owner fills by hand** with the Supabase service key. There are no grants on it, and only the publish package reads it. Document how to use OCI Vault instead, with `TODO(offline-integration)`.
   - **`003_ingest.sql`, package `lp_ingest`:**
     - `load_new_files(p_prefix default 'raw/activity/')` lists objects, skips files already in `lp_ingested_files`, and loads each new gzip JSONL into staging. Use `COPY_DATA` or an external table with JSON format and `compression 'gzip'`, and say in a comment which one and why.
     - Duplicate `event_id`s are ignored (merge).
     - Each file is committed separately, so one bad file does not block the others. A bad file is recorded in `lp_runs.error_text` and skipped. It is not marked ingested, so it is retried next night.
   - **`004_dimensions.sql`, package `lp_dims`:** `refresh()` fetches `questions?select=id,topics,points` and `assessments?select=id,organization_id,question_ids` from Supabase PostgREST with `SEND_REQUEST` (paged with `Range` headers, 1,000 rows per page) and merges them into the dimension tables.
   - **`005_kpi.sql`, package `lp_kpi`:** `compute_changed(p_since timestamp)` recomputes **only** the users and days touched by events loaded since `p_since`.
     - It deletes and reinserts those rows in the result tables, setting `changed_at`.
     - The formulas follow C11 and the reference calculator line by line. Use window functions (`LAG` over `seq`) for gaps.
     - Topic and assessment KPIs are recomputed for every affected user over all time.
   - **`006_publish.sql`, package `lp_publish`:** `push_changed()` sends rows where `changed_at > published_at` (or `published_at` is null) to Supabase.
     - Use `POST /rest/v1/<table>?on_conflict=<pk columns>` with `Prefer: resolution=merge-duplicates,return=minimal`, in batches of 500 rows built with `JSON_ARRAYAGG`.
     - Headers are `apikey` and `Authorization: Bearer` with the key from `lp_secrets`.
     - On HTTP 2xx, set `published_at`. On any other status, stop, record the status and the first 500 characters of the body (with the key removed) in `lp_runs`, and leave the rows for the next run.
   - **`007_scheduler.sql`:** job `LP_NIGHTLY` daily at 01:30 `Asia/Kolkata` runs `lp_ingest.load_new_files` → `lp_dims.refresh` → `lp_kpi.compute_changed(last successful run start)` → `lp_publish.push_changed`, recording `lp_runs`. Also a procedure `lp_run_now` for manual runs.
4. **`oracle/atp/verify.mjs`** (needs owner credentials; skips with exit code 0 and a clear "SKIPPED: set ATP_* env" message otherwise):
   - Connects with `oracledb` thin mode using `ATP_USER`, `ATP_PASSWORD` and `ATP_CONNECT_STRING` (TLS, walletless).
   - Inserts the fixtures directly into `lp_stg_activity` and the dimension tables of a **separate verification schema**, `LPKPI_VERIFY`, created by the README's steps. It must never touch `LPKPI`.
   - Runs `lp_kpi.compute_changed`, reads the result tables and compares them field by field with `kpi-calc` output for the same fixtures. Exit 1 on any difference, printing a diff.
5. **Keep-alive:**
   - `oracle/atp/keepalive.mjs` runs `select 1 from dual` with the same env vars.
   - `.github/workflows/atp-keepalive.yml` runs it daily (cron `17 3 * * *`) plus `workflow_dispatch`, with secrets `ATP_USER`, `ATP_PASSWORD` and `ATP_CONNECT_STRING`.
   - The workflow does nothing else and prints no secrets.
   - In the README, note that Oracle's idle rule must be confirmed after 8 days of real use (**Blocked** until then).
6. **README:**
   - Order of setup.
   - Exactly what the owner must create in the Oracle console: credential, ACL, schema users, `lp_secrets` row, scheduler.
   - How to run a manual backfill (`lp_run_now`).
   - How to read `lp_runs`.
   - The `pg_cron` fallback: it is the same formulas as `kpi-calc`, written in Supabase SQL. Spec only; do not implement it in this phase.

## Tests
- `pnpm --filter @lplatform/kpi-calc test`:
  - Every fixture equals its expected file.
  - Property tests:
    - Shuffling the event order gives identical output (because of the sort).
    - Duplicating every event gives identical output.
    - `paste_ratio` is in [0, 1].
    - `mastery` is in [0, 100].
    - `active_minutes` ≤ the span of the day.
  - Rounding edge cases: 0.05 rounds to 0.1; 0.0005 to 0.001.
- **SQL static checks (no ATP needed), as a node test in `packages/kpi-calc` or `oracle/atp`:**
  - Every SQL file parses as a list of statements split on `/` and `;` with your simple splitter.
  - No literal key, password or `eyJ` (JWT) text appears.
  - Every `SEND_REQUEST` uses `lp_secrets`.
  - Table and column names used in `006_publish.sql` match the phase 06 migration (parse both files and compare the column lists).
- `oracle/atp/verify.mjs`: **Blocked** until the owner provides ATP access. When it runs, all fixtures must match.

## Verification
```
pnpm --filter @lplatform/kpi-calc test
node oracle/atp/verify.mjs        # prints SKIPPED without ATP_* env
```
Plus master §7.

## Must not
- No secrets in SQL, fixtures, the workflow or logs.
- No writes to Supabase tables other than the three `kpi_*` tables.
- No reading of submission source code. ATP works only from activity events and metadata.
- No production data in fixtures.

## Integration notes to leave
- The owner checklist with the exact order.
- Which `DBMS_CLOUD` load method you chose.
- Measured run time for the fixtures, if ATP was available.
- Anything in C11 that was ambiguous, and how you resolved it. Claude reviews these.
