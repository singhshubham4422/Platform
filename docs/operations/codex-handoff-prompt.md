# STRICT TASK: TAKE L_PLATFORM FROM NO-GO TO VERIFIED RELEASE CANDIDATE

You are working in `C:\Users\sshub\Videos\Platform`, a pnpm monorepo with a local Git repository (baseline commit `32ca8ea`, no remote).
Read these files first, in order. Do not start work until you have read them.
1. `docs/operations/release-readiness.md` (current truth table)
2. `docs/operations/known-limitations.md`
3. `infra/judge/production/README.md`
4. `README.md`, `docs/development/local-development-guide.md`
5. `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `apps/student-desktop/AGENTS.md`

## Non-negotiable rules
- Do NOT rewrite, move or rename existing modules. Make focused changes only.
- Do NOT weaken authentication, RLS policies, route guards, rate limits or file validation to make a test pass.
- Do NOT enable student code execution (`ENABLE_STUDENT_EXECUTION`) unless every step of Task 1 has passed on a real Linux host. Never use `local-unsandboxed-dev` outside local development. Never disable Isolate, cgroups or resource limits.
- Do NOT add demo or test data to any production path. `db:seed:dev` is for development and tests only. Production uses `pnpm db:bootstrap`.
- Do NOT commit secrets, `.env`, `judge0.env`, `judge0.conf`, private keys or credentials. Do NOT print tokens or passwords in logs or reports.
- Do NOT delete migrations, `content/`, `docs/`, backups (`C:\Users\sshub\Videos\Platform_premerge_backup_2026-11-20.tar.gz`) or `C:\Users\sshub\Music\J_Platform`.
- Do NOT run `docker compose down -v` or any command that deletes volumes or databases you did not create in this task.
- Do NOT push, add a Git remote, or force anything. Commit locally on a branch `release/rc1` with Conventional Commit messages, one commit per task.
- Stop only processes you started, identified by PID and command line.
- Never mark something "done" because it builds. Status words allowed: Verified / Implemented, not verified / Incomplete / Blocked / Disabled for safety. Each "Verified" needs an exact command and its output in the report.
- If a task needs a server or credentials you do not have, finish everything else in that task. Then mark it **Blocked**, state exactly what the user must provide, and continue with the next task. Do not stop the whole run.

## Required checks before every commit (all must pass)
```
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration          # starts local Postgres on 54330 via scripts/local-postgres.mjs
cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings
cargo +stable test  --manifest-path apps/student-desktop/Cargo.toml
pnpm build
```
Run the browser E2E with the API running against the dev DB (see `docs/development/local-development-guide.md`):
`cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:3001 npx playwright test`
Always use `localhost`, never `127.0.0.1`, for web and API in E2E. Next.js rewrites loopback hosts in redirects, and sessions are per-host.

## Task 1 — Real isolated Judge0 (CRITICAL; needs user-provided Ubuntu 22.04 VM)
If an SSH target is available:
1. Follow `infra/judge/production/README.md` exactly (cgroup v1 GRUB change, firewall, install).
2. Run `scripts/preflight.sh`. It must print `Preflight PASSED`.
3. Run `scripts/verify-isolation.sh`. All four Hello World programs (Python, C, C++, Java) must PASS. Record the Isolate version.
4. On the API side set `JUDGE_PROVIDER=judge0`, `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN` (AUTHN token only) and run `pnpm test:judge0`. Required results through the platform API: correct output, wrong answer, compile error (C/C++/Java), runtime error, time limit, memory limit, output limit, hidden-test confidentiality (student never receives hidden input/output), and 503 when Judge0 is stopped.
5. Run `apps/api/src/tests/integration/acceptance-workflow.test.ts` with the worker pointed at real Judge0 instead of `local-unsandboxed-dev`. Add an env switch for this; do not edit the test's assertions.
6. Try to escape the sandbox from a submission: read `/etc/passwd` of the host, reach `169.254.169.254`, reach the Judge0 Postgres or Redis, run a fork bomb. All must fail or be limited. Record the results.
7. Test `scripts/backup.sh` and `scripts/restore.sh` once.
Only after steps 1–7 pass: document the evidence in `docs/operations/judge-verification.md`. Leave `ENABLE_STUDENT_EXECUTION=false` in `.env.example` (it is a per-deployment switch).
If no VM is available: mark **Blocked** and list exactly what is needed (VM spec, private IP, SSH access).

## Task 2 — Real email (needs SMTP credentials, or use Mailpit for the local part)
1. Start Mailpit via `pnpm infra:up` (Docker Desktop required) and set `EMAIL_PROVIDER=smtp`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`.
2. Add `apps/api/src/tests/integration/email-smtp.test.ts`. It requests a student OTP and a faculty invitation, then reads the Mailpit API (`http://127.0.0.1:8025/api/v1/messages`) and asserts the message arrived. It verifies the OTP signs in and the invitation token is accepted. The test is skipped unless `MAILPIT_URL` is set.
3. Make sure `sendEmail` failures are surfaced: the invitation API must return `emailDelivered:false`, and the OTP endpoint must not claim success to the user when delivery fails. Keep the response generic so no account enumeration is possible, and log the delivery failure server-side without the code.
4. Real provider: if SMTP credentials are given, send one OTP to a test mailbox and record the provider message id. Otherwise mark **Blocked**.

