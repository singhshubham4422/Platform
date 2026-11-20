/**
 * Migration 003 — unified engineering-college platform (additive, idempotent).
 *
 * Adds, without changing existing identifiers or dropping data:
 *  1. Academic hierarchy: departments, programs, academic years, batches, semesters
 *     (classes gain optional links; sections stay under classes).
 *  2. Scoped role assignments (HOD, department admin, teaching assistant).
 *  3. Email OTP challenges and device-aware refresh sessions.
 *  4. Programming workspace: per-language starter code, limits, assignment versioning,
 *     execution jobs/results (judge queue), drafts, code snapshots, similarity reports.
 *  5. Activity events (idempotent by client event id), skill evidence, faculty notes.
 *  6. Files, course packages, notifications.
 *  7. Subscriptions, organization subscriptions and usage records.
 *  8. Forced RLS on every new table.
 *
 * New primary keys are UUID strings (TEXT columns, gen_random_uuid()) to stay compatible
 * with the existing TEXT key columns.
 */
import type pg from 'pg';

export async function applyUnifiedPlatformMigration(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SCHEMA_SQL);
    await client.query(FUNCTIONS_SQL);
    await client.query(RLS_SQL);
    await client.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lplatform_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lplatform_app;
    `);
    await client.query(SEED_REFERENCE_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
-- ---------- Academic hierarchy ----------
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  hod_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  degree TEXT NOT NULL DEFAULT 'B.Tech',
  duration_semesters INTEGER NOT NULL DEFAULT 8 CHECK (duration_semesters BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, label),
  CHECK (ends_on > starts_on)
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id TEXT REFERENCES programs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_year INTEGER NOT NULL,
  end_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  starts_on DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, number)
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS program_id TEXT REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS semester_id TEXT REFERENCES semesters(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS semester_number INTEGER;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject_code TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS competencies JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------- Scoped roles ----------
CREATE TABLE IF NOT EXISTS role_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('PLATFORM_OWNER','PLATFORM_ADMIN','ORGANIZATION_ADMIN','DEPARTMENT_ADMIN','HOD','FACULTY','TEACHING_ASSISTANT','STUDENT')),
  scope_type TEXT NOT NULL DEFAULT 'ORGANIZATION' CHECK (scope_type IN ('PLATFORM','ORGANIZATION','DEPARTMENT','PROGRAM','COURSE','SECTION')),
  scope_id TEXT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignment_active
  ON role_assignments(user_id, role, scope_type, COALESCE(scope_id, '')) WHERE revoked_at IS NULL;

-- ---------- OTP + device sessions ----------
CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'LOGIN',
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_email_created ON email_otp_challenges(lower(email), created_at DESC);

ALTER TABLE refresh_sessions ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE refresh_sessions ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'WEB';
ALTER TABLE refresh_sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Outgoing e-mail (development mailbox + provider outbox). OTP codes are never stored here in clear text
-- unless EMAIL_PROVIDER=dev-outbox, which refuses to run in production.
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- ---------- Programming workspace ----------
ALTER TABLE questions ADD COLUMN IF NOT EXISTS starter_code JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS reference_solution JSONB;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_limit_ms INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS memory_limit_mb INTEGER NOT NULL DEFAULT 256;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS topics JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_bank TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_bank_slug ON questions(source_bank, slug) WHERE source_bank IS NOT NULL;

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS allowed_languages JSONB NOT NULL DEFAULT '["PYTHON","C","CPP","JAVA"]'::jsonb;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS max_attempts INTEGER;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS ai_policy TEXT NOT NULL DEFAULT 'NOT_ALLOWED';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS assignment_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, version)
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS assignment_version INTEGER;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS client_operation_id TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_client_op ON submissions(student_id, client_operation_id) WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('RUN','SUBMIT')),
  language TEXT NOT NULL,
  source_code TEXT NOT NULL,
  custom_input TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','COMPILING','RUNNING','COMPLETED','FAILED')),
  verdict TEXT,
  provider TEXT,
  compile_output TEXT,
  error TEXT,
  passed_tests INTEGER NOT NULL DEFAULT 0,
  total_tests INTEGER NOT NULL DEFAULT 0,
  max_time_ms INTEGER,
  max_memory_kb INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_queue ON execution_jobs(status, created_at) WHERE status IN ('QUEUED','COMPILING','RUNNING');
CREATE INDEX IF NOT EXISTS idx_execution_jobs_student ON execution_jobs(student_id, question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_submission ON execution_jobs(submission_id);

CREATE TABLE IF NOT EXISTS execution_results (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  verdict TEXT NOT NULL,
  input TEXT,
  expected_output TEXT,
  stdout TEXT,
  stderr TEXT,
  time_ms INTEGER,
  memory_kb INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, ordinal)
);

CREATE TABLE IF NOT EXISTS code_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_drafts ON code_drafts(student_id, question_id, COALESCE(assignment_id, ''), language);

CREATE TABLE IF NOT EXISTS code_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CHECKPOINT','EDIT','PASTE','RUN','SUBMIT','RESET')),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  job_id TEXT REFERENCES execution_jobs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_ts TIMESTAMPTZ NOT NULL,
  server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_code_snapshots_timeline ON code_snapshots(student_id, question_id, client_ts);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
  attempt_id TEXT,
  device_session_id TEXT,
  event_type TEXT NOT NULL,
  client_ts TIMESTAMPTZ NOT NULL,
  server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_activity_student_time ON activity_events(student_id, client_ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_question ON activity_events(question_id, student_id, client_ts);

CREATE TABLE IF NOT EXISTS similarity_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  threshold NUMERIC NOT NULL DEFAULT 0.6,
  pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Analytics ----------
CREATE TABLE IF NOT EXISTS skill_evidence (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('CODING_SUBMISSION','ASSESSMENT','COURSE_COMPLETION','PRACTICAL','PROJECT','FACULTY_FEEDBACK')),
  source_id TEXT NOT NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  score_pct NUMERIC NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  difficulty TEXT,
  validated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  evidence_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, skill, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS faculty_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Files & course packages ----------
CREATE TABLE IF NOT EXISTS file_objects (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('LEARNING_MATERIAL','SUBMISSION_ATTACHMENT','COURSE_PACKAGE','AVATAR','OTHER')),
  original_name TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  retention_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_file_objects_org ON file_objects(organization_id, purpose);

CREATE TABLE IF NOT EXISTS course_packages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  min_app_version TEXT NOT NULL DEFAULT '0.4.0',
  manifest JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, version)
);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ---------- Commercial ----------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  seat_limit INTEGER NOT NULL,
  storage_gb INTEGER NOT NULL DEFAULT 10,
  judge_executions_per_month INTEGER NOT NULL DEFAULT 10000,
  price_per_seat_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  seats INTEGER NOT NULL CHECK (seats >= 0),
  starts_at DATE NOT NULL,
  renews_at DATE,
  expires_at DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  billing_email TEXT,
  billing_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org ON organization_subscriptions(organization_id, status);

CREATE TABLE IF NOT EXISTS usage_records (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, metric, period)
);
`;

