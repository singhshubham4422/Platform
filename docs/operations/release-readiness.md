# Release readiness — 2026-11-20

**Decision: NO-GO for real student use.** Do not enable student code execution until a supported Linux Judge0 host passes the acceptance steps in `infra/judge/production/README.md`. Every other blocker below is either fixed and verified, or explicitly blocked by missing infrastructure or credentials.

Status terms: **Verified** (real test passed, evidence below) · **Implemented, not verified** · **Incomplete** · **Blocked** (environment/credentials) · **Disabled for safety**.

| Area | Status | Evidence / blocker |
| --- | --- | --- |
| Owner, faculty and college-admin web sign-in, reload, sign-out | **Verified** | `apps/web/e2e/roles-and-pages.spec.ts` passes against the production build and a live API |
| Root cause of the "toast then /login" defect | **Fixed, verified** | Next.js normalises loopback hosts in redirects (`127.0.0.1` → `localhost`). The E2E browser used `127.0.0.1`, so each server redirect dropped the per-host session. E2E now browses `localhost` consistently and runs `next build && next start`. Auth code was not weakened. |
| Existing browser workflows (owner golden path, teacher authoring and grading, student blocked from web, developer restrictions) | **Verified** | All 7 legacy specs pass |
| Cross-role route guard; refresh-token revocation after logout | **Verified** | E2E: faculty redirected away from `/admin/academic`; refresh after logout returns 401 |
| Visual QA (21 role pages × 1366×768, 1440×900, 1920×1080) | **Verified for render, overflow and uncaught errors**; reviewed manually for key pages | Screenshots in `apps/web/test-results/screens/<role>/<viewport>/` (regenerated per run, not committed). Fixed: the HOD role label. Not checked yet: dark theme, and narrow/mobile widths for every page. |
| PostgreSQL integration and RLS (tenant isolation, roles, workflows) | **Verified** | 24/24 integration tests on real PostgreSQL 18 |
| Unit, lint, typecheck, builds | **Verified** | API 27, web 58, desktop 25, language-config 4. Rust: 6 tests and clippy clean. |
| Production data: no demo or test data | **Verified** | `db:seed:dev` refuses `NODE_ENV=production`. `pnpm db:bootstrap` creates only the platform owner, tested on an empty database (1 user, 0 organizations). It rejects weak passwords and demo domains. |
| Real isolated judge (Judge0 CE 1.13.1) | **Blocked** | Needs a Linux VM with cgroup v1. Docker Desktop/WSL2 lacks the memory, cpuacct and cpuset controllers. The deployment kit, preflight, isolation check, backup and restore scripts are in `infra/judge/production/`. `ENABLE_STUDENT_EXECUTION` defaults to false, and the API returns 503 when Judge0 is unhealthy. |
| Hidden-test evaluation and four-language execution | **Verified with the local development provider only** | The acceptance test runs Python/C/C++/Java through the separate worker using `local-unsandboxed-dev`, which production refuses. Production verification is **Blocked** (row above). |
| Desktop SQLite persistence (drafts, outbox, course manifests, notes, cursors, migrations, legacy import) | **Verified (unit and integration level)** | Rust tests cover idempotent migrations, per-language drafts, revisions, outbox idempotency, backoff, reopen persistence and one-time legacy import. TypeScript tests cover restart, exactly-once flush, backoff, permanent rejection and auth pause. **Not yet run:** a packaged Tauri installer exercised by hand. |
| Auth secrets in the OS vault, not SQLite | **Implemented** | Windows Credential Manager via the existing `keyring` code. macOS and Linux keep the session in memory only (sign in again after restart). |
| Interactive remote terminal | **Disabled for safety** | No isolated session broker exists. The UI shows that it is unavailable, and no shell is exposed anywhere. |
| OCI Object Storage | **Implemented, not verified** (Blocked: no credentials) | Local private storage is tested with real uploads, downloads, checksums and type sniffing. |
| SMTP e-mail (OTP, invitations, notifications) | **Implemented, not verified against a real provider** | The dev-outbox provider is verified end to end (OTP and invitation acceptance). Mailpit and real SMTP were not run because Docker was not running. |
| Unified CI on GitHub | **Implemented, not run on GitHub** | `.github/workflows/ci.yml`. No remote is configured. |
| Desktop installer build and signing | **Incomplete** | `tauri build` was not run. Installers are unsigned until release credentials exist. |

## To reach GO

1. Provision the Judge0 VM. Run `preflight.sh`, then `verify-isolation.sh`, then `pnpm test:judge0`. Record the evidence.
2. Point the API at it and set `ENABLE_STUDENT_EXECUTION=true`. Rerun the acceptance workflow against real Judge0.
3. Send real SMTP to a test mailbox (OTP and invitation). Run a real OCI upload/download in a non-production bucket.
4. Build and hand-test the signed desktop installer: offline draft, restart, reconnect and sync.
5. Rehearse a restore of the platform PostgreSQL and the Judge0 database.
6. Get privacy and legal review of the student-activity disclosure and the data-retention policy (`docs/security/data-retention.md`).
