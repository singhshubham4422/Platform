# Phase 06 — Supabase schema, RLS, auth helpers and KPI tables

Track B, first phase. No dependencies; it can run in parallel with phases 01–04. Read `00-MASTER-PROMPT.md` first; contracts C1, C9 and C11 apply.

## Goal
The complete Supabase Postgres schema for the offline-first platform:
- tables
- row-level security
- helper functions
- KPI serving tables and the class view
- a production-safe owner bootstrap

The J question bank importer is in phase 07, because it needs phase 01.

All of it is tested on the local PostgreSQL cluster with a stub of Supabase's `auth` schema, so no Supabase account is needed to verify it.

## Read first
- `apps/api/src/db/migrations/003_unified_platform.ts`: the existing RLS style and helper functions. Reuse the ideas; do **not** import from the API.
- `apps/api/src/db/bootstrap.ts`: copy its owner-bootstrap rules (strong password not needed here because login is OTP; reject `.test`, `example.*` and `demo` domains).
- `scripts/local-postgres.mjs`: how the local cluster on port 54330 is started.
- `docs/security/security-review.md`.

## Allowed paths
- Create `supabase/config.toml` (project id placeholder `platform`; auth: email OTP enabled, `enable_signup = false`, OTP expiry 600 s; SMTP left commented with `# configured in dashboard: Brevo`).
- Create `supabase/migrations/20261124000001_core.sql`, `…0002_content.sql`, `…0003_work.sql`, `…0004_kpi.sql`, `…0005_rls.sql`.
- Create `supabase/scripts/bootstrap-owner.mjs`.
- Create `supabase/README.md`.
- Create `packages/supabase-tests/**` (package `@platform/supabase-tests`, dev dependency `pg` 8, `node --test`).
- Modify `scripts/local-postgres.mjs`: **add** a `supabase-test` command that creates the database `platform_supabase_test`, applies `supabase/tests-support/auth-stub.sql` and then all `supabase/migrations/*.sql` in name order, and runs `pnpm --filter @platform/supabase-tests test` with `SUPABASE_TEST_DATABASE_URL` set. Existing commands must behave exactly as before.
- Create `supabase/tests-support/auth-stub.sql`.
- Modify root `package.json`: add the script `"test:supabase": "node scripts/local-postgres.mjs supabase-test"`.
- Create `docs/codex/offline-first/reports/06-report.md`.

## The auth stub (`supabase/tests-support/auth-stub.sql`; test only, never deployed)
- Creates the roles `anon`, `authenticated` and `service_role` (NOLOGIN; `service_role` BYPASSRLS) if they are missing.
- Schema `auth` with table `auth.users(id uuid primary key, email text unique not null, created_at timestamptz default now())`.
- Functions `auth.uid()` returning `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid` and `auth.role()`, the same shape as Supabase's.
- Grants: `usage` on `auth` to `anon` and `authenticated`.

## Schema (frozen after this phase; every table has RLS enabled **and forced**)
All IDs are `uuid default gen_random_uuid()` unless noted. All timestamps are `timestamptz`.

**Core (`0001_core.sql`):**
- `organizations(id pk, name text not null, slug text unique not null check (slug ~ '^[a-z0-9-]{3,64}$'), status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')), created_at default now())`
- `profiles(id uuid pk references auth.users(id) on delete cascade, organization_id uuid references organizations, role text not null check (role in ('STUDENT','TEACHER','COLLEGE_ADMIN','PLATFORM_OWNER')), full_name text not null, email text not null, department_id uuid null, status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')), created_at default now())`
  - Check: `organization_id` is null only when the role is `PLATFORM_OWNER`.
- `departments(id pk, organization_id uuid not null references organizations, name text not null, code text not null, created_at, unique (organization_id, code))`
- `classes(id pk, organization_id uuid not null references organizations, department_id uuid references departments, name text not null, code text not null, academic_year text, semester int check (semester between 1 and 12), created_at, unique (organization_id, code))`
- `class_members(class_id uuid references classes on delete cascade, user_id uuid references profiles on delete cascade, role text not null check (role in ('STUDENT','TEACHER')), added_at default now(), primary key (class_id, user_id))`

