import type {
  Assessment,
  AssessmentInput,
  ClassMemberRow,
  ClassRow,
  ClassStudentRow,
  Course,
  CourseInput,
  Department,
  Feedback,
  FeedbackInput,
  InviteInput,
  KpiAssessment,
  KpiClassDaily,
  KpiStudentDaily,
  KpiStudentTopic,
  OrgOverviewPoint,
  Organization,
  Profile,
  PublishResult,
  Question,
  QuestionInput,
  StudentAssessmentResult,
  StudentDrilldown,
  StudentOverview,
  Submission,
  TestInput,
} from '../data/types';
import { ApiError, type DataSource } from '../data/source';
import {
  ASSESSMENT_ID,
  ASSESSMENT_SUBMISSION_ID,
  CLASS_ID,
  COURSE_ID,
  DEPARTMENT_ID,
  ORG_ID,
  OTHER_CLASS_ID,
  OTHER_ORG_ID,
  PLATFORM_COURSE_ID,
  QUESTION_ID,
  QUESTION_ID_2,
  SUBMISSION_ID,
  TEACHER_ID,
  profiles as seedProfiles,
} from './mock-data';

const STUDENT_ID = '22222222-2222-4222-8222-222222222221';
const STUDENT_2_ID = '22222222-2222-4222-8222-222222222222';

export interface MockOptions {
  empty?: boolean;
  publishError?: ApiError | null;
}

interface State {
  organizations: Organization[];
  departments: Department[];
  classes: ClassRow[];
  classMembers: Array<{ class_id: string; user_id: string; role: 'STUDENT' | 'TEACHER'; added_at: string }>;
  courses: Course[];
  questions: Question[];
  tests: Array<{ id: string; question_id: string; kind: 'VISIBLE' | 'HIDDEN'; ordinal: number; input: string; expected_output: string }>;
  classCourses: Array<{ class_id: string; course_id: string }>;
  assessments: Assessment[];
  submissions: Submission[];
  feedback: Feedback[];
  profiles: Profile[];
  kpiDaily: KpiStudentDaily[];
  kpiTopic: KpiStudentTopic[];
  kpiAssessment: KpiAssessment[];
  kpiClassDaily: KpiClassDaily[];
  published: number;
}

function question(id: string, title: string, order: number, difficulty: Question['difficulty']): Question {
  return {
    id,
    course_id: COURSE_ID,
    title,
    statement_md: `# ${title}\n\nGiven two integers, print their **sum**.\n\n- read from stdin\n- write to stdout\n\n\`\`\`\n3 4\n\`\`\`\n`,
    difficulty,
    points: 10,
    topics: ['arrays', 'hashing'],
    time_limit_ms: 2000,
    memory_limit_mb: 256,
    output_limit_kb: 64,
    starter_code: { PYTHON: 'print(sum(map(int, input().split())))' },
    order_index: order,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-20T00:00:00.000Z',
  };
}