const FUNCTIONS_SQL = `
-- Used during sign-in (AUTH context) to confirm an approved enrollment without exposing membership rows.
CREATE OR REPLACE FUNCTION auth_student_has_active_enrollment(p_user_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_sys_ctx() = 'AUTH' AND EXISTS (
    SELECT 1 FROM student_section_memberships WHERE student_id = p_user_id AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION rls_can_view_student_work(p_student_id TEXT, p_org_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    app_sys_ctx() IN ('JUDGE','SYSTEM')
    OR p_student_id = app_user_id()
    OR (app_role() = 'TEACHER' AND rls_teacher_shares_student(app_user_id(), p_student_id))
    OR (app_role() = 'ORGANIZATION_ADMIN' AND p_org_id IS NOT NULL AND p_org_id = app_org_id());
$$;

CREATE OR REPLACE FUNCTION rls_can_view_job(p_job_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM execution_jobs j
    WHERE j.id = p_job_id AND rls_can_view_student_work(j.student_id, j.organization_id)
  );
$$;
`;

/** Org-scoped reference data: readable by members of the organization, writable by org admins. */
function orgScoped(table: string, extraRead = ''): string {
  return `
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS p_${table}_select ON ${table};
    CREATE POLICY p_${table}_select ON ${table} FOR SELECT USING (
      app_is_owner()
      OR app_sys_ctx() IN ('SYSTEM','JOIN_LOOKUP')
      OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER','STUDENT') AND organization_id = app_org_id())
      ${extraRead}
    );
    DROP POLICY IF EXISTS p_${table}_write ON ${table};
    CREATE POLICY p_${table}_write ON ${table} FOR ALL USING (
      app_is_owner() OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
    ) WITH CHECK (
      app_is_owner() OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
    );`;
}