**Content (`0002_content.sql`):**
- `courses(id pk, organization_id uuid null references organizations, title text not null, description text not null default '', languages text[] not null check (languages <@ array['PYTHON','C','CPP','JAVA'] and cardinality(languages) > 0), status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')), content_status text not null default 'REVIEWED' check (content_status in ('REVIEWED','IMPORTED_UNREVIEWED')), created_by uuid references profiles, created_at, updated_at)`
  - `organization_id null` means platform-wide practice owned by the platform owner.
- `questions(id pk, course_id uuid not null references courses on delete cascade, title text not null, statement_md text not null, difficulty text not null check (difficulty in ('EASY','MEDIUM','HARD')), points int not null default 10 check (points between 0 and 1000), topics text[] not null default '{}', time_limit_ms int not null default 2000 check (time_limit_ms between 100 and 20000), memory_limit_mb int not null default 256 check (memory_limit_mb between 16 and 1024), output_limit_kb int not null default 64 check (output_limit_kb between 1 and 1024), starter_code jsonb not null default '{}', order_index int not null default 0, created_at, updated_at)`
- `question_tests(id pk, question_id uuid not null references questions on delete cascade, kind text not null check (kind in ('VISIBLE','HIDDEN')), ordinal int not null, input text not null, expected_output text not null, unique (question_id, kind, ordinal))`
- `class_courses(class_id uuid references classes on delete cascade, course_id uuid references courses on delete cascade, primary key (class_id, course_id))`
- `assessments(id pk, organization_id uuid not null references organizations, course_id uuid not null references courses, class_id uuid not null references classes, title text not null, question_ids uuid[] not null, opens_at timestamptz not null, closes_at timestamptz not null check (closes_at > opens_at), duration_minutes int not null check (duration_minutes between 5 and 600), attempts_allowed int not null default 1 check (attempts_allowed between 1 and 20), grace_period_minutes int not null default 10, high_stakes boolean not null default false, status text not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','CLOSED')), created_by uuid references profiles, created_at)`
- `assessment_keys(assessment_id uuid primary key references assessments on delete cascade, key_id uuid not null, key_b64 text not null, created_at)`: **no policies at all**, so only `service_role` can read it.
- `course_pack_versions(pack_id text primary key, kind text not null check (kind in ('COURSE','ASSESSMENT')), course_id uuid references courses, assessment_id uuid references assessments, version int not null, object_path text not null, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), size bigint not null, min_app_version text not null, published_by uuid references profiles, published_at default now())`
  - Checks: exactly one of `course_id` and `assessment_id` is set, matching `kind`. `unique (course_id, version)`, `unique (assessment_id, version)`.

**Work (`0003_work.sql`):**
- `submissions(id uuid primary key, user_id uuid not null default auth.uid() references profiles, organization_id uuid references organizations, pack_id text not null, course_id uuid not null references courses, question_id uuid not null references questions, assessment_id uuid null references assessments, language text not null check (language in ('PYTHON','C','CPP','JAVA')), source text not null check (octet_length(source) <= 65536), source_sha256 text not null, verdict text not null, passed int not null, total int not null, total_time_ms int not null, results_json jsonb not null, started_at timestamptz not null, finished_at timestamptz not null, monotonic_seq bigint not null, device_id uuid not null, signature text null, received_at timestamptz not null default now(), late_status text null check (late_status in ('ON_TIME','LATE','FINISHED_OFFLINE_SYNCED_LATE')), recheck_status text not null default 'NOT_REQUIRED' check (recheck_status in ('NOT_REQUIRED','QUEUED','RUNNING','DONE','FAILED')), recheck_verdict text null, recheck_passed int null, recheck_total int null, recheck_at timestamptz null)`
  - Check: `verdict` (and `recheck_verdict`) is in the C1 verdict list.
  - Index on `(user_id, question_id)`, `(assessment_id)` and `(organization_id, received_at)`.