function seedState(): State {
  return {
    organizations: [
      { id: ORG_ID, name: 'Northfield College', slug: 'northfield', status: 'ACTIVE', created_at: '2026-01-10T00:00:00.000Z' },
      { id: OTHER_ORG_ID, name: 'Riverdale Institute', slug: 'riverdale', status: 'ACTIVE', created_at: '2026-02-10T00:00:00.000Z' },
    ],
    departments: [{ id: DEPARTMENT_ID, organization_id: ORG_ID, name: 'Computer Science', code: 'CSE', created_at: '2026-01-11T00:00:00.000Z' }],
    classes: [
      {
        id: CLASS_ID,
        organization_id: ORG_ID,
        department_id: DEPARTMENT_ID,
        name: 'CSE 2026 A',
        code: 'CSE26A',
        academic_year: '2026-2027',
        semester: 3,
        created_at: '2026-01-12T00:00:00.000Z',
      },
      {
        id: OTHER_CLASS_ID,
        organization_id: ORG_ID,
        department_id: DEPARTMENT_ID,
        name: 'CSE 2026 B',
        code: 'CSE26B',
        academic_year: '2026-2027',
        semester: 3,
        created_at: '2026-01-12T00:00:00.000Z',
      },
    ],
    classMembers: [
      { class_id: CLASS_ID, user_id: TEACHER_ID, role: 'TEACHER', added_at: '2026-01-13T00:00:00.000Z' },
      { class_id: CLASS_ID, user_id: STUDENT_ID, role: 'STUDENT', added_at: '2026-01-13T00:00:00.000Z' },
      { class_id: CLASS_ID, user_id: STUDENT_2_ID, role: 'STUDENT', added_at: '2026-01-13T00:00:00.000Z' },
    ],
    courses: [
      {
        id: COURSE_ID,
        organization_id: ORG_ID,
        title: 'Data Structures and Algorithms',
        description: 'Core DSA practice course.',
        languages: ['PYTHON', 'JAVA'],
        status: 'PUBLISHED',
        content_status: 'REVIEWED',
        created_by: TEACHER_ID,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-11-20T00:00:00.000Z',
      },
      {
        id: PLATFORM_COURSE_ID,
        organization_id: null,
        title: 'Platform Practice: Arrays',
        description: 'Practice open to every organization.',
        languages: ['PYTHON', 'C', 'CPP', 'JAVA'],
        status: 'DRAFT',
        content_status: 'IMPORTED_UNREVIEWED',
        created_by: null,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-11-21T00:00:00.000Z',
      },
    ],
    questions: [question(QUESTION_ID, 'Two Sum', 0, 'EASY'), question(QUESTION_ID_2, 'Group Anagrams', 1, 'MEDIUM')],
    tests: [
      { id: 't1000000-0000-4000-8000-000000000001', question_id: QUESTION_ID, kind: 'VISIBLE', ordinal: 0, input: '3 4', expected_output: '7' },
      { id: 't1000000-0000-4000-8000-000000000002', question_id: QUESTION_ID, kind: 'HIDDEN', ordinal: 0, input: '10 20', expected_output: '30' },
      { id: 't1000000-0000-4000-8000-000000000003', question_id: QUESTION_ID_2, kind: 'VISIBLE', ordinal: 0, input: 'a b', expected_output: 'ab' },
    ],
    classCourses: [{ class_id: CLASS_ID, course_id: COURSE_ID }],
    assessments: [
      {
        id: ASSESSMENT_ID,
        organization_id: ORG_ID,
        course_id: COURSE_ID,
        class_id: CLASS_ID,
        title: 'Mid-semester assessment',
        question_ids: [QUESTION_ID, QUESTION_ID_2],
        opens_at: '2026-11-25T09:00:00.000Z',
        closes_at: '2026-11-25T11:00:00.000Z',
        duration_minutes: 90,
        attempts_allowed: 2,
        grace_period_minutes: 10,
        high_stakes: true,
        status: 'SCHEDULED',
        created_by: TEACHER_ID,
        created_at: '2026-11-10T00:00:00.000Z',
      },
    ],
    submissions: [
      {
        id: SUBMISSION_ID,
        user_id: STUDENT_ID,
        organization_id: ORG_ID,
        pack_id: `${COURSE_ID}@1`,
        course_id: COURSE_ID,
        question_id: QUESTION_ID,
        assessment_id: null,
        language: 'PYTHON',
        source: 'a, b = map(int, input().split())\nprint(a + b)\n',
        source_sha256: 'a'.repeat(64),
        verdict: 'ACCEPTED',
        passed: 2,
        total: 2,
        total_time_ms: 120,
        results_json: [
          { testId: 'v1', hidden: false, verdict: 'ACCEPTED', timeMs: 60, memoryKb: 3200, stdout: '7', stderr: null, expectedOutput: '7', input: '3 4' },
          { testId: 'h1', hidden: true, verdict: 'ACCEPTED', timeMs: 60, memoryKb: 3100, stdout: null, stderr: null, expectedOutput: null, input: null },
        ],
        started_at: '2026-11-20T10:00:00.000Z',
        finished_at: '2026-11-20T10:01:00.000Z',
        monotonic_seq: 12,
        device_id: 'abababab-abab-4bab-8bab-abababababab',
        received_at: '2026-11-20T11:00:00.000Z',
        late_status: 'ON_TIME',
        recheck_status: 'NOT_REQUIRED',
        recheck_verdict: null,
        recheck_passed: null,
        recheck_total: null,
        recheck_at: null,
      },
      {
        id: ASSESSMENT_SUBMISSION_ID,
        user_id: STUDENT_ID,
        organization_id: ORG_ID,
        pack_id: `${ASSESSMENT_ID}@1`,
        course_id: COURSE_ID,
        question_id: QUESTION_ID_2,
        assessment_id: ASSESSMENT_ID,
        language: 'JAVA',
        source: 'class Solution { public static void main(String[] a) {} }\n',
        source_sha256: 'b'.repeat(64),
        verdict: 'WRONG_ANSWER',
        passed: 0,
        total: 1,
        total_time_ms: 200,
        results_json: [
          { testId: 'v2', hidden: false, verdict: 'WRONG_ANSWER', timeMs: 200, memoryKb: 5200, stdout: 'x', stderr: null, expectedOutput: 'ab', input: 'a b' },
          { testId: 'h2', hidden: true, verdict: 'WRONG_ANSWER', timeMs: 200, memoryKb: 5000, stdout: null, stderr: null, expectedOutput: null, input: null },
        ],
        started_at: '2026-11-21T10:00:00.000Z',
        finished_at: '2026-11-21T10:05:00.000Z',
        monotonic_seq: 20,
        device_id: 'abababab-abab-4bab-8bab-abababababab',
        received_at: '2026-11-23T08:00:00.000Z',
        late_status: 'FINISHED_OFFLINE_SYNCED_LATE',
        recheck_status: 'QUEUED',
        recheck_verdict: null,
        recheck_passed: null,
        recheck_total: null,
        recheck_at: null,
      },
    ],
    feedback: [
      {
        id: 'f1000000-0000-4000-8000-000000000001',
        submission_id: SUBMISSION_ID,
        teacher_id: TEACHER_ID,
        body: 'Clean solution. Try the two-pointer variant next.',
        score_override: null,
        released: true,
        created_at: '2026-11-21T09:00:00.000Z',
      },
      {
        id: 'f1000000-0000-4000-8000-000000000002',
        submission_id: ASSESSMENT_SUBMISSION_ID,
        teacher_id: TEACHER_ID,
        body: 'Draft note: review the hash-key step.',
        score_override: 3,
        released: false,
        created_at: '2026-11-22T09:00:00.000Z',
      },
    ],
    profiles: seedProfiles.map((profile) => ({ ...profile })),
    kpiDaily: [
      {
        organization_id: ORG_ID,
        user_id: STUDENT_ID,
        day: '2026-11-20',
        active_minutes: 45.5,
        questions_attempted: 2,
        questions_solved: 1,
        runs: 4,
        submits: 2,
        accepted_submits: 1,
        typed_chars: 900,
        paste_chars: 120,
        paste_ratio: 0.118,
        focus_lost_count: 2,
        idle_minutes: 3,
        computed_at: nowIso(),
      },
      {
        organization_id: ORG_ID,
        user_id: STUDENT_ID,
        day: '2026-11-21',
        active_minutes: 30,
        questions_attempted: 1,
        questions_solved: 0,
        runs: 2,
        submits: 1,
        accepted_submits: 0,
        typed_chars: 300,
        paste_chars: 0,
        paste_ratio: 0,
        focus_lost_count: 0,
        idle_minutes: 1,
        computed_at: nowIso(),
      },
      {
        organization_id: ORG_ID,
        user_id: STUDENT_ID,
        day: '2026-11-22',
        active_minutes: 20,
        questions_attempted: 1,
        questions_solved: 1,
        runs: 3,
        submits: 1,
        accepted_submits: 1,
        typed_chars: 500,
        paste_chars: 40,
        paste_ratio: 0.074,
        focus_lost_count: 1,
        idle_minutes: 0,
        computed_at: nowIso(),
      },
      {
        organization_id: ORG_ID,
        user_id: STUDENT_2_ID,
        day: '2026-11-21',
        active_minutes: 12,
        questions_attempted: 1,
        questions_solved: 0,
        runs: 1,
        submits: 1,
        accepted_submits: 0,
        typed_chars: 60,
        paste_chars: 900,
        paste_ratio: 0.938,
        focus_lost_count: 24,
        idle_minutes: 2,
        computed_at: nowIso(),
      },
    ],
    kpiTopic: [
      { organization_id: ORG_ID, user_id: STUDENT_ID, topic: 'arrays', attempted: 3, solved: 2, mastery: 60, computed_at: nowIso() },
      { organization_id: ORG_ID, user_id: STUDENT_ID, topic: 'hashing', attempted: 2, solved: 1, mastery: 50, computed_at: nowIso() },
      { organization_id: ORG_ID, user_id: STUDENT_2_ID, topic: 'arrays', attempted: 1, solved: 0, mastery: 33, computed_at: nowIso() },
    ],
    kpiAssessment: [
      {
        organization_id: ORG_ID,
        assessment_id: ASSESSMENT_ID,
        user_id: STUDENT_ID,
        score: 10,
        solved: 1,
        total_questions: 2,
        time_minutes: 30,
        flags: ['MANY_FOCUS_LOSS'],
        computed_at: nowIso(),
      },
    ],
    kpiClassDaily: [
      { class_id: CLASS_ID, day: '2026-11-20', active_students: 2, avg_active_minutes: 28.8, solve_rate: 0.5 },
      { class_id: CLASS_ID, day: '2026-11-21', active_students: 2, avg_active_minutes: 21, solve_rate: 0.3 },
      { class_id: CLASS_ID, day: '2026-11-22', active_students: 1, avg_active_minutes: 20, solve_rate: 1 },
    ],
    published: 0,
  };
}

