# Database design and migration inventory

## Existing schema observed

L backend uses Drizzle PostgreSQL tables: `organizations`, `users`, `credentials`, `refresh_sessions`, `password_reset_tokens`, `classes`, `sections`, `student_section_memberships`, `teacher_section_memberships`, `courses`, `course_allocations`, `questions`, `test_cases`, `assignments`, `assignment_questions`, `submissions`, `submission_results`, question options, course assessments/questions/assignments/attempts/answers/reviews, lesson progress, invitations, audit logs and platform settings. Existing migration locations include `src/db/migrations/002_security_rls_and_platform_content.ts` and a Supabase SQL migration. Inspect migration registry and deployed schema before applying any change.

J has no schema or migration files in this checkout. README claims SQLite/Prisma but cannot be verified.

## Gaps against target

- `users` has a single organization and role; no verified scoped membership/role-assignment table.
- Academic structures for programs, years, semesters, batches and explicit offerings are not all represented in the listed tables.
- Published question/assignment immutable version snapshots are not established by current schema inventory.
- No durable judge job/result-provider tables were found in the listed schema.
- No verified local SQLite/Tauri sync schema found.
- Commercial/subscription tables and skill evidence model are not established.

## Additive migration plan

1. Export current schema and take restorable backup in a non-production environment.
2. Add UUID-backed hierarchy and membership tables with foreign keys and tenant indexes; keep legacy fields during dual-read period.
3. Backfill memberships from existing organization/role fields; report ambiguous or orphan records for manual review.
4. Add immutable published version tables/snapshots and preserve existing attempts/submissions as historical records.
5. Add judge jobs/results and outbox/event persistence only when API/worker contracts are ready.
6. Add skills/commercial records only in their roadmap phase.
7. Validate clean install, supported upgrade, row counts, FK integrity and tenant policies before production release.

No migration was introduced by this audit. Never run destructive migration or production reset to reconcile schemas.
