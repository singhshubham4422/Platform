// Drizzle definitions for tables added by migration 003 (unified platform).
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  bigint,
  numeric,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const departments = pgTable('departments', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  hodUserId: text('hod_user_id'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const programs = pgTable('programs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  departmentId: text('department_id'),
  name: text('name').notNull(),
  code: text('code').notNull(),
  degree: text('degree').notNull().default('B.Tech'),
  durationSemesters: integer('duration_semesters').notNull().default(8),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const academicYears = pgTable('academic_years', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  label: text('label').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const batches = pgTable('batches', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  programId: text('program_id'),
  name: text('name').notNull(),
  startYear: integer('start_year').notNull(),
  endYear: integer('end_year').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const semesters = pgTable('semesters', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  batchId: text('batch_id'),
  academicYearId: text('academic_year_id'),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  startsOn: date('starts_on'),
  endsOn: date('ends_on'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const roleAssignments = pgTable('role_assignments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  organizationId: text('organization_id'),
  role: text('role').notNull(),
  scopeType: text('scope_type').notNull().default('ORGANIZATION'),
  scopeId: text('scope_id'),
  grantedBy: text('granted_by'),
  createdAt: ts('created_at').defaultNow().notNull(),
  revokedAt: ts('revoked_at'),
});

export const emailOtpChallenges = pgTable('email_otp_challenges', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  userId: text('user_id'),
  purpose: text('purpose').notNull().default('LOGIN'),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const emailOutbox = pgTable('email_outbox', {
  id: text('id').primaryKey(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull().default('PENDING'),
  provider: text('provider').notNull(),
  error: text('error'),
  createdAt: ts('created_at').defaultNow().notNull(),
  sentAt: ts('sent_at'),
});

export const assignmentVersions = pgTable('assignment_versions', {
  id: text('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  organizationId: text('organization_id').notNull(),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  publishedBy: text('published_by'),
  publishedAt: ts('published_at').defaultNow().notNull(),
});

export const executionJobs = pgTable('execution_jobs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  studentId: text('student_id').notNull(),
  questionId: text('question_id').notNull(),
  assignmentId: text('assignment_id'),
  submissionId: text('submission_id'),
  kind: text('kind').notNull(),
  language: text('language').notNull(),
  sourceCode: text('source_code').notNull(),
  customInput: text('custom_input'),
  status: text('status').notNull().default('QUEUED'),
  verdict: text('verdict'),
  provider: text('provider'),
  compileOutput: text('compile_output'),
  error: text('error'),
  passedTests: integer('passed_tests').notNull().default(0),
  totalTests: integer('total_tests').notNull().default(0),
  maxTimeMs: integer('max_time_ms'),
  maxMemoryKb: integer('max_memory_kb'),
  attempts: integer('attempts').notNull().default(0),
  lockedBy: text('locked_by'),
  lockedAt: ts('locked_at'),
  createdAt: ts('created_at').defaultNow().notNull(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
});

export const executionResults = pgTable('execution_results', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  testCaseId: text('test_case_id'),
  ordinal: integer('ordinal').notNull(),
  isHidden: boolean('is_hidden').notNull().default(false),
  verdict: text('verdict').notNull(),
  input: text('input'),
  expectedOutput: text('expected_output'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  timeMs: integer('time_ms'),
  memoryKb: integer('memory_kb'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const codeDrafts = pgTable('code_drafts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  studentId: text('student_id').notNull(),
  questionId: text('question_id').notNull(),
  assignmentId: text('assignment_id'),
  language: text('language').notNull(),
  content: text('content').notNull(),
  clientUpdatedAt: ts('client_updated_at').notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const codeSnapshots = pgTable('code_snapshots', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  studentId: text('student_id').notNull(),
  questionId: text('question_id').notNull(),
  assignmentId: text('assignment_id'),
  language: text('language').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  contentSha256: text('content_sha256').notNull(),
  jobId: text('job_id'),
  metadata: jsonb('metadata').notNull().default({}),
  clientTs: ts('client_ts').notNull(),
  serverTs: ts('server_ts').defaultNow().notNull(),
});

export const activityEvents = pgTable('activity_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  studentId: text('student_id').notNull(),
  courseId: text('course_id'),
  assignmentId: text('assignment_id'),
  questionId: text('question_id'),
  attemptId: text('attempt_id'),
  deviceSessionId: text('device_session_id'),
  eventType: text('event_type').notNull(),
  clientTs: ts('client_ts').notNull(),
  serverTs: ts('server_ts').defaultNow().notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  metadata: jsonb('metadata').notNull().default({}),
});

export const similarityReports = pgTable('similarity_reports', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  assignmentId: text('assignment_id').notNull(),
  questionId: text('question_id').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('COMPLETED'),
  threshold: numeric('threshold').notNull(),
  pairs: jsonb('pairs').notNull().default([]),
  createdBy: text('created_by'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const skillEvidence = pgTable('skill_evidence', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  studentId: text('student_id').notNull(),
  skill: text('skill').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  courseId: text('course_id'),
  scorePct: numeric('score_pct').notNull(),
  difficulty: text('difficulty'),
  validatedBy: text('validated_by'),
  evidenceAt: ts('evidence_at').defaultNow().notNull(),
});

export const facultyNotes = pgTable('faculty_notes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  studentId: text('student_id').notNull(),
  authorId: text('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const fileObjects = pgTable('file_objects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  ownerId: text('owner_id'),
  purpose: text('purpose').notNull(),
  originalName: text('original_name').notNull(),
  storageProvider: text('storage_provider').notNull(),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  courseId: text('course_id'),
  assignmentId: text('assignment_id'),
  retentionStatus: text('retention_status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const coursePackages = pgTable('course_packages', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull(),
  organizationId: text('organization_id'),
  version: integer('version').notNull(),
  minAppVersion: text('min_app_version').notNull(),
  manifest: jsonb('manifest').notNull(),
  status: text('status').notNull().default('PUBLISHED'),
  createdBy: text('created_by'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  seatLimit: integer('seat_limit').notNull(),
  storageGb: integer('storage_gb').notNull(),
  judgeExecutionsPerMonth: integer('judge_executions_per_month').notNull(),
  pricePerSeatCents: integer('price_per_seat_cents').notNull(),
  currency: text('currency').notNull(),
  modules: jsonb('modules').notNull().default([]),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const organizationSubscriptions = pgTable('organization_subscriptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  planId: text('plan_id').notNull(),
  seats: integer('seats').notNull(),
  startsAt: date('starts_at').notNull(),
  renewsAt: date('renews_at'),
  expiresAt: date('expires_at'),
  status: text('status').notNull().default('ACTIVE'),
  billingEmail: text('billing_email'),
  billingReference: text('billing_reference'),
  notes: text('notes'),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const usageRecords = pgTable(
  'usage_records',
  {
    organizationId: text('organization_id').notNull(),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.metric, t.period] }) }),
);
