# Oracle ATP KPI pipeline

The reference arithmetic is in `packages/kpi-calc` and the deployment SQL is under `oracle/atp/sql`. SQL has not been compiled on ATP in this environment; the SQL static checks are not a substitute for the isolated-schema verification run.

## Owner setup order

1. Create an Oracle Autonomous Database Serverless instance on the 23ai compatible service. Create the private Object Storage bucket with the activity lifecycle policy from the Phase 07 broker README. Keep the bucket URL, namespace and region handy.
2. In `001_setup_admin.sql`, provide interactive SQL*Plus substitutions for `lpkpi_password`, `supabase_host`, `oci_user_ocid`, `oci_tenancy_ocid`, `oci_fingerprint`, and `oci_private_key_pem`; run the file as `ADMIN`. It creates the least-privilege `LPKPI` schema, applies HTTPS ACL access only to the Supabase project host, and creates an OCI signing-key credential. For resource principal use, enable the database resource principal, grant the database dynamic group Object Storage read access, and configure `OCI_CREDENTIAL_NAME` as `OCI$RESOURCE_PRINCIPAL` instead of `LP_OCI_CRED`.
3. Connect as `LPKPI` and run `002_tables.sql` through `007_scheduler.sql` in numeric order. Keep the activity URI rooted at the Object Storage `.../o/` prefix. `lp_ingest` uses `DBMS_CLOUD.COPY_DATA` with JSON `columnpath` mapping and gzip compression; a per-file load table lets it merge event IDs and commit each object independently.
4. Insert the owner-provided values into `lp_secrets` by hand. There are no table grants; the definer-rights pipeline packages read the named rows. Example only:

   ```sql
   INSERT INTO lp_secrets(name,value) VALUES('OCI_CREDENTIAL_NAME','LP_OCI_CRED');
   INSERT INTO lp_secrets(name,value) VALUES('OCI_ACTIVITY_URI','https://objectstorage.<region>.oraclecloud.com/n/<namespace>/b/<bucket>/o/');
   INSERT INTO lp_secrets(name,value) VALUES('SUPABASE_REST_URL','https://<project-ref>.supabase.co/rest/v1');
   INSERT INTO lp_secrets(name,value) VALUES('SUPABASE_SERVICE_KEY','<Supabase service-role key>');
   COMMIT;
   ```

   Keep the service key out of SQL files and console history; in production prefer Oracle Vault with the `DBMS_CLOUD` Vault credential integration. `TODO(offline-integration): replace the manually inserted Supabase service key with an OCI Vault secret reference.`
5. For verification, as `ADMIN` create a separate `LPKPI_VERIFY` user with an interactive placeholder password, a quota, and only `CREATE SESSION`, `CREATE TABLE`, `CREATE VIEW`, and `CREATE PROCEDURE`; grant `EXECUTE ON DBMS_CLOUD` only if running `004_dimensions.sql`. Run `002_tables.sql` and `005_kpi.sql` as that user. Do not point `verify.mjs` at `LPKPI`. Set `ATP_USER=LPKPI_VERIFY`, `ATP_PASSWORD`, and a TLS `ATP_CONNECT_STRING` (walletless TCPS) in the shell, then run `node oracle/atp/verify.mjs`. With any required env unset it exits 0 with a clear `SKIPPED` message. It loads synthetic fixtures only into the verification schema and compares the SQL rows to the JS reference calculator.
6. Configure the GitHub repository secrets `ATP_USER`, `ATP_PASSWORD`, and `ATP_CONNECT_STRING` for the daily keep-alive workflow. Use an account allowed to run `SELECT 1 FROM DUAL`.

## Operations

- Manual backfill: run `BEGIN lp_run_now; END; /`. It starts from the prior successful pipeline run timestamp and reloads any unrecorded Object Storage files.
- Read `SELECT * FROM lp_runs ORDER BY run_id DESC` for start/finish times, status, files/events loaded, rows published, and sanitized error text. A bad activity object is logged separately and left unmarked so the next run retries it.
- `LP_NIGHTLY` runs at 01:30 `Asia/Kolkata`; the keep-alive workflow runs at 03:17 UTC and does only a `select 1 from dual` query. Confirm the Autonomous Database idle-stop rule after eight days of real use (**Blocked** until then).
- The `pg_cron` fallback is specification only: port the same `packages/kpi-calc` formulas into Supabase SQL and write only the three `kpi_*` tables. It is not implemented here.

## Oracle option references

SQL comments point to the Oracle documentation titles used for the concrete APIs: `CREATE_CREDENTIAL Procedure`, `DBMS_NETWORK_ACL_ADMIN`, `DBMS_CLOUD Package Format Options`, `Load Data into Autonomous AI Database from Oracle Cloud Infrastructure Object Storage`, `Call Web Services from Autonomous AI Database`, `SEND_REQUEST Function and Procedure`, and `DBMS_SCHEDULER`. `DBMS_CLOUD.COPY_DATA` was selected over an external table because each compressed file is loaded once into a per-file staging table and committed independently.

The fixture verification runtime could not be measured against ATP because the owner has not provided ATP access.