/** Student-owned private work: student, their teachers, their org admin, and the judge. */
function studentWork(table: string, studentWrite = true): string {
  return `
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS p_${table}_select ON ${table};
    CREATE POLICY p_${table}_select ON ${table} FOR SELECT USING (
      rls_can_view_student_work(student_id, organization_id)
    );
    DROP POLICY IF EXISTS p_${table}_insert ON ${table};
    CREATE POLICY p_${table}_insert ON ${table} FOR INSERT WITH CHECK (
      app_sys_ctx() IN ('JUDGE','SYSTEM')
      ${studentWrite ? "OR (student_id = app_user_id() AND COALESCE(organization_id, '') = app_org_id())" : ''}
    );
    DROP POLICY IF EXISTS p_${table}_update ON ${table};
    CREATE POLICY p_${table}_update ON ${table} FOR UPDATE USING (
      app_sys_ctx() IN ('JUDGE','SYSTEM') ${studentWrite ? 'OR student_id = app_user_id()' : ''}
    ) WITH CHECK (
      app_sys_ctx() IN ('JUDGE','SYSTEM') ${studentWrite ? 'OR student_id = app_user_id()' : ''}
    );
    DROP POLICY IF EXISTS p_${table}_delete ON ${table};
    CREATE POLICY p_${table}_delete ON ${table} FOR DELETE USING (app_sys_ctx() = 'SYSTEM');`;
}

/** Additional permissive policies so the judge worker (systemContext JUDGE) can grade without BYPASSRLS. */
const JUDGE_ACCESS_SQL = `
DROP POLICY IF EXISTS p_questions_judge ON questions;
CREATE POLICY p_questions_judge ON questions FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_tc_judge ON test_cases;
CREATE POLICY p_tc_judge ON test_cases FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_asg_judge ON assignments;
CREATE POLICY p_asg_judge ON assignments FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_aq_judge ON assignment_questions;
CREATE POLICY p_aq_judge ON assignment_questions FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_tsm_judge ON teacher_section_memberships;
CREATE POLICY p_tsm_judge ON teacher_section_memberships FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_sub_judge_select ON submissions;
CREATE POLICY p_sub_judge_select ON submissions FOR SELECT USING (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_sub_judge_update ON submissions;
CREATE POLICY p_sub_judge_update ON submissions FOR UPDATE USING (app_sys_ctx() = 'JUDGE') WITH CHECK (app_sys_ctx() = 'JUDGE');
DROP POLICY IF EXISTS p_inv_accept ON invitations;
CREATE POLICY p_inv_accept ON invitations FOR ALL USING (app_sys_ctx() = 'AUTH') WITH CHECK (app_sys_ctx() = 'AUTH');
DROP POLICY IF EXISTS p_subres_judge ON submission_results;
CREATE POLICY p_subres_judge ON submission_results FOR ALL USING (app_sys_ctx() = 'JUDGE') WITH CHECK (app_sys_ctx() = 'JUDGE');
`;

