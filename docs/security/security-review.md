# Security review (implementation snapshot)

This is a source-level review of the current workspace, not a penetration test or production sign-off. Revisit after the production deployment and real sandbox tests.

## Controls present

- Fastify auth middleware, role checks, OTP routes, rate limits, secure cookie configuration, and secret length validation are implemented under `apps/api/src`.
- PostgreSQL request-scoped transactions set tenant/user/role RLS context; migrations define organization policies and include cross-tenant tests in `apps/api/src/tests/integration/security-rls.test.ts`.
- Student job-result reads redact hidden test input/output for student callers. Similarity output carries an explicit human-review-only notice.
- File upload validation checks extension/content, signed download tokens are user-scoped, and the local provider stores files outside the public web root.
- OTP message bodies are not logged. The development outbox is forbidden in production; SMTP errors are recorded with message body redacted.
- Production judge selection now rejects missing/unknown providers and the unsandboxed fixture. Production startup requires an available sandboxed Judge0 with all four app languages; `ENABLE_STUDENT_EXECUTION` defaults off, and both run and programming-submit endpoints return 503 unless explicitly enabled after acceptance and while the judge is healthy.
- The pinned Judge0 image is built from the official v1.13.1 digest with a small patch that redacts database/authentication secrets from the upstream startup environment dump; the build context excludes local secret files.
- Desktop auth session storage uses Windows Credential Manager. Durable SQLite for student work has not yet been implemented.

## Gaps to close before production

- The local judge fixture runs child processes without OS isolation. It is allowed only with an explicit development/test `NODE_ENV`; never deploy that process or expose it to student traffic.
- The Judge0 CE upstream deployment requires privileged containers. Use a dedicated Linux VM with supported cgroup-v1 Isolate resources, isolate its network/host, and evaluate the residual host compromise risk. Docker Desktop's API becomes healthy but the real submission test fails because WSL2 cgroup v2 lacks memory/cpuacct/cpuset controllers required by CE 1.13.1. Do not mistake service health for sandbox execution readiness.
- Validate tenant scoping and role authorization on every faculty, export, file, organization and platform-owner query. Some legacy route suites are broader than the new coding module; the existing RLS tests are not a substitute for a route-by-route review.
- Check CSRF behavior for cookie-authenticated state changes, CORS origin configuration, CSP/XSS handling, SSRF surfaces, password recovery, token rotation/revocation, and user/organization quotas in deployment-specific tests.
- Production email and OCI credentials have not been configured or tested. Keep their secrets server-side and test failed-provider behavior before enabling flows.
- Do not expose private source/code playback to platform administrators by default. Access must continue through explicit organization/faculty authorization and audit logging.
- No system-wide clipboard monitoring is implemented or permitted. Activity events are application-scoped observations. Similarity is a human-review signal; authorship cannot be reliably inferred.
- Dependency audit, penetration testing, backup restore, operational alerting, and external security review remain outstanding.

## Release gates

Run PostgreSQL RLS and cross-tenant tests, real Judge0 execution tests, upload authorization tests, session revocation tests, production configuration checks, and dependency scanning on the exact release revision. Keep student execution disabled until the real isolated judge suite passes.