## Task 3 — OCI Object Storage (needs non-production bucket + API key)
1. Review `apps/api/src/modules/files/storage.ts` and `apps/api/src/integrations/oci.ts`. OCI PUT signing must include the headers OCI requires for the request type. Add unit tests that compute a signature against a known fixture.
2. Enforce the organization storage quota (`subscription_plans.storage_gb`) on upload. Add a test.
3. With credentials: upload, download, confirm the object is private (unsigned GET returns 401/404), an expired download token is refused, and deletion and retention behave correctly. Without credentials: **Blocked**.

## Task 4 — Desktop release build
1. Run `pnpm --filter @lplatform/student-desktop tauri build` on Windows x64. Fix build errors without changing behaviour.
2. Install the MSI or NSIS build and test by hand: OTP sign-in → open assignment → write code offline → quit → reopen (draft present) → reconnect → queued submission shows "waiting to upload" then a server result. Confirm `%APPDATA%/com.lplatform.student/lplatform.db` exists and contains no tokens (`sqlite3 … ".dump" | findstr /i token` must be empty).
3. Expose personal notes (already in `store.rs` as `store_save_note`/`store_list_notes`) in the course view. Add tests.
4. Keep installers unsigned unless signing credentials are provided. Never describe them as signed.

## Task 5 — Remaining web QA
1. Extend `apps/web/e2e/roles-and-pages.spec.ts` to also run in the dark theme and at a 390×844 viewport. Fix any overflow, contrast or broken dialog it finds.
2. Add an E2E test that opens and submits each create dialog on `/admin/academic` and `/admin/platform/subscriptions` (use unique names; clean up through the API).
3. Add a full-journey E2E: owner creates college → invite accepted → admin builds the hierarchy → faculty creates a coding question with hidden tests and publishes → (student part via API with OTP) → faculty grades and releases → college analytics shows the result. Code execution steps run only when `JUDGE0_URL` is set; otherwise the test asserts the API returns 503 for run/submit and continues with grading of a manually graded question.

## Task 6 — Remote terminal (keep disabled unless isolation is proven)
Implement only if a dedicated isolated Linux host exists: session broker with per-session unprivileged containers or microVMs, no Docker socket, no host mounts, network off, CPU/memory/pids/disk/wall-clock limits, idle and disconnect cleanup, WebSocket auth with origin check, and per-user quotas. Endpoints: `POST/GET/DELETE /api/terminal/sessions[/:id]`, `WS /api/terminal/sessions/:id/stream`, plus the security tests listed in `docs/operations/release-readiness.md`. Otherwise leave it **Disabled for safety** and change nothing.

## Task 7 — Security pass
- Grep the API for any route missing `authenticate`/`requireRole` that touches tenant data. Add tests for anything you fix.
- Confirm hidden test cases and `reference_solution` never appear in any student-facing response (add a test that walks every student GET endpoint used by the desktop app).
- Confirm logs contain no OTPs, tokens or full source code (`grep` the API logs after running the integration suite).
- Run `pnpm audit --prod` and fix critical/high issues where a non-breaking upgrade exists. List the rest.

## Final report (write to `docs/operations/release-readiness.md`, replacing the table)
For every row: status word, exact command, result summary, date. End with a single line: `DECISION: GO` only if Tasks 1–4 are Verified and Task 6 is Verified or Disabled for safety. Otherwise `DECISION: NO-GO`, followed by the precise list of what the user must provide.
