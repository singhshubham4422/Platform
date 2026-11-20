# Judge0 CE

This deployment follows the official Judge0 CE v1.13.1 service topology and pins the Judge0, PostgreSQL, and Redis image versions. The local Judge0 image is built from the official image with a small patch that redacts authentication/database secrets from the upstream startup environment dump. Judge0 CE officially documents Linux as its supported host; it uses privileged containers for isolate/cgroup execution. Operate it on a dedicated Linux VM with no unrelated workloads. Docker Desktop with WSL2 is suitable for API-development checks only; its cgroup-v2 worker cannot enforce Judge0 CE 1.13.1's Isolate limits.

## Local setup

1. Start Docker Desktop using Linux containers and WSL2.
2. Copy `judge0.conf.example` to `judge0.conf` and replace all three secret values with independent random strings.
3. Copy `judge0.conf` to `judge0.env`. This env file is passed to the database and Redis containers. Keep both files private; they are ignored by Git.
4. Start with `docker compose --env-file judge0.env up -d`.
5. Configure the API worker with `JUDGE_PROVIDER=judge0`, `JUDGE0_URL=http://127.0.0.1:2358`, and `JUDGE0_AUTH_TOKEN` matching the `AUTHN_TOKEN` above.
6. Verify `curl http://127.0.0.1:2358/languages` locally, then run the API's Judge0 integration acceptance workflow. A language list alone is not an execution acceptance test.
7. Stop with `docker compose --env-file judge0.env down` (add `-v` only when intentionally deleting Judge0's persistent database).

The API port binds to loopback and database/cache ports are never published. In production, put the API worker on a private host network and remove the `ports` mapping; do not publish Judge0 or its administrative API publicly. Judge0 itself must be treated as a privileged execution host. Apply host firewall egress restrictions and resource controls, and keep API/database credentials off that host. The official v1.13.1 Isolate worker requires cgroup-v1 resources; verify `isolate-check-environment` and the real four-language acceptance suite on the actual Linux host before enabling student execution. A healthy `/languages` response does not prove sandbox readiness.

Upstream reference: [Judge0 CE v1.13.1 release and deployment instructions](https://github.com/judge0/judge0/releases/tag/v1.13.1), [official compose topology](https://github.com/judge0/judge0/blob/v1.13.1/docker-compose.yml), and [CE API docs](https://ce.judge0.com/docs).
