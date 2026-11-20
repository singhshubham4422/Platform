# Workspace audit

Audit date: 2026-11-20. Scope: files present in `L_Platform/` and `J_Platform/` in this workspace. This describes the checked-out files, not upstream repositories or claims in their READMEs.

## Repository and environment findings

- Workspace root: `C:/Users/sshub/Videos/Platform`.
- Neither project directory contains a `.git` repository; `git status` and `git rev-parse` fail. No Git diff or uncommitted-change inventory can be established from this checkout.
- No workspace-root `AGENTS.md` was found. Project instructions were found in L_Platform backend, web and application directories. Their key rules are summarized below.
- L_Platform has backend, web and student application subprojects. Backend and app declare pnpm; web declares pnpm 10.20.0. The backend declares pnpm 12.18.0 and Node 24. No lockfile was found in the inspected backend directory.
- J_Platform has only `client/` and `admin/` source directories plus root package metadata, README and a Compose file. Its README refers to `server/`, `desktop/`, `docker/`, `supabase/`, `docs/`, Prisma, Electron and a local judge, but those paths are absent here. `client/` contains only package/config/HTML files; its application source is absent.
- No J_Platform backend, Prisma schema, migrations, Electron sources, desktop runtime, judge implementation, local database, Dockerfiles or tests are present in this workspace. The Compose file references absent Docker build contexts.
- No production credentials were inspected or copied. L backend `.env` was absent.

## Actual architecture observed

### L_Platform

- Backend: Fastify 5, TypeScript, Drizzle ORM, PostgreSQL (`pg`), Supabase-compatible database deployment. This is not Express or Prisma.
- Routes cover authentication, organizations, users, classes, sections, courses, allocations, questions, test cases, assignments, assessments, submissions, learning, reports, downloads, invitations, audit and settings.
- Schema includes organizations/users/credentials/refresh sessions, classes/sections/memberships, courses/allocations, questions/test cases, assignments/submissions/results, assessments/attempts/answers/reviews, lesson progress, invitations, audit logs and platform settings.
- RLS support sets request context within a transaction and uses restricted role `lplatform_app`; migrations and integration tests exist. The README describes forced RLS policies. This audit did not run a disposable PostgreSQL instance to independently verify every policy.
- Authentication uses short-lived JWTs and rotating refresh sessions. The code and docs describe bearer token desktop support and HttpOnly web cookies. Existing roles are a legacy set, not the full requested scoped role-assignment model.
- Coding submissions are stored pending faculty review. `evaluator.service.ts` starts local child processes and is explicitly documented as unsafe; it is not called from the submission route. Do not enable it as a judge.
- OCI and Supabase integration modules exist. OCI upload requires configuration; API docs state unavailable storage returns 503. Email delivery for invitations is not implemented.
- Web: Next.js 15 / React 19 / strict TypeScript. `src/lib/api/index.ts` exports `backend-services.ts`, an API-backed adapter with credentials-included fetches and no mock fallback. Mock services also exist in the repository, but they are not the exported active adapter in this checkout. Admin and teacher page surfaces exist. Live backend/database end-to-end verification remains outstanding.
- Student app: Tauri 2 / Rust shell, React + TypeScript; uses CodeMirror 6 (not Monaco), bundled Pyodide for Python offline execution, and supports offline drafts/submission queue according to README. Java/C++ coding is teacher-reviewed. This is an existing app, but not feature-equivalent to J_Platform's claimed product.
- Rust has a keyring dependency on Windows. SQLite persistence and robust native sync were not established by the files inspected; tests include storage/smoke coverage, but functionality should be checked against those implementations before claiming parity.

### J_Platform

- Available frontend metadata describes React 18, Vite, Monaco and Supabase client packages; available admin portal is JavaScript/React with Supabase/demo data adapters and question authoring/student progress/integrity views.
- Root README claims an Electron app, bundled OpenJDK, local SQLite/Prisma API and a multi-language local judge. Those implementations are absent in this checkout and therefore unverified/unavailable here.
- Compose claims a Docker API and judge setup but its referenced `docker/api.Dockerfile`, `docker/judge.Dockerfile`, API source and judge sources are absent. Compose is not runnable from this checkout as supplied.
- Do not treat generated question data or the admin demo source as the authoritative academic record or production synchronization.

## Instructions and constraints found

- L backend instructions call it a private API/persistence/workers foundation; keep judge separately deployed; use additive, reviewed migrations; never execute untrusted code in API; backend owns OpenAPI; migrations separate from app startup.
- L web instructions explicitly say current services are mock/localStorage and prohibit adding backend behavior there. Backend owns authorization and tenant isolation.
- L app instructions specify a public Tauri app, generated/versioned API contracts, no backend source/secrets in desktop and Rust/desktop checks.
- These local instructions align with a staged migration and constrain changes in addition to this product request.

## Baseline checks run

- L backend `node --test tests/foundation.test.mjs`: 3 passed.
- L web `node --test tests/foundation.test.mjs`: 3 passed.
- L app `node --test tests/foundation.test.mjs`: 3 passed.
- L backend `pnpm test:unit`: 5 files, 17 tests passed. pnpm installed the backend dependencies because they were initially absent; this generated local dependency state/lock metadata that is not tracked by Git in this workspace.
- L backend `pnpm typecheck`, `pnpm lint`, and `pnpm build`: passed.
- L web `pnpm test`: 7 files, 57 tests passed; `pnpm typecheck` and `pnpm build` passed.
- L app `pnpm test`: 8 files, 23 tests passed; `pnpm typecheck`, `pnpm lint`, and frontend `pnpm build` passed. Vite reports the existing ~976 kB JS chunk warning.
- L backend `pnpm test:integration`: 3 non-DB tests passed, 11 PostgreSQL RLS tests skipped; suite failed during setup/teardown because configured test PostgreSQL at `127.0.0.1:59999` refused connection.
- L Rust formatting/tests could not be validated: rustup attempted to auto-install toolchain `1.99.1-x86_64-pc-windows-msvc`; cargo component installation reported a conflict and the selected `cargo.exe` was not applicable.
- Playwright E2E, J_Platform tests/builds and J backend tests were not run. J source trees and dependencies are absent.

## Immediate conclusion

The checked-out workspace is not the two complete platforms described by the prompt. L_Platform provides the only complete backend and Tauri student app. J_Platform contributes partial client/admin assets, but its claimed desktop/backend/judge are missing. Phase 0 documentation can be completed from evidence; a real cross-platform workflow cannot responsibly be implemented or tested until the missing J_Platform sources are restored or the user confirms this partial checkout is intentional.
