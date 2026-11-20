# Security model and gap review

## Existing protections found

L has Fastify security plugins, argon2/JWT dependencies, auth middleware, role guards, tenant-access helper, restricted PostgreSQL role/RLS context, RLS migrations, security documentation, audit routes and a PostgreSQL-dependent RLS integration suite. These are meaningful foundations, but integration results were not available without a disposable database.

## Important gaps / verification work

- Existing role model is user-global and single-organization; target requires scoped memberships and permissions.
- Verify all RLS policies for each operation, privileged system contexts, background worker access and bulk/nested routes against a real PostgreSQL test DB.
- Test authorization for file intents/downloads/exports and all analytics endpoints.
- Email delivery and student OTP enrollment/invitation admission are not confirmed as production integrations.
- J local judge (if restored) must not be treated as a secure host sandbox. L evaluator is explicitly unsafe and must remain disconnected from submissions.
- Platform owner access to source code must be separately authorized, scoped and audited.

## Target controls

Use backend-resolved organization membership, restricted DB role plus RLS, short-lived access tokens and rotating/revocable device refresh sessions. Hash OTPs, expire/rate-limit them, avoid logging secrets and require a verified invitation, roster or approved institutional domain plus enrollment. Validate files and quotas before storage grants. Isolate code execution from API and DB credentials. Keep activity collection disclosed, opt-in where appropriate, app-scoped, bounded and retention-controlled. Treat similarity/activity as review evidence rather than conclusions.

Create cross-tenant read/write, nested-resource, hidden-test, file, export, revocation and support-access tests before marking affected modules complete.
