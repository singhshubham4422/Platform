# Phase 06 — Supabase schema and RLS report

Status: **Incomplete**. The five C9 migrations, OTP project config, test-only auth stub, owner bootstrap script and local test command are implemented and applied successfully. The local tests cover schema-wide forced RLS, hidden-test filtering, submission identity enforcement, and owner bootstrap. The complete per-table/per-role authorization matrix from the phase checklist is not yet tested.

## Verification

- `pnpm test:supabase` — schema and migrations applied in a fresh local `lplatform_supabase_test`; 4 Node tests passed. The command drops only the test database it created, including on failure. It refuses to reset a pre-existing database of that name.
- `pnpm test:integration` — run with `LOCAL_PG_PORT=54331` and `LOCAL_PG_DATA_DIR=.local/postgres/offline-phase06` to preserve the pre-existing `lplatform_test` database. Result: 3 integration files, 24 tests passed. The dedicated cluster was stopped after the run and its ignored files remain under `.local`.
- Existing Node output includes the repository's Windows `shell: true` child-process deprecation warning for invoking `pnpm.cmd`.

## Schema

Frozen C9 tables and view: `organizations, profiles, departments, classes, class_members, courses, questions, question_tests, class_courses, assessments, assessment_keys, course_pack_versions, submissions, feedback, devices, assessment_key_issues, kpi_student_daily, kpi_student_topic, kpi_assessment`; view `kpi_class_daily`.

Frozen columns (copied into `supabase/README.md`): `organizations(id,name,slug,status,created_at)`; `profiles(id,organization_id,role,full_name,email,department_id,status,created_at)`; `departments(id,organization_id,name,code,created_at)`; `classes(id,organization_id,department_id,name,code,academic_year,semester,created_at)`; `class_members(class_id,user_id,role,added_at)`; `courses(id,organization_id,title,description,languages,status,content_status,created_by,created_at,updated_at)`; `questions(id,course_id,title,statement_md,difficulty,points,topics,time_limit_ms,memory_limit_mb,output_limit_kb,starter_code,order_index,created_at,updated_at)`; `question_tests(id,question_id,kind,ordinal,input,expected_output)`; `class_courses(class_id,course_id)`; `assessments(id,organization_id,course_id,class_id,title,question_ids,opens_at,closes_at,duration_minutes,attempts_allowed,grace_period_minutes,high_stakes,status,created_by,created_at)`; `assessment_keys(assessment_id,key_id,key_b64,created_at)`; `course_pack_versions(pack_id,kind,course_id,assessment_id,version,object_path,sha256,size,min_app_version,published_by,published_at)`; `submissions(id,user_id,organization_id,pack_id,course_id,question_id,assessment_id,language,source,source_sha256,verdict,passed,total,total_time_ms,results_json,started_at,finished_at,monotonic_seq,device_id,signature,received_at,late_status,recheck_status,recheck_verdict,recheck_passed,recheck_total,recheck_at)`; `feedback(id,submission_id,teacher_id,body,score_override,released,created_at)`; `devices(user_id,device_id,public_key,registered_at,revoked_at)`; `assessment_key_issues(id,assessment_id,user_id,key_id,device_id,issued_at)`; `kpi_student_daily(organization_id,user_id,day,active_minutes,questions_attempted,questions_solved,runs,submits,accepted_submits,typed_chars,paste_chars,paste_ratio,focus_lost_count,idle_minutes,computed_at)`; `kpi_student_topic(organization_id,user_id,topic,attempted,solved,mastery,computed_at)`; `kpi_assessment(organization_id,assessment_id,user_id,score,solved,total_questions,time_minutes,flags,computed_at)`; `kpi_class_daily(class_id,day,active_students,avg_active_minutes,solve_rate)`.

Security-definer helpers are stable and use `search_path=public,pg_temp`. Every C9 table has RLS enabled and forced. `anon` has no table grants. Students can select visible tests only, assessment keys have no policies and no anon/authenticated grants, and submissions receive caller identity and organization from the trigger. `assessment_keys` is service-role only.

## Bootstrap and configuration

- `supabase/scripts/bootstrap-owner.mjs --database-url <url> --email <email> --full-name <name>` uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to create the Auth user, then inserts its `PLATFORM_OWNER` profile. Test-only mode is `--local-stub`; the script refuses a second owner and example/test/local/demo domains.
- `pnpm test:supabase` sets local-only `SUPABASE_TEST_DATABASE_URL`. Production bootstrap additionally requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; OTP delivery requires Brevo SMTP configured in Supabase dashboard.
- Real `supabase db push` and Brevo OTP login are **Blocked** until the owner provides a Supabase project and SMTP configuration. Steps are in `supabase/README.md`.

## TODO markers

- `-- TODO(offline-integration): phase 10 late/recheck`
