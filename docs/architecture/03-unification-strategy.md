# Unification strategy

## Source of truth

L_Platform backend owns organizations, users, courses, classes/sections, allocations, questions, assignments, assessments, submissions, grades, progress and audit records. L web becomes the staff client after its mock adapter is replaced domain by domain. L Tauri remains the student desktop baseline.

J_Platform assets are candidate imports, not an authoritative runtime in this checkout. Its question JSON/admin UI can be assessed as source material, but content import must preserve provenance, licensing, IDs and version history. No J account/session or local database can be migrated until those missing sources/data are supplied.

## Sequence

1. Establish source availability, DB backup, schema export, and deploy/test environment inventory.
2. Add organization-scoped memberships and permissions compatibly with legacy `users.organization_id` and `users.role`.
3. Verify and complete the existing web API adapter against the L API, preserving screens and eliminating any remaining mock-only flows.
4. Extend academic hierarchy and immutable assessment versions through additive migrations.
5. Integrate a real asynchronous Judge0 provider only after isolated infrastructure and end-to-end tests exist.
6. Move student app to generated API contracts and verify offline cache/outbox behavior.
7. Import J course/question content after mapping review; do not import demo records as real students.

## Compatibility rules

- Keep existing user IDs and credentials/sessions valid during staged identity migration.
- Maintain existing API routes while adding versioned equivalents; announce and test deprecation before removal.
- Keep Electron usable until its sources are restored and any Tauri replacement passes feature-parity checks.
- Never merge J standalone sync into academic grades; server remains authoritative.
- Maintain row-level tenant checks through nested routes, exports, downloads and background jobs.
