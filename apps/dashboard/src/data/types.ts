import type { LanguageId, Verdict } from '@lplatform/language-config';

export type Role = 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'PLATFORM_OWNER';
export type ProfileStatus = 'ACTIVE' | 'DISABLED';
export type LateStatus = 'ON_TIME' | 'LATE' | 'FINISHED_OFFLINE_SYNCED_LATE';
export type RecheckStatus = 'NOT_REQUIRED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface Profile {
  id: string;
  organization_id: string | null;
  role: Role;
  full_name: string;
  email: string;
  department_id: string | null;
  status: ProfileStatus;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
}

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface ClassRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  name: string;
  code: string;
  academic_year: string | null;
  semester: number | null;
  created_at: string;
}

export interface ClassMemberRow {
  class_id: string;
  user_id: string;
  role: 'STUDENT' | 'TEACHER';
  added_at: string;
  profile: Pick<Profile, 'full_name' | 'email' | 'role' | 'status'> | null;
}

export interface Course {
  id: string;
  organization_id: string | null;
  title: string;
  description: string;
  languages: LanguageId[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  content_status: 'REVIEWED' | 'IMPORTED_UNREVIEWED';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  course_id: string;
  title: string;
  statement_md: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  points: number;
  topics: string[];
  time_limit_ms: number;
  memory_limit_mb: number;
  output_limit_kb: number;
  starter_code: Partial<Record<LanguageId, string>>;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionTest {
  id: string;
  question_id: string;
  kind: 'VISIBLE' | 'HIDDEN';
  ordinal: number;
  input: string;
  expected_output: string;
}

export interface Assessment {
  id: string;
  organization_id: string;
  course_id: string;
  class_id: string;
  title: string;
  question_ids: string[];
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempts_allowed: number;
  grace_period_minutes: number;
  high_stakes: boolean;
  status: 'DRAFT' | 'SCHEDULED' | 'CLOSED';
  created_by: string | null;
  created_at: string;
}

export interface AssessmentRow extends Assessment {
  class_name?: string;
  course_title?: string;
}

export interface TestResultRow {
  testId: string;
  hidden: boolean;
  verdict: Verdict;
  timeMs: number;
  memoryKb: number;
  stdout: string | null;
  stderr: string | null;
  expectedOutput: string | null;
  input: string | null;
}

export interface Submission {
  id: string;
  user_id: string;
  organization_id: string | null;
  pack_id: string;
  course_id: string;
  question_id: string;
  assessment_id: string | null;
  language: LanguageId;
  source: string;
  source_sha256: string;
  verdict: Verdict;
  passed: number;
  total: number;
  total_time_ms: number;
  results_json: TestResultRow[];
  started_at: string;
  finished_at: string;
  monotonic_seq: number;
  device_id: string;
  received_at: string;
  late_status: LateStatus | null;
  recheck_status: RecheckStatus;
  recheck_verdict: Verdict | null;
  recheck_passed: number | null;
  recheck_total: number | null;
  recheck_at: string | null;
}

export interface Feedback {
  id: string;
  submission_id: string;
  teacher_id: string;
  body: string;
  score_override: number | null;
  released: boolean;
  created_at: string;
}

export interface KpiStudentDaily {
  organization_id: string;
  user_id: string;
  day: string;
  active_minutes: number;
  questions_attempted: number;
  questions_solved: number;
  runs: number;
  submits: number;
  accepted_submits: number;
  typed_chars: number;
  paste_chars: number;
  paste_ratio: number;
  focus_lost_count: number;
  idle_minutes: number;
  computed_at: string;
}

export interface KpiStudentTopic {
  organization_id: string;
  user_id: string;
  topic: string;
  attempted: number;
  solved: number;
  mastery: number;
  computed_at: string;
}

export interface KpiAssessment {
  organization_id: string;
  assessment_id: string;
  user_id: string;
  score: number;
  solved: number;
  total_questions: number;
  time_minutes: number;
  flags: string[];
  computed_at: string;
}

export interface KpiClassDaily {
  class_id: string;
  day: string;
  active_students: number;
  avg_active_minutes: number;
  solve_rate: number | null;
}

export interface StudentOverview {
  daily: KpiStudentDaily[];
  streak: number;
  solved: number;
  attempted: number;
}

export interface ClassStudentRow {
  userId: string;
  fullName: string;
  email: string;
  activeMinutes: number;
  solved: number;
  attempted: number;
  pasteRatio: number | null;
  flags: string[];
  submissions: number;
  lastActive: string | null;
}

export interface CourseBundle {
  course: Course;
  questions: Question[];
  tests: QuestionTest[];
  classIds: string[];
}

export interface StudentDrilldown {
  daily: KpiStudentDaily[];
  topics: KpiStudentTopic[];
  submissions: Submission[];
  profile: Pick<Profile, 'full_name' | 'email'> | null;
}

export interface SubmissionDetail {
  submission: Submission;
  feedback: Feedback[];
  results: TestResultRow[];
}

export interface AssessmentResultRow {
  user_id: string;
  assessment_id: string;
  question_id: string;
  best_attempt_id: string;
  final_verdict: Verdict | null;
  late_status: LateStatus | null;
  recheck_status: RecheckStatus;
  passed: number | null;
  total: number | null;
  attempts_used: number;
  question_points: number;
  points_earned: number;
  score_override: number | null;
  best_received_at: string;
}

export interface AssessmentUserResult {
  user_id: string;
  assessment_id: string;
  questions: number;
  solved: number;
  score: number;
  pending_rechecks: number;
  max_attempts_used: number;
}

export interface TeacherAssessmentResults {
  rows: AssessmentResultRow[];
  totals: AssessmentUserResult[];
  kpi: KpiAssessment[];
  profiles: Profile[];
}

export interface StudentAssessmentResult {
  assessment: Assessment;
  result: KpiAssessment | null;
  feedback: Feedback[];
  results: AssessmentResultRow[];
  total: AssessmentUserResult | null;
}

export interface OrgOverviewPoint {
  day: string;
  activeStudents: number;
  avgActiveMinutes: number;
}

export interface PublishResult {
  packId: string;
  version: number;
  objectPath: string;
  sha256: string;
  size: number;
}

export interface InviteInput {
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN';
  organizationId: string;
  classIds?: string[];
}

export interface FeedbackInput {
  submissionId: string;
  body: string;
  scoreOverride: number | null;
  released: boolean;
}

export interface CourseInput {
  id?: string;
  organizationId: string | null;
  title: string;
  description: string;
  languages: LanguageId[];
}

export interface QuestionInput {
  id?: string;
  courseId: string;
  title: string;
  statementMd: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  points: number;
  topics: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  starterCode: Partial<Record<LanguageId, string>>;
  orderIndex: number;
}

export interface TestInput {
  id?: string;
  kind: 'VISIBLE' | 'HIDDEN';
  ordinal: number;
  input: string;
  expectedOutput: string;
}

export interface AssessmentInput {
  id?: string;
  organizationId: string;
  courseId: string;
  classId: string;
  title: string;
  questionIds: string[];
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  attemptsAllowed: number;
  gracePeriodMinutes: number;
  highStakes: boolean;
}
