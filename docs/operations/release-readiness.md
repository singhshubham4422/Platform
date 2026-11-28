# Release readiness — 2026-11-20

| Task / gate | Status | Exact command and result (2026-11-20) |
| --- | --- | --- |
| Branch and workspace | Verified | `git switch -c release/rc1` → switched from `main`; initial tree clean at `2579d23`. No `.env` or `infra/judge/judge0.env`. |
| Frozen dependency install | Verified | `pnpm install --frozen-lockfile` → lockfile passes supply-chain policies (857 entries); done with pnpm 12.18.0. |
| Task 1: real Judge0 on supported Linux | Blocked | No Ubuntu VM/SSH target was configured or supplied. Docker Desktop/WSL2 previously failed required cgroups and real submissions. Do not enable student execution. Need the VM and access listed below. |
| Task 1: API acceptance, sandbox escape tests, backup/restore | Blocked | Not run: depends on supported Linux Judge0 VM. Prior local-provider tests are not sandbox evidence. |
| Task 2: Mailpit OTP and invite integration | Incomplete | Docker/Mailpit not started; requested `email-smtp.test.ts` is absent. SMTP delivery is not verified. No SMTP credentials supplied. |
| Task 2: real SMTP provider | Blocked | No SMTP host/port/TLS/auth credentials or test mailbox supplied. |
| Task 3: OCI signing fixture/quota tests | Incomplete | Source inspected with `Get-Content apps/api/src/modules/files/storage.ts` and `Get-Content apps/api/src/integrations/oci.ts`; PUT signature currently signs only `(request-target) date host`, while request sends content-type/content-length. No signature fixture or quota test was added in this run. |
| Task 3: real OCI access | Blocked | No non-production bucket, OCI API key, or credentials supplied. |
| Task 4: Rust static checks | Verified | `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` → exit 0. |
| Task 4: Rust tests | Verified | `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` → 6 passed, 0 failed. |
| Task 4: Windows x64 Tauri package build | Verified | After changing `apps/student-desktop/rust-toolchain.toml` from the broken 1.99.1 toolchain to installed stable, `pnpm --filter @platform/student-desktop tauri build` → exit 0; MSI 5.17 MiB and NSIS 3.86 MiB produced. Both are unsigned. |
| Task 4: install and manual offline/restart/sync acceptance | Incomplete | No install/hand test was performed; cannot claim OTP, offline drafts, queued submission or token-free `%APPDATA%/com.platform.student/platform.db` was verified in a packaged app. |
| Task 5: full dark/mobile web E2E | Incomplete | Not run in this pass. The earlier seven-spec run against `127.0.0.1` failed three auth navigations; current Playwright config uses `localhost`, but required production-build live-API run and expanded dark/390px journey still need execution. |
| Task 6: remote terminal | Disabled for safety | No dedicated isolated Linux host/session broker exists. No terminal exposed. |
| Lint | Verified | `pnpm lint` → all package lint scripts passed. |
| Typecheck | Verified | `pnpm typecheck` → API, web, desktop passed. |
| Unit tests | Verified | `pnpm test` → language-config 4, API 27, desktop 25, web 58 passed. |
| PostgreSQL integration/RLS | Verified | `pnpm test:integration` → migrations and dev fixtures succeeded on isolated local PostgreSQL; 24 tests passed. This used test/dev data only. |
| Production build | Verified | `pnpm build` → API TypeScript, web Next.js (51 pages), and desktop Vite builds passed. Monaco remains a lazy 3.28 MB chunk. |
| Production dependency audit | Incomplete | `pnpm audit --prod` → 22 findings (1 low, 16 moderate, 5 high); high findings include Nodemailer address parser DoS (patched release ≥7.0.11) and Nodemailer SMTP response injection (patched release ≥8.0.4). No dependency upgrade attempted. |
| Security route/response/log review | Incomplete | Integration output was inspected; a complete student-endpoint hidden-test walk and API-log secret/source grep were not run. No auth/RLS/file validation controls were weakened. |
| Git state | Verified | Baseline `git status --short --branch` → clean `## main`; `git log -1 --oneline` → `2579d23 docs: add strict Codex handoff prompt for release candidate work`; working branch is `release/rc1`. No commit made. |

## What is needed to unblock

- **Judge0:** dedicated Ubuntu 22.04 x86_64 VM, 4+ vCPU, 8+ GiB RAM, 50 GiB disk, booted with required cgroup v1 and swap accounting; private IP; SSH access for the operator; firewall access from the API host; a private API-to-Judge0 path. Do not send credentials in chat or commit them. Configure secrets directly on the relevant hosts.
- **SMTP:** SMTP hostname, port, TLS mode, username/password or provider credential, sender identity, and a test mailbox. Keep credentials in deployment secret storage.
- **OCI:** non-production bucket/namespace/region and API signing key/user/tenancy configuration, provided through a secret-safe channel.
- **Tauri:** install a valid stable Rust toolchain with cargo/rustc and required Windows WebView2/MSVC build prerequisites; then build/install and perform the offline restart/sync test.

DECISION: NO-GO — real isolated Judge0 (Task 1) is Blocked and packaged desktop manual acceptance (Task 4) is incomplete. Required user inputs: dedicated Ubuntu 22.04 VM with private IP and SSH access; SMTP credentials/test mailbox; non-production OCI bucket and API signing credentials. Student execution remains Disabled for safety.
