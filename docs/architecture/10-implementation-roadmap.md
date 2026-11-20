# Implementation roadmap

| Phase | Scope | Exit evidence | Status in this workspace |
|---|---|---|---|
| 0 Audit | Inventory both projects, tests, schemas, routes, gaps and target design | This document set; source availability confirmed | Completed for available files; J source availability is a blocker |
| 1 Foundation | Scoped memberships, configurable hierarchy, permissions, tenant tests | Additive migration, backfill report, live Postgres tests | Not started; requires DB/migration inventory and integration environment |
| 2 Unify | Verify web API adapter, shared course/question/assessment/submission IDs, content importer | Real API flows and data reconciliation | Adapter exists; reconciliation blocked because J client/backend missing |
| 3 Coding assessment | Faculty author/publish, student run/submit, isolated judge, grading | End-to-end tests using real persisted records and worker | Not started; no isolated judge; do not use unsafe evaluator |
| 4 Desktop | Tauri auth/cache/sync/workspace and package integrity | Native builds and offline/reconnect tests | Partial L foundation; no parity proof |
| 5 Semester 1 pilot | Configure existing TPS/basic programming content, enrollment and graded assignments | Pilot acceptance journey | Not ready |
| 6 Activity | Disclosed event schema/playback/review | Consent, access, retention and privacy/security tests | Partial L audit/progress; J portal UI only |
| 7 College intelligence | Department/HOD reports and explainable skill evidence | Backed aggregates and audited exports | Partial routes/UI; live web adapter absent |
| 8 Further semesters | Data-driven programs/courses through semester 7 | Organization-configurable fixtures and workflows | Not started |
| 9 Commercial | Plans/seats/quotas/billing | Provider-backed billing and usage records | Not started |
| 10 Hardening | Backups, restore, load/security/observability/release ops | Runbooks and production evidence | Not started |

Immediate next engineering action: restore the missing J_Platform source or confirm the workspace is intentionally a partial snapshot. Meanwhile L backend can be independently advanced after establishing a PostgreSQL test database and deployment schema baseline.
