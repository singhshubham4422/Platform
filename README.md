# Unified Engineering College Platform

This workspace combines the academic platform, programming assessment API, web consoles, and Tauri student desktop app. It uses Fastify, PostgreSQL/Drizzle, Next.js, React/Vite, Tauri, and a shared Python/C/C++/Java language registry.

## Requirements

- Node.js 24 and pnpm 12.18.0
- Rust stable for native Tauri checks/builds
- PostgreSQL 16.2 (Docker Compose or local PostgreSQL binaries)
- Docker Desktop with WSL2/Linux containers for the optional local Judge0 service

## Local start

1. Copy `.env.example` to `.env`, set unique local secrets, and install with `pnpm install`.
2. Start PostgreSQL and Mailpit using `pnpm infra:up`; wait for their health checks.
3. Apply migrations and seed development accounts with `pnpm db:migrate` and `pnpm db:seed:dev` (fixtures for development/test only; production uses `pnpm db:bootstrap`).
4. Start API and web with `pnpm dev` (or `pnpm dev:api` and `pnpm dev:web` separately).
5. Start desktop with `pnpm dev:desktop`; use `pnpm dev:desktop:tauri` for the native shell.
6. For isolated execution, follow [Judge0 setup](infra/judge/README.md), then set the API worker's `JUDGE_PROVIDER=judge0`, URL, and token. The local unsandboxed fixture is restricted to explicit `NODE_ENV=development` or `test`; never expose it to students.
7. Stop services with `pnpm infra:down`; stop Judge0 separately with `pnpm judge:down`.

The root pnpm scripts run the corresponding app or infrastructure commands. `pnpm test:judge0` requires a live real Judge0 endpoint and deliberately fails when `JUDGE0_URL` is absent. Regular tests are not evidence of sandbox readiness.

## Packages

- `apps/api`: Fastify API, PostgreSQL migrations, queue worker, storage/email integrations.
- `apps/web`: college/faculty/platform owner web app.
- `apps/student-desktop`: student Tauri app and lazy-loaded Monaco workspace.
- `packages/language-config`: shared language metadata and validation.
- `content/j-platform-question-bank`: imported practice problems marked unreviewed.

See [local development](docs/development/local-development-guide.md), [production deployment](docs/deployment/production-deployment-guide.md), and [known limitations](docs/operations/known-limitations.md). Production readiness is not claimed until the real Judge0 acceptance suite, SQLite persistence, and visual browser review pass.
