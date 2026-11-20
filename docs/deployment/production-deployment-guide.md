# Production deployment guide

This is a deployment boundary guide, not a claim that this workspace has passed release gates.

## Topology

- Deploy the Fastify API and queue worker as separate services with least-privilege identities. Use PostgreSQL over TLS, run reviewed migrations as a separate one-shot job, and back up/restore before enabling tenants.
- Deploy Judge0 CE v1.13.1 on a dedicated Linux host/VM with the cgroup-v1 controllers required by its Isolate 1.x worker. Judge0's upstream Compose grants its server and workers privileged containers. Do not colocate them with the API, database, object store, or unrelated workloads. Never publish PostgreSQL/Redis or the Judge0 API to the public internet.
- Permit only API-worker-to-Judge0 traffic. Configure authentication token on both ends and rotate it as a secret. Apply host firewall egress policy, queue limits, CPU/memory/process/file limits, health monitoring, and host patching. Verify behavior with adversarial isolation tests.
- Web and desktop builds contain only public API endpoints. Keep JWT/cookie signing keys, database credentials, Judge0 tokens, SMTP credentials, and OCI signing material in a managed server-side secret store.

## Before enabling student execution

Set `NODE_ENV=production`, `JUDGE_PROVIDER=judge0`, `JUDGE0_URL` to a private endpoint, and `JUDGE0_AUTH_TOKEN`. Keep `ENABLE_STUDENT_EXECUTION=false` by default. API startup fails closed unless Judge0 is reachable, sandboxed, and reports Python, C, C++, and Java. Both `/api/coding/run` and programming submissions return 503 while the flag is false or if the judge later goes down. Run the real `pnpm test:judge0` suite on the production class of Linux host and record its output; set the enablement flag to `true` only after all required execution and isolation acceptance tests pass. Do not enable CE 1.13.1 on Docker Desktop/WSL2 cgroup v2; its API can report healthy while Isolate submissions fail. Do not use the local child-process provider in production.

Configure explicit CORS origins, secure cookie/JWT secrets, SMTP delivery and sender, private OCI bucket access, TLS, rate limits, database backup/restore, alerting, audit retention, and a migration rollback plan. Complete the security review, SQLite migration, browser visual QA, and cross-tenant E2E workflow before general release. See [known limitations](../operations/known-limitations.md).