- `feedback(id pk, submission_id uuid not null references submissions on delete cascade, teacher_id uuid not null references profiles, body text not null, score_override numeric null, released boolean not null default false, created_at)`
- `devices(user_id uuid references profiles on delete cascade, device_id uuid, public_key text not null, registered_at default now(), revoked_at timestamptz null, primary key (user_id, device_id))`
- `assessment_key_issues(id pk, assessment_id uuid not null references assessments, user_id uuid not null references profiles, key_id uuid not null, device_id uuid null, issued_at default now())`
- **Trigger `submissions_guard` (BEFORE INSERT, security definer)**:
  - Force `user_id = auth.uid()` (unless the role is `service_role`).
  - Set `organization_id` from the caller's profile, or from the course for platform-wide practice.
  - Force `received_at = now()`, `late_status = null` and the recheck columns to their defaults.
  - Reject the insert when `assessment_id` is set and the question is not in `assessments.question_ids`.
  - Phase 10 adds the late and recheck logic in a later migration; leave `-- TODO(offline-integration): phase 10 late/recheck`.

**KPI (`0004_kpi.sql`; written by ATP through `service_role` only):**
- `kpi_student_daily(organization_id uuid not null, user_id uuid not null, day date not null, active_minutes numeric(8,1) not null, questions_attempted int not null, questions_solved int not null, runs int not null, submits int not null, accepted_submits int not null, typed_chars bigint not null, paste_chars bigint not null, paste_ratio numeric(4,3) not null, focus_lost_count int not null, idle_minutes numeric(8,1) not null, computed_at timestamptz not null, primary key (user_id, day))`
- `kpi_student_topic(organization_id uuid not null, user_id uuid not null, topic text not null, attempted int not null, solved int not null, mastery int not null check (mastery between 0 and 100), computed_at timestamptz not null, primary key (user_id, topic))`
- `kpi_assessment(organization_id uuid not null, assessment_id uuid not null, user_id uuid not null, score numeric not null, solved int not null, total_questions int not null, time_minutes numeric(8,1) not null, flags text[] not null default '{}', computed_at timestamptz not null, primary key (assessment_id, user_id))`
- View `kpi_class_daily` (`security_invoker = true`): `class_id, day, active_students, avg_active_minutes, solve_rate`, joining `class_members` (role `STUDENT`) to `kpi_student_daily`.
  - `active_students` counts rows with `active_minutes > 0`.
  - `solve_rate = round(sum(questions_solved)::numeric / nullif(sum(questions_attempted), 0), 3)`.

## Helper functions (`0005_rls.sql`; `security definer`, `stable`, `set search_path = public, pg_temp`, owned by the migration role, `execute` granted to `authenticated` only)
- `app_role()` and `app_org()`: from the caller's `profiles` row, null when there is none or the status is `DISABLED`.
- `rls_is_class_teacher(class_id)`, `rls_is_class_member(class_id)`.
- `rls_can_read_course(course_id)`: true when any of these holds:
  - the course is platform-wide, `PUBLISHED`, and the caller has an active profile;
  - the caller is in a class linked through `class_courses`;
  - the caller is a teacher of such a class;
  - the caller is `COLLEGE_ADMIN` of the course's org;
  - the caller is `PLATFORM_OWNER`.
- `rls_can_read_pack(pack_id)`: for course packs, `rls_can_read_course`. For assessment packs, the caller is a member of the assessment's class and the assessment status is `SCHEDULED` or `CLOSED`, or the caller is a teacher of that class or a college admin of the org.
- `rls_can_manage_course(course_id)`: the teacher of any class linked to the course, the college admin of its org, or the platform owner for platform-wide courses.