const RLS_SQL = `
${JUDGE_ACCESS_SQL}
${orgScoped('departments')}
${orgScoped('programs')}
${orgScoped('academic_years')}
${orgScoped('batches')}
${orgScoped('semesters')}

ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_role_assignments_select ON role_assignments;
CREATE POLICY p_role_assignments_select ON role_assignments FOR SELECT USING (
  app_is_owner() OR app_sys_ctx() IN ('AUTH','SYSTEM') OR user_id = app_user_id()
  OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id())
);
DROP POLICY IF EXISTS p_role_assignments_write ON role_assignments;
CREATE POLICY p_role_assignments_write ON role_assignments FOR ALL USING (
  app_is_owner() OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
) WITH CHECK (
  app_is_owner() OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id()
    AND role NOT IN ('PLATFORM_OWNER','PLATFORM_ADMIN'))
);

ALTER TABLE email_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_otp_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_otp_all ON email_otp_challenges;
CREATE POLICY p_otp_all ON email_otp_challenges FOR ALL USING (app_sys_ctx() = 'AUTH') WITH CHECK (app_sys_ctx() = 'AUTH');

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_outbox_all ON email_outbox;
CREATE POLICY p_outbox_all ON email_outbox FOR ALL USING (app_sys_ctx() IN ('AUTH','SYSTEM') OR app_is_owner())
  WITH CHECK (app_sys_ctx() IN ('AUTH','SYSTEM') OR app_is_owner() OR app_user_id() <> '');

ALTER TABLE assignment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_assignment_versions_select ON assignment_versions;
CREATE POLICY p_assignment_versions_select ON assignment_versions FOR SELECT USING (
  app_is_owner() OR app_sys_ctx() IN ('JUDGE','SYSTEM')
  OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER','STUDENT') AND organization_id = app_org_id())
);
DROP POLICY IF EXISTS p_assignment_versions_insert ON assignment_versions;
CREATE POLICY p_assignment_versions_insert ON assignment_versions FOR INSERT WITH CHECK (
  app_is_owner() OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id())
);

${studentWork('execution_jobs')}
${studentWork('code_drafts')}
${studentWork('code_snapshots')}
${studentWork('activity_events')}
${studentWork('skill_evidence', false)}

ALTER TABLE execution_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_execution_results_select ON execution_results;
CREATE POLICY p_execution_results_select ON execution_results FOR SELECT USING (rls_can_view_job(job_id));
DROP POLICY IF EXISTS p_execution_results_write ON execution_results;
CREATE POLICY p_execution_results_write ON execution_results FOR ALL USING (app_sys_ctx() IN ('JUDGE','SYSTEM'))
  WITH CHECK (app_sys_ctx() IN ('JUDGE','SYSTEM'));

DROP POLICY IF EXISTS p_skill_evidence_teacher ON skill_evidence;
CREATE POLICY p_skill_evidence_teacher ON skill_evidence FOR INSERT WITH CHECK (
  app_role() IN ('TEACHER','ORGANIZATION_ADMIN') AND organization_id = app_org_id()
);
DROP POLICY IF EXISTS p_skill_evidence_teacher_upd ON skill_evidence;
CREATE POLICY p_skill_evidence_teacher_upd ON skill_evidence FOR UPDATE USING (
  app_role() IN ('TEACHER','ORGANIZATION_ADMIN') AND organization_id = app_org_id()
);

ALTER TABLE similarity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE similarity_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_similarity_all ON similarity_reports;
CREATE POLICY p_similarity_all ON similarity_reports FOR ALL USING (
  app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id()
) WITH CHECK (
  app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id()
);

ALTER TABLE faculty_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_faculty_notes_all ON faculty_notes;
CREATE POLICY p_faculty_notes_all ON faculty_notes FOR ALL USING (
  (app_role() = 'TEACHER' AND organization_id = app_org_id() AND rls_teacher_shares_student(app_user_id(), student_id))
  OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
) WITH CHECK (
  author_id = app_user_id() AND organization_id = app_org_id()
  AND (app_role() = 'ORGANIZATION_ADMIN' OR rls_teacher_shares_student(app_user_id(), student_id))
);

ALTER TABLE file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_file_objects_select ON file_objects;
CREATE POLICY p_file_objects_select ON file_objects FOR SELECT USING (
  app_is_owner()
  OR owner_id = app_user_id()
  OR app_sys_ctx() = 'SYSTEM'
  OR (organization_id = app_org_id() AND app_role() IN ('ORGANIZATION_ADMIN','TEACHER'))
  OR (organization_id = app_org_id() AND app_role() = 'STUDENT' AND purpose IN ('LEARNING_MATERIAL','COURSE_PACKAGE'))
  OR (organization_id IS NULL AND purpose IN ('LEARNING_MATERIAL','COURSE_PACKAGE') AND app_user_id() <> '')
);
DROP POLICY IF EXISTS p_file_objects_write ON file_objects;
CREATE POLICY p_file_objects_write ON file_objects FOR ALL USING (
  app_is_owner() OR owner_id = app_user_id()
  OR (organization_id = app_org_id() AND app_role() = 'ORGANIZATION_ADMIN')
) WITH CHECK (
  app_is_owner() OR (owner_id = app_user_id() AND COALESCE(organization_id, '') = app_org_id())
  OR (organization_id = app_org_id() AND app_role() = 'ORGANIZATION_ADMIN')
);

ALTER TABLE course_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_packages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_course_packages_select ON course_packages;
CREATE POLICY p_course_packages_select ON course_packages FOR SELECT USING (
  app_user_id() <> '' AND (organization_id IS NULL OR organization_id = app_org_id() OR app_is_owner())
);
DROP POLICY IF EXISTS p_course_packages_write ON course_packages;
CREATE POLICY p_course_packages_write ON course_packages FOR ALL USING (
  app_is_owner() OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id())
) WITH CHECK (
  app_is_owner() OR (app_role() IN ('ORGANIZATION_ADMIN','TEACHER') AND organization_id = app_org_id())
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_notifications_select ON notifications;
CREATE POLICY p_notifications_select ON notifications FOR SELECT USING (user_id = app_user_id() OR app_sys_ctx() = 'SYSTEM');
DROP POLICY IF EXISTS p_notifications_update ON notifications;
CREATE POLICY p_notifications_update ON notifications FOR UPDATE USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
DROP POLICY IF EXISTS p_notifications_insert ON notifications;
CREATE POLICY p_notifications_insert ON notifications FOR INSERT WITH CHECK (
  app_sys_ctx() IN ('JUDGE','SYSTEM','AUTH') OR app_is_owner()
  OR (organization_id IS NOT NULL AND organization_id = app_org_id() AND app_role() IN ('ORGANIZATION_ADMIN','TEACHER'))
  OR user_id = app_user_id()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_plans_select ON subscription_plans;
CREATE POLICY p_plans_select ON subscription_plans FOR SELECT USING (app_user_id() <> '' OR app_sys_ctx() = 'SYSTEM');
DROP POLICY IF EXISTS p_plans_write ON subscription_plans;
CREATE POLICY p_plans_write ON subscription_plans FOR ALL USING (app_is_owner()) WITH CHECK (app_is_owner());

ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_org_subs_select ON organization_subscriptions;
CREATE POLICY p_org_subs_select ON organization_subscriptions FOR SELECT USING (
  app_is_owner() OR app_sys_ctx() IN ('SYSTEM','JUDGE','AUTH')
  OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
);
DROP POLICY IF EXISTS p_org_subs_write ON organization_subscriptions;
CREATE POLICY p_org_subs_write ON organization_subscriptions FOR ALL USING (app_is_owner()) WITH CHECK (app_is_owner());

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_usage_select ON usage_records;
CREATE POLICY p_usage_select ON usage_records FOR SELECT USING (
  app_is_owner() OR app_sys_ctx() IN ('SYSTEM','JUDGE')
  OR (app_role() = 'ORGANIZATION_ADMIN' AND organization_id = app_org_id())
);
DROP POLICY IF EXISTS p_usage_write ON usage_records;
CREATE POLICY p_usage_write ON usage_records FOR ALL USING (
  app_is_owner() OR app_sys_ctx() IN ('SYSTEM','JUDGE') OR organization_id = app_org_id()
) WITH CHECK (
  app_is_owner() OR app_sys_ctx() IN ('SYSTEM','JUDGE') OR organization_id = app_org_id()
);
`;

const SEED_REFERENCE_SQL = `
INSERT INTO subscription_plans (code, name, description, seat_limit, storage_gb, judge_executions_per_month, price_per_seat_cents, modules)
VALUES
  ('starter', 'Starter', 'Single department pilot', 300, 25, 30000, 0, '["academics","assignments","coding"]'::jsonb),
  ('institution', 'Institution', 'Whole-college deployment', 3000, 250, 400000, 0, '["academics","assignments","coding","analytics","placement","similarity"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
`;
