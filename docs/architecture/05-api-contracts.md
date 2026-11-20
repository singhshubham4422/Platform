# API contract inventory and target

L backend owns `openapi/openapi.yaml` and has route modules for auth, organizations, users, classes, sections, courses, allocations, questions, test cases, assignments, assessments, submissions, learning, reports, downloads, invitations, audit and settings. Preserve these contracts and document additions in OpenAPI. L web has typed service contracts/client scaffolding but currently selects mock services; L desktop reads the backend API URL.

The requested endpoint names are not assumed to exist verbatim. Before adding aliases, map current routes and their schemas from each route module and OpenAPI. Keep API versioning consistent with the existing contract.

## Required contract changes

- Auth: existing login/refresh/logout/session contracts; OTP request/verify is absent or unverified and requires verified invitation/enrollment policy plus a configured mail adapter.
- Academic: add configurable program/year/semester/batch/section/offering operations after schema migration.
- Assessments: publish immutable version snapshots; preserve current attempt/submission compatibility.
- Judge: authenticated run/submit, opaque job IDs and status/results; never return hidden inputs/expected outputs.
- Files: scoped upload intent/complete/download; private object access and short-lived authorization.
- Events: bounded, versioned, idempotent batch ingest with retention controls.
- Analytics: tenant-scoped aggregation contracts; exports audited and CSV-formula-safe.

Every route requires boundary validation, pagination where collections are returned, consistent error envelopes, server-side permission resolution and cross-tenant tests. A client-provided organization ID is a filter request, never an authorization credential.