## Policies (write them as a matrix in `supabase/README.md` too)
| Table | STUDENT | TEACHER | COLLEGE_ADMIN | PLATFORM_OWNER |
| --- | --- | --- | --- | --- |
| organizations | own org: select | own org: select | own org: select, update name | all |
| profiles | self: select | self + members of own classes: select | own org: select, insert, update (not role `PLATFORM_OWNER`) | all |
| departments, classes | own classes: select | own classes: select | own org: all | all |
| class_members | own rows: select | own classes: select | own org: all | all |
| courses | `rls_can_read_course` and status `PUBLISHED`: select | read, and `rls_can_manage_course`: insert/update | own org: all | all |
| questions | course readable: select | manage: all | own org: all | all |
| question_tests | **VISIBLE only**, course readable: select | manage: all | own org: all | all |
| class_courses | own classes: select | own classes: insert/delete | own org: all | all |
| assessments | own class, status not `DRAFT`: select | own classes: all | own org: all | all |
| assessment_keys | none | none | none | none |
| course_pack_versions | `rls_can_read_pack`: select | same + insert via the broker only (`service_role`) | select | all |
| submissions | own: select; insert only when `rls_can_read_course(course_id)` (phase 10 further limits this to `assessment_id is null`) | own classes' students: select | own org: select | all |
| feedback | own submissions and `released`: select | own classes: all | own org: select | all |
| devices | own: select, insert | none | own org: select | all |
| assessment_key_issues | own: select | own classes: select | own org: select | all |
| kpi_student_daily / topic | own: select | own classes' students: select | own org: select | all |
| kpi_assessment | own: select | own classes: select | own org: select | all |

- `anon` gets **no** grants on any table.
- Nobody but `service_role` can update or delete `submissions` or write `kpi_*`.

## Scripts
- **`supabase/scripts/bootstrap-owner.mjs`** `--database-url <url> --email <e> --full-name <n>`:
  - Creates the `auth.users` row via the Supabase Admin API when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars are set (`auth.admin.createUser({ email, email_confirm: true })`), or directly in `auth.users` when `--local-stub` is passed (tests only).
  - Then inserts the `PLATFORM_OWNER` profile.
  - Refuses if an owner exists. Refuses domains `example.*`, `*.test`, `*.local` and anything containing `demo`.
  - Never prints keys.

## Tests (`packages/supabase-tests/test/*.test.mjs`, run through `pnpm test:supabase`)
- The helpers `asUser(client, userId, fn)` set `role authenticated` and `request.jwt.claims` inside a transaction. `asService` uses `service_role`.
- **Fixtures are created inside each test file** and removed afterwards: two orgs, departments, classes, a teacher, two students, a college admin and an owner. Nothing is committed as seed data.
- **RLS matrix:** for every table and role in the policy table, assert at least one allowed and one denied operation. In particular:
  - A student never reads a `HIDDEN` `question_tests` row, even for their own course.
  - A student cannot read another student's submission or KPIs.
  - A teacher cannot read another org's data, or a class they do not teach.
  - Nobody but `service_role` can select `assessment_keys`.
  - A student insert into `submissions` with a different `user_id` is overwritten to their own ID.
  - A student cannot update or delete submissions.
  - A student cannot see `DRAFT` assessments.
  - `anon` can read nothing.
- `kpi_class_daily` returns correct sums and respects RLS (a teacher sees only own classes).
- The bootstrap refuses a second owner and the forbidden domains.
- Migrations apply on an empty database, and a second application is detected or refused as Supabase would (each file runs once). Use `create … if not exists` only where Supabase conventions allow; do not make migrations silently idempotent.

## Verification
```
pnpm test:supabase
```
Plus master §7. Also run `pnpm test:integration` to prove the existing API integration suite still passes after the `local-postgres.mjs` change.

**Blocked unless the owner provides a Supabase project:** `supabase db push` to a real project, and an OTP login using Brevo SMTP. Write the exact steps in `supabase/README.md`.

## Must not
- No changes to `apps/api` migrations or schema.
- No seed or demo data in `supabase/migrations`.
- No policy that uses `using (true)` for `authenticated` on a tenant table.
- No `security definer` function without a fixed `search_path`.

## Integration notes to leave
- The final column list, copied into the report: this becomes the frozen C9.
- The exact env vars the scripts need.
- How the desktop and dashboard should read the role (`app_role()` through RPC, or a `profiles` select).
