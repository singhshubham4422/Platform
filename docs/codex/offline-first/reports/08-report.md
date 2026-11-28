# Phase 08 report — KPI reference calculator and ATP pipeline

Written by Claude, 2026-11-25. Codex wrote the files during its run but left them uncommitted with no report. Claude reviewed them, fixed two problems and finished the phase.

## 1. Summary
- `packages/kpi-calc` implements C11 as pure functions, with hand-calculated fixtures in `oracle/atp/fixtures/`.
- The ATP SQL (`oracle/atp/sql/001`–`007`) covers the admin setup template, staging, gzip JSONL ingest, Supabase dimension fetch, KPI computation, publishing to Supabase and the nightly job.
- `verify.mjs` compares the ATP results with `kpi-calc` in an isolated `LPKPI_VERIFY` schema. `keepalive.mjs` and a GitHub Actions workflow ping ATP daily.
- No ATP access was available, so the SQL has not been run on Oracle.

## 2. Status table
| Task | Status | Command | Result |
| --- | --- | --- | --- |
| Reference calculator + fixtures | Verified | `pnpm --filter @platform/kpi-calc test` | 7 pass, 0 fail |
| SQL static checks (no secrets, columns match the Supabase migration, `lp_secrets` used) | Verified | same | included in the 7 |
| ATP SQL executes and matches `kpi-calc` | Blocked | `node oracle/atp/verify.mjs` | `SKIPPED: set ATP_* env` (exit 0) |
| Keep-alive workflow | Implemented, not verified | – | needs GitHub secrets and a repo with Actions |
| Free ATP idle rule confirmed after 8 days | Blocked | – | needs real use |
| Frozen install | Verified | `pnpm install --frozen-lockfile` | Done (after adding `oracledb: false` to `allowBuilds`) |

## 3. Files changed
- `packages/kpi-calc/**`
- `oracle/atp/**`
- `.github/workflows/atp-keepalive.yml`
- `pnpm-workspace.yaml`: added `oracle/atp`, and `allowBuilds.oracledb: false` (thin mode needs no install script; without this the frozen install fails).
- `pnpm-lock.yaml`

## 4. Contract changes
None.

## 5. Integration notes for Claude
- **Fix 1:** `FAST_SOLVE` in SQL compared with *any* `question_opened`, but the JS used the first one. SQL now uses the first opening by `seq`, matching C11 ("that question's `question_opened`").
- **Fix 2:** in JS, a question with no `code_changed` events was never flagged, because `undefined < 50` is false. It is now counted as 0 typed characters. A test covers both fixes.
- **Load method:** `DBMS_CLOUD.COPY_DATA` (JSON `columnpath`, `compression: gzip`) into the disposable table `lp_load_activity`, then a `MERGE` into `lp_stg_activity`, committed per file.
- **Known difference:** JS also skips a gap whose time range contains an `idle_period` that is not adjacent by `seq`. SQL only skips the gap that ends at an `idle_period`. These agree whenever `seq` order equals time order, which the desktop guarantees, because `seq` is assigned when an event is stored.
- **Null org:** KPI rows need `organization_id`. Events from a user without an org (the platform owner) would fail the insert. Students always have an org.
- **`lp_runs`:** each package writes its own run rows. `lp_run_now` picks `p_since` from the latest `OK` run. That works, but the rows are verbose; consider tagging the run type later.
- **Secrets the owner inserts into `lp_secrets`:** `OCI_CREDENTIAL_NAME`, `OCI_ACTIVITY_URI`, `SUPABASE_REST_URL`, `SUPABASE_SERVICE_KEY` (see `oracle/atp/README.md`).

## 6. Blocked items
- An ATP schema (`LPKPI_VERIFY`) with a walletless TLS connect string, to run `verify.mjs`.
- The production `LPKPI` setup in the Oracle console, following the README order.
- GitHub secrets `ATP_USER`, `ATP_PASSWORD` and `ATP_CONNECT_STRING` for the keep-alive.

## 7. Commit
`feat(atp): KPI reference calculator and ATP pipeline (phase 08)`
