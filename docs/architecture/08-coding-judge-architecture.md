# Coding judge architecture

## Current state

L submission routes persist pending submissions and do not call `src/services/evaluator.service.ts`. That service launches Python/Java/C++ as direct child processes and has no OS sandbox; it is expressly documented as unsafe. It must never be connected to production submission handling. J's Compose references a Docker judge, but all referenced Docker/API/worker sources are absent in this workspace.

No real isolated judge is verified as deployed.

## Target flow

The API authorizes enrollment and attempt, validates language/source size, stores a versioned submission and durable job, then returns `202` with an opaque ID. A private queue/gateway sends bounded input to a self-hosted Judge0 CE instance; isolated worker results are validated and persisted. Student run uses visible cases only; submit uses hidden cases without disclosing hidden inputs or expected outputs. Polling/status events expose only authorized results. Provider adapter allows later replacement.

## Gates before enabling

- Review the current Judge0 CE license, deployment docs and threat model at implementation time.
- Private network/admin endpoint; no public administrative credentials.
- Worker isolation, resource/output/time/queue quotas, no API/database secrets, egress policy, cleanup and health checks.
- Real tests for Python/C/C++/Java, errors, time/memory/output limits, hidden case confidentiality, concurrent load and worker failure.
- Explicit unavailable status when provider/queue is down; mocks only in tests.

Until all gates pass, submissions remain pending/manual and UI must say so.
