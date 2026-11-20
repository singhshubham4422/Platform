# Merge status (2026-11-20, in progress)

This records what was actually done. It is not a completion claim.

## Continuation work (2026-11-20)

- Confirmed the workspace has no `.git` metadata. There is no trustworthy Git status or commit history available in this working copy; no Git commands that mutate state were used.
- Hardened judge selection: production rejects absent/unknown providers and the explicit local unsandboxed fixture; API startup requires reachable Judge0 and Python/C/C++/Java; run and programming-submit endpoints require `ENABLE_STUDENT_EXECUTION=true` and a healthy Judge0, otherwise return 503. The flag defaults false.
- Added a real-Judge0-only acceptance suite. Judge0 CE v1.13.1 plus pinned PostgreSQL/Redis started on Docker Desktop and reported healthy. The API `/languages` check succeeded, but real Python/C/C++/Java submissions failed. Inside the worker, `isolate-check-environment` reported memory, cpuacct, and cpuset cgroups absent; this Docker Desktop/WSL2 cgroup-v2 host cannot enforce CE 1.13.1 resource limits. Production student execution remains disabled.
- Added root developer Compose, `.env.example`, scripts/docs, and a pinned CI workflow. Compose configuration validates locally. The project test PostgreSQL workflow passed 24/24 integration tests (including RLS); the local test cluster was stopped afterward.
- Lazy-loaded the Monaco programming workspace and split Monaco into a separate chunk. The desktop initial JavaScript is 372 KB (109 KB gzip); Monaco is a deferred 3.28 MB chunk (843 KB gzip). Added an explicit terminal-unavailable state.
- Root unit tests pass (language config 4, API 27, desktop 23, web 58); root lint, typecheck and production builds pass. PostgreSQL integration/RLS tests pass 24/24.
- The seven existing Playwright tests were run with Chromium installed: four unauthenticated/invalid-login checks pass. Three signed-in owner/teacher flows fail because the browser stays on `/login` after the login success toast. This is an unresolved auth/session navigation defect.
- Visual inspection was not completed because BrowserOS neo was unavailable. Native desktop SQLite was not implemented. OCI credentials were unavailable. The remote terminal remains unavailable. These are release blockers, not completion claims.
- Temporary API, project PostgreSQL, Judge0 Compose services and Docker Desktop were stopped. Generated Judge0 credentials were deleted; the data volume was preserved. No local listener remained on the checked project ports.

## Release-readiness sprint (2026-11-20)

- Fixed the authenticated-browser defect (loopback redirect host). Added a role/page/viewport Playwright spec. All browser specs pass against the production build.
- Added production bootstrap (owner only). The demo seeder now always refuses production.
- Added the Linux Judge0 production kit (`infra/judge/production/`). Real isolated execution is still blocked on infrastructure.
- Added native SQLite persistence for the student desktop, with Rust and TypeScript tests.
- Fixed root `dev` and `clean` scripts that pointed at missing files.
- Full status table: `docs/operations/release-readiness.md`.

## Recovery
- The full J_Platform git repo was found at `C:\Users\sshub\Music\J_Platform` (clean, `main` @ 7360b2c). It was left untouched.
- The workspace `J_Platform/` copy was a strict subset of that repo (admin/, client config, README). It was removed after comparison.
- Imported: 240 Java questions with visible and hidden tests → `content/j-platform-question-bank/questions.json`. They are seeded as platform practice questions marked `IMPORTED_UNREVIEWED`. Ideas from the J activity tracker and language registry were rebuilt in TypeScript; no J source files were copied.
- Pre-merge backup: `C:\Users\sshub\Videos\Platform_premerge_backup_2026-11-20.tar.gz`.

## Earlier implementation-session snapshot (superseded where it conflicts with the continuation above)

The following notes describe the workspace before this continuation and are retained as provenance, not as current verification.

## Layout
- `apps/api` (was L_Platform_Backend), `apps/web` (L_Platform_Web), `apps/student-desktop` (L_Platform_Application).
- `packages/language-config` (shared language registry), `content/`, `scripts/local-postgres.mjs`.
- There is one root pnpm workspace with a single lockfile. Per-app lockfiles, node_modules and build output were removed.
- Old per-repo CI workflows were moved to `docs/migration/legacy-workflows/`. No root CI workflow has been written yet.

## Earlier verified snapshot (not current; superseded above)
- API: 26 unit tests pass. 24 integration tests pass on real PostgreSQL, including the 11 RLS tests that were previously skipped and a new end-to-end acceptance test. In that test the judge worker runs as a separate process and compiles and runs Python, C, C++ and Java. Lint, typecheck and build pass.
- Web: 58 tests pass. Typecheck and lint pass. `next build` was not run after the latest changes.
- Desktop: 23 tests pass. Typecheck, lint and the Vite build pass. The main chunk is 3.7 MB because Monaco is not code-split yet.
- Rust: `cargo +stable check` passes. The pinned 1.99.1 toolchain install is broken (it has no cargo.exe or rustc.exe) and was not repaired.

## Earlier not-done snapshot (not current; superseded above)
- Judge0 has not been run. The Docker daemon is not running, and Judge0 needs Linux cgroups. Its adapter is unit-tested only. Local runs use `local-unsandboxed-dev`, a development provider that is **not sandboxed**.
- These were not built: the interactive terminal, SQLite on the desktop (it uses localStorage and IndexedDB), and the Playwright E2E for the new pages.
- Docs not yet written: the cleanup report, deployment, security and limitations docs, the root README and `.env.example`, and the docker-compose files.
- No visual or browser QA of the new pages has been done.
- OCI storage is untested against a real bucket.