function nowIso() {
  return '2026-11-24T12:00:00.000Z';
}

const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);

export function createMockSource(options: MockOptions = {}): DataSource {
  const state = seedState();
  const empty = options.empty ?? false;
  const published = (kind: 'COURSE' | 'ASSESSMENT', id: string): PublishResult => {
    if (options.publishError) throw options.publishError;
    state.published += 1;
    return {
      packId: `${id}@${state.published}`,
      version: state.published,
      objectPath: `packs/${kind.toLowerCase()}/${id}/${state.published}.lpack`,
      sha256: 'c'.repeat(64),
      size: 2048,
    };
  };

  const studentOverview = async (userId: string): Promise<StudentOverview> => {
    if (empty) return { daily: [], streak: 0, solved: 0, attempted: 0 };
    const daily = state.kpiDaily.filter((row) => row.user_id === userId);
    const submissions = state.submissions.filter((row) => row.user_id === userId);
    const attempted = new Set(submissions.map((row) => row.question_id));
    const solved = new Set(submissions.filter((row) => row.verdict === 'ACCEPTED').map((row) => row.question_id));
    const activeDays = new Set(daily.filter((row) => Number(row.active_minutes) > 0).map((row) => row.day));
    return { daily, streak: Math.min(activeDays.size, 3), solved: solved.size, attempted: attempted.size };
  };

  return {
    studentOverview,
    async studentTopics(userId) {
      return empty ? [] : state.kpiTopic.filter((row) => row.user_id === userId);
    },
    async studentSubmissions(userId) {
      return empty ? [] : state.submissions.filter((row) => row.user_id === userId);
    },
    async studentSubmission(userId, submissionId) {
      const submission = state.submissions.find((row) => row.id === submissionId && row.user_id === userId);
      if (!submission) throw notFound('Submission not found');
      return {
        submission,
        feedback: state.feedback.filter((row) => row.submission_id === submissionId && row.released),
        results: submission.results_json.filter((row) => row.hidden === false),
      };
    },
    async studentAssessments(userId): Promise<StudentAssessmentResult[]> {
      if (empty) return [];
      return state.assessments
        .filter((row) => row.status !== 'DRAFT')
        .map((assessment) => ({
          assessment,
          result: state.kpiAssessment.find((row) => row.assessment_id === assessment.id && row.user_id === userId) ?? null,
          feedback: state.feedback.filter((entry) => {
            if (!entry.released) return false;
            const submission = state.submissions.find((row) => row.id === entry.submission_id);
            return submission?.assessment_id === assessment.id && submission.user_id === userId;
          }),
        }));
    },
    async teacherClasses(userId) {
      if (empty) return [];
      const ids = state.classMembers.filter((row) => row.user_id === userId && row.role === 'TEACHER').map((row) => row.class_id);
      return state.classes.filter((row) => ids.includes(row.id));
    },
    async classDaily(classId) {
      return empty ? [] : state.kpiClassDaily.filter((row) => row.class_id === classId);
    },
    async classStudents(classId): Promise<ClassStudentRow[]> {
      if (empty) return [];
      const ids = state.classMembers.filter((row) => row.class_id === classId && row.role === 'STUDENT').map((row) => row.user_id);
      return ids.map((userId) => {
        const profile = state.profiles.find((row) => row.id === userId);
        const daily = state.kpiDaily.filter((row) => row.user_id === userId);
        const submissions = state.submissions.filter((row) => row.user_id === userId);
        const typed = daily.reduce((sum, row) => sum + Number(row.typed_chars), 0);
        const pasted = daily.reduce((sum, row) => sum + Number(row.paste_chars), 0);
        return {
          userId,
          fullName: profile?.full_name ?? 'Unknown',
          email: profile?.email ?? '',
          activeMinutes: daily.reduce((sum, row) => sum + Number(row.active_minutes), 0),
          solved: new Set(submissions.filter((row) => row.verdict === 'ACCEPTED').map((row) => row.question_id)).size,
          attempted: new Set(submissions.map((row) => row.question_id)).size,
          pasteRatio: typed + pasted > 0 ? pasted / (typed + pasted) : null,
          flags: Array.from(new Set(state.kpiAssessment.filter((row) => row.user_id === userId).flatMap((row) => row.flags))),
          submissions: submissions.length,
          lastActive: daily.reduce<string | null>((latest, row) => (!latest || row.day > latest ? row.day : latest), null),
        };
      });
    },
    async studentDrilldown(userId): Promise<StudentDrilldown> {
      const profile = state.profiles.find((row) => row.id === userId);
      return {
        daily: state.kpiDaily.filter((row) => row.user_id === userId),
        topics: state.kpiTopic.filter((row) => row.user_id === userId),
        submissions: state.submissions.filter((row) => row.user_id === userId),
        profile: profile ? { full_name: profile.full_name, email: profile.email } : null,
      };
    },
    async reviewSubmission(submissionId) {
      const submission = state.submissions.find((row) => row.id === submissionId);
      if (!submission) throw notFound('Submission not found');
      return { submission, feedback: state.feedback.filter((row) => row.submission_id === submissionId), results: submission.results_json };
    },
    async saveFeedback(input: FeedbackInput) {
      const feedback: Feedback = {
        id: crypto.randomUUID(),
        submission_id: input.submissionId,
        teacher_id: TEACHER_ID,
        body: input.body,
        score_override: input.scoreOverride,
        released: input.released,
        created_at: nowIso(),
      };
      state.feedback.push(feedback);
      return feedback;
    },
    async teacherCourses(userId) {
      if (empty) return [];
      return state.courses.filter((row) => row.organization_id === ORG_ID || row.created_by === userId);
    },
    async courseBundle(courseId) {
      const course = state.courses.find((row) => row.id === courseId);
      if (!course) throw notFound('Course not found');
      const questions = state.questions.filter((row) => row.course_id === courseId);
      return {
        course,
        questions,
        tests: state.tests.filter((test) => questions.some((row) => row.id === test.question_id)),
        classIds: state.classCourses.filter((row) => row.course_id === courseId).map((row) => row.class_id),
      };
    },
    async saveCourse(input: CourseInput) {
      const existing = input.id ? state.courses.find((row) => row.id === input.id) : undefined;
      if (existing) {
        existing.title = input.title;
        existing.description = input.description;
        existing.languages = input.languages;
        existing.updated_at = nowIso();
        return existing;
      }
      const course: Course = {
        id: crypto.randomUUID(),
        organization_id: input.organizationId,
        title: input.title,
        description: input.description,
        languages: input.languages,
        status: 'DRAFT',
        content_status: 'REVIEWED',
        created_by: TEACHER_ID,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.courses.push(course);
      return course;
    },
    async saveQuestion(input: QuestionInput) {
      const existing = input.id ? state.questions.find((row) => row.id === input.id) : undefined;
      if (existing) {
        Object.assign(existing, {
          title: input.title,
          statement_md: input.statementMd,
          difficulty: input.difficulty,
          points: input.points,
          topics: input.topics,
          time_limit_ms: input.timeLimitMs,
          memory_limit_mb: input.memoryLimitMb,
          output_limit_kb: input.outputLimitKb,
          starter_code: input.starterCode,
          order_index: input.orderIndex,
          updated_at: nowIso(),
        });
        return existing;
      }
      const created: Question = {
        id: crypto.randomUUID(),
        course_id: input.courseId,
        title: input.title,
        statement_md: input.statementMd,
        difficulty: input.difficulty,
        points: input.points,
        topics: input.topics,
        time_limit_ms: input.timeLimitMs,
        memory_limit_mb: input.memoryLimitMb,
        output_limit_kb: input.outputLimitKb,
        starter_code: input.starterCode,
        order_index: input.orderIndex,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.questions.push(created);
      return created;
    },
    async reorderQuestions(_courseId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const row = state.questions.find((question) => question.id === id);
        if (row) row.order_index = index;
      });
    },
    async deleteQuestion(questionId) {
      state.questions = state.questions.filter((row) => row.id !== questionId);
      state.tests = state.tests.filter((row) => row.question_id !== questionId);
    },
    async saveTests(questionId, tests: TestInput[]) {
      state.tests = state.tests.filter((row) => row.question_id !== questionId);
      tests.forEach((test, index) => {
        state.tests.push({
          id: test.id ?? crypto.randomUUID(),
          question_id: questionId,
          kind: test.kind,
          ordinal: test.ordinal ?? index,
          input: test.input,
          expected_output: test.expectedOutput,
        });
      });
    },
    async linkClass(courseId, classId) {
      if (!state.classCourses.some((row) => row.course_id === courseId && row.class_id === classId)) {
        state.classCourses.push({ course_id: courseId, class_id: classId });
      }
    },
    async unlinkClass(courseId, classId) {
      state.classCourses = state.classCourses.filter((row) => !(row.course_id === courseId && row.class_id === classId));
    },
    async publishCourse(courseId) {
      return published('COURSE', courseId);
    },
    async teacherAssessments(userId) {
      if (empty) return [];
      const classIds = state.classMembers.filter((row) => row.user_id === userId && row.role === 'TEACHER').map((row) => row.class_id);
      return state.assessments
        .filter((row) => classIds.includes(row.class_id))
        .map((row) => ({
          ...row,
          class_name: state.classes.find((klass) => klass.id === row.class_id)?.name,
          course_title: state.courses.find((course) => course.id === row.course_id)?.title,
        }));
    },
    async getAssessment(assessmentId) {
      const assessment = state.assessments.find((row) => row.id === assessmentId);
      if (!assessment) throw notFound('Assessment not found');
      return { assessment, questions: state.questions.filter((row) => assessment.question_ids.includes(row.id)) };
    },
    async saveAssessment(input: AssessmentInput) {
      const existing = input.id ? state.assessments.find((row) => row.id === input.id) : undefined;
      if (existing) {
        Object.assign(existing, {
          title: input.title,
          question_ids: input.questionIds,
          opens_at: input.opensAt,
          closes_at: input.closesAt,
          duration_minutes: input.durationMinutes,
          attempts_allowed: input.attemptsAllowed,
          grace_period_minutes: input.gracePeriodMinutes,
          high_stakes: input.highStakes,
        });
        return existing;
      }
      const created: Assessment = {
        id: crypto.randomUUID(),
        organization_id: input.organizationId,
        course_id: input.courseId,
        class_id: input.classId,
        title: input.title,
        question_ids: input.questionIds,
        opens_at: input.opensAt,
        closes_at: input.closesAt,
        duration_minutes: input.durationMinutes,
        attempts_allowed: input.attemptsAllowed,
        grace_period_minutes: input.gracePeriodMinutes,
        high_stakes: input.highStakes,
        status: 'DRAFT',
        created_by: TEACHER_ID,
        created_at: nowIso(),
      };
      state.assessments.push(created);
      return created;
    },
    async publishAssessment(assessmentId) {
      return published('ASSESSMENT', assessmentId);
    },
    async adminDepartments() {
      return empty ? [] : state.departments;
    },
    async saveDepartment(input) {
      const existing = input.id ? state.departments.find((row) => row.id === input.id) : undefined;
      if (existing) {
        existing.name = input.name;
        existing.code = input.code;
        return existing;
      }
      const created: Department = { id: crypto.randomUUID(), organization_id: input.organizationId, name: input.name, code: input.code, created_at: nowIso() };
      state.departments.push(created);
      return created;
    },
    async deleteDepartment(departmentId) {
      state.departments = state.departments.filter((row) => row.id !== departmentId);
    },
    async adminClasses() {
      return empty ? [] : state.classes;
    },
    async saveClass(input) {
      const existing = input.id ? state.classes.find((row) => row.id === input.id) : undefined;
      if (existing) {
        Object.assign(existing, {
          department_id: input.departmentId,
          name: input.name,
          code: input.code,
          academic_year: input.academicYear,
          semester: input.semester,
        });
        return existing;
      }
      const created: ClassRow = {
        id: crypto.randomUUID(),
        organization_id: input.organizationId,
        department_id: input.departmentId,
        name: input.name,
        code: input.code,
        academic_year: input.academicYear,
        semester: input.semester,
        created_at: nowIso(),
      };
      state.classes.push(created);
      return created;
    },
    async deleteClass(classId) {
      state.classes = state.classes.filter((row) => row.id !== classId);
    },
    async classMembers(classId): Promise<ClassMemberRow[]> {
      if (empty) return [];
      return state.classMembers
        .filter((row) => row.class_id === classId)
        .map((row) => {
          const profile = state.profiles.find((candidate) => candidate.id === row.user_id);
          return {
            ...row,
            profile: profile
              ? { full_name: profile.full_name, email: profile.email, role: profile.role, status: profile.status }
              : null,
          };
        });
    },
    async addClassMember(classId, userId, role) {
      state.classMembers.push({ class_id: classId, user_id: userId, role, added_at: nowIso() });
    },
    async removeClassMember(classId, userId) {
      state.classMembers = state.classMembers.filter((row) => !(row.class_id === classId && row.user_id === userId));
    },
    async orgProfiles() {
      return state.profiles.filter((row) => row.organization_id === ORG_ID);
    },
    async inviteUser(input: InviteInput) {
      const id = crypto.randomUUID();
      state.profiles.push({
        id,
        organization_id: input.organizationId,
        role: input.role,
        full_name: input.fullName,
        email: input.email,
        department_id: null,
        status: 'ACTIVE',
        created_at: nowIso(),
      });
      for (const classId of input.classIds ?? []) {
        state.classMembers.push({ class_id: classId, user_id: id, role: input.role === 'TEACHER' ? 'TEACHER' : 'STUDENT', added_at: nowIso() });
      }
      return { userId: id };
    },
    async orgOverview(): Promise<OrgOverviewPoint[]> {
      if (empty) return [];
      const byDay = new Map<string, { students: number; minutes: number[] }>();
      for (const row of state.kpiClassDaily) {
        const entry = byDay.get(row.day) ?? { students: 0, minutes: [] };
        entry.students += row.active_students;
        entry.minutes.push(Number(row.avg_active_minutes));
        byDay.set(row.day, entry);
      }
      return Array.from(byDay.entries()).map(([day, value]) => ({
        day,
        activeStudents: value.students,
        avgActiveMinutes: Math.round((value.minutes.reduce((a, b) => a + b, 0) / value.minutes.length) * 10) / 10,
      }));
    },
    async ownerOrganizations() {
      return empty ? [] : state.organizations;
    },
    async createOrganization(input) {
      const created: Organization = { id: crypto.randomUUID(), name: input.name, slug: input.slug, status: 'ACTIVE', created_at: nowIso() };
      state.organizations.push(created);
      return created;
    },
    async ownerCourses() {
      return empty ? [] : state.courses.filter((row) => row.organization_id === null);
    },
  };
}
