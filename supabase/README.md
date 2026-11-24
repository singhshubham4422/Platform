# Supabase deployment

Supabase owns operational identities, course content, submissions and KPI serving rows. The Postgres schema is versioned under `migrations/`; do not edit a migration after deployment. Sign in uses Supabase Auth email OTP (`enable_signup = false`); create users through the broker/Admin API. Configure Brevo SMTP in the Supabase dashboard.

## Frozen C9 table columns

- `organizations`: id, name, slug, status, created_at.
- `profiles`: id, organization_id, role, full_name, email, department_id, status, created_at.
- `departments`: id, organization_id, name, code, created_at.
- `classes`: id, organization_id, department_id, name, code, academic_year, semester, created_at.
- `class_members`: class_id, user_id, role, added_at.
- `courses`: id, organization_id, title, description, languages, status, content_status, created_by, created_at, updated_at.
- `questions`: id, course_id, title, statement_md, difficulty, points, topics, time_limit_ms, memory_limit_mb, output_limit_kb, starter_code, order_index, created_at, updated_at.
- `question_tests`: id, question_id, kind, ordinal, input, expected_output.
- `class_courses`: class_id, course_id.
- `assessments`: id, organization_id, course_id, class_id, title, question_ids, opens_at, closes_at, duration_minutes, attempts_allowed, grace_period_minutes, high_stakes, status, created_by, created_at.
- `assessment_keys`: assessment_id, key_id, key_b64, created_at.
- `course_pack_versions`: pack_id, kind, course_id, assessment_id, version, object_path, sha256, size, min_app_version, published_by, published_at.
- `submissions`: id, user_id, organization_id, pack_id, course_id, question_id, assessment_id, language, source, source_sha256, verdict, passed, total, total_time_ms, results_json, started_at, finished_at, monotonic_seq, device_id, signature, received_at, late_status, recheck_status, recheck_verdict, recheck_passed, recheck_total, recheck_at.
- `feedback`: id, submission_id, teacher_id, body, score_override, released, created_at.
- `devices`: user_id, device_id, public_key, registered_at, revoked_at.
- `assessment_key_issues`: id, assessment_id, user_id, key_id, device_id, issued_at.
- `kpi_student_daily`: organization_id, user_id, day, active_minutes, questions_attempted, questions_solved, runs, submits, accepted_submits, typed_chars, paste_chars, paste_ratio, focus_lost_count, idle_minutes, computed_at.
- `kpi_student_topic`: organization_id, user_id, topic, attempted, solved, mastery, computed_at.
- `kpi_assessment`: organization_id, assessment_id, user_id, score, solved, total_questions, time_minutes, flags, computed_at.
- `kpi_class_daily` view: class_id, day, active_students, avg_active_minutes, solve_rate.

## RLS policy matrix

| Table | Student | Teacher | College admin | Platform owner |
|---|---|---|---|---|
| organizations | own org read | own org read | own org read/update name | all |
| profiles | self | self and class members | own org, no owner role management | all |
| departments/classes/class_members | own rows/classes | own classes | own org all | all |
| courses/questions | readable published courses | read/manage linked courses | own org all | all |
| question_tests | visible tests on readable courses | manage linked courses | own org all | all |
| class_courses | own classes | own classes add/remove | own org all | all |
| assessments | own class, not draft | own classes | own org all | all |
| assessment_keys | none | none | none | none (service role only) |
| course_pack_versions | readable packs | readable packs; publish through broker | read | all |
| submissions | own read/insert for readable courses | own classes' students read | own org read | all |
| feedback | released own feedback | own classes all | own org read | all |
| devices | own read/insert | none | own org read | all |
| assessment_key_issues | own read | own classes read | own org read | all |
| KPI tables | own read | own class students read | own org read | all |

All public tables have RLS enabled and forced. `anon` has no table grants. KPI writes and submission mutation are service-role only. Hidden `question_tests` are never selectable by students.

## Bootstrap and tests

For a production owner bootstrap, supply `--database-url`, `--email`, and `--full-name`, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the script creates the Auth user through the Admin API and then inserts the owner profile. For the disposable local auth stub only, pass `--local-stub` (do not use that flag in production). The script refuses an existing owner and example/test/local/demo email domains. It never prints API keys.

Run `pnpm test:supabase` to create a fresh local database, apply the auth stub and migrations, then run the PostgreSQL access checks. It uses `SUPABASE_TEST_DATABASE_URL` only for that local test database. Remote deployment and OTP verification remain **Blocked** until the owner supplies a Supabase project and configures SMTP:

1. Configure project secrets and Brevo SMTP in the Supabase dashboard.
2. Review and apply migrations with `supabase db push` against the project.
3. Bootstrap the owner via the Auth Admin API mode.
4. Request an email OTP and complete a real desktop login.

## Broker

Deploy each function from this repository with `supabase functions deploy <name>`:

```powershell
supabase functions deploy activity-upload-url
supabase functions deploy pack-download-url
supabase functions deploy publish-pack
supabase functions deploy invite-user
```

Function secrets are `OCI_TENANCY`, `OCI_USER`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_REGION`, `OCI_NAMESPACE`, `OCI_BUCKET`, `PACK_SIGNING_KEY`, and the Supabase runtime's `SUPABASE_SERVICE_ROLE_KEY`. Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Configure the origin allowlist, including the dashboard and Tauri origins:

```powershell
supabase secrets set OCI_TENANCY="<tenancy-ocid>" OCI_USER="<user-ocid>" OCI_FINGERPRINT="<fingerprint>" OCI_PRIVATE_KEY="<pem-private-key>" OCI_REGION="<region>" OCI_NAMESPACE="<namespace>" OCI_BUCKET="<bucket>" PACK_SIGNING_KEY="<base64-ed25519-seed>" ALLOWED_ORIGINS="https://<dashboard-domain>,tauri://localhost,http://tauri.localhost"
```

Never put these values in a client build. Create the language-pack PAR once in the OCI console for only `packs/lang/`, with read-only access and an owner-managed expiry; set its Object Storage URL as the desktop `VITE_LANG_PACKS_BASE_URL`. The functions do not create that prefix PAR. Keep the bucket private, turn versioning off, and configure a lifecycle policy deleting `raw/activity/` objects after 365 days. Course packs live at `packs/course/{courseId}/{version}.lpack`; the broker returns separate 15-minute read PARs for the pack and detached signature. Activity uploads use a single-object 15-minute write PAR under `raw/activity/`.

Before release, deploy to staging and verify an ObjectWrite PAR uploads a 1 KB gzip only to its scoped activity object, a read PAR downloads a published pack and signature, and both URLs expire. The OCI PAR round trip remains **Blocked** until the owner provides OCI credentials and a staging bucket.
