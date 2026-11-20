# Local development

## Prerequisites and start

Install Node.js 24, pnpm 12.18.0, Rust stable, and Docker Desktop with WSL2/Linux containers. Copy `.env.example` to `.env`, replace the local placeholders, then run:

```powershell
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm db:seed:dev   # development/test fixtures only; refused in production
pnpm dev
```

Open the web application at `http://localhost:3000`, API at `http://localhost:3001`, and Mailpit at `http://127.0.0.1:8025`. Use `pnpm dev:desktop` for the Vite client or `pnpm dev:desktop:tauri` for the native shell. The Docker PostgreSQL service binds to loopback port 54331; `scripts/local-postgres.mjs` uses port 54330 for isolated tests.

## Judge0

Follow [infra/judge/README.md](../../infra/judge/README.md). Keep public student execution disabled until `JUDGE_PROVIDER=judge0` and a real `pnpm test:judge0` run succeeds. The local unsandboxed fixture exists only for development/integration tests and must not be exposed to untrusted users.

## Checks

`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm check:rust` run the workspace's package scripts. `pnpm test:judge0` requires an actual configured Judge0 service. `pnpm infra:down` stops local PostgreSQL and Mailpit containers without removing their named volume. `pnpm judge:down` stops Judge0 containers and preserves its data volume.

The root `pnpm dev` runs API and web only. It does not start infrastructure or the judge worker automatically. Start a judge worker only after choosing a provider and setting its environment.
