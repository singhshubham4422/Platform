import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Assessment,
  AssessmentInput,
  AssessmentRow,
  AssessmentResultRow,
  AssessmentUserResult,
  TeacherAssessmentResults,
  ClassMemberRow,
  ClassRow,
  ClassStudentRow,
  Course,
  CourseBundle,
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
  SubmissionDetail,
  TestInput,
  TestResultRow,
} from './types';
import { ApiError, type DataSource } from './source';

interface DbError {
  message?: string;
  code?: string;
}

async function run<T>(query: PromiseLike<{ data: unknown; error: DbError | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new ApiError(400, error.code ?? 'DATABASE_ERROR', error.message ?? 'Database operation failed');
  return data as T;
}

async function runOne<T>(query: PromiseLike<{ data: unknown; error: DbError | null }>, message = 'Not found'): Promise<T> {
  const data = await run<T>(query);
  if (data === null || data === undefined) throw new ApiError(404, 'NOT_FOUND', message);
  return data;
}

const dayKey = (value: string | Date) => new Date(value).toISOString().slice(0, 10);
const daysAgo = (n: number) => dayKey(new Date(Date.now() - n * 86_400_000));

function computeStreak(daily: KpiStudentDaily[]): number {
  const active = new Set(daily.filter((d) => Number(d.active_minutes) > 0).map((d) => d.day));
  const cursor = new Date();
  if (!active.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (active.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function stripHiddenResults(results: unknown): TestResultRow[] {
  if (!Array.isArray(results)) return [];
  return (results as TestResultRow[]).filter((r) => r && typeof r === 'object' && r.hidden === false);
}

export class SupabaseDataSource implements DataSource {
  private readonly sb: SupabaseClient;
  private readonly functionsUrl: string;

  constructor(sb: SupabaseClient, functionsUrl: string) {
    this.sb = sb;
    this.functionsUrl = functionsUrl.replace(/\/$/, '');
  }

  private async callFunction<T>(name: string, body: unknown): Promise<T> {
    const { data, error } = await this.sb.auth.getSession();
    if (error || !data.session) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again to continue');
    const res = await fetch(`${this.functionsUrl}/${name}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
      throw new ApiError(res.status, payload.error ?? 'FUNCTION_FAILED', payload.message ?? `Request failed (${res.status})`);
    }
    return payload as T;
  }

  async studentOverview(userId: string): Promise<StudentOverview> {
    const [daily, submissions] = await Promise.all([
      run<KpiStudentDaily[]>(
        this.sb
          .from('kpi_student_daily')
          .select('*')
          .eq('user_id', userId)
          .gte('day', daysAgo(29))
          .order('day', { ascending: true }),
      ),
      run<Array<Pick<Submission, 'question_id' | 'verdict'>>>(
        this.sb.from('submissions').select('question_id,verdict').eq('user_id', userId),
      ),
    ]);
    const attempted = new Set(submissions.map((s) => s.question_id));
    const solved = new Set(submissions.filter((s) => s.verdict === 'ACCEPTED').map((s) => s.question_id));
    return { daily, streak: computeStreak(daily), solved: solved.size, attempted: attempted.size };
  }

  async studentTopics(userId: string): Promise<KpiStudentTopic[]> {
    return run<KpiStudentTopic[]>(
      this.sb.from('kpi_student_topic').select('*').eq('user_id', userId).order('topic', { ascending: true }),
    );
  }

  async studentSubmissions(userId: string): Promise<Submission[]> {
    return run<Submission[]>(
      this.sb.from('submissions').select('*').eq('user_id', userId).order('finished_at', { ascending: false }),
    );
  }

  async studentSubmission(userId: string, submissionId: string): Promise<SubmissionDetail> {
    const submission = await runOne<Submission>(
      this.sb.from('submissions').select('*').eq('id', submissionId).eq('user_id', userId).maybeSingle(),
      'Submission not found',
    );
    const feedback = await run<Feedback[]>(
      this.sb.from('feedback').select('*').eq('submission_id', submissionId).eq('released', true).order('created_at'),
    );
    return { submission, feedback, results: stripHiddenResults(submission.results_json) };
  }

  async studentAssessments(userId: string): Promise<StudentAssessmentResult[]> {
    const [assessments, results, submissions] = await Promise.all([
      run<Assessment[]>(this.sb.from('assessments').select('*').in('status', ['SCHEDULED', 'CLOSED']).order('opens_at')),
      run<KpiAssessment[]>(this.sb.from('kpi_assessment').select('*').eq('user_id', userId)),
      run<Array<Pick<Submission, 'id' | 'assessment_id'>>>(this.sb.from('submissions').select('id,assessment_id').eq('user_id', userId)),
    ]);
    const submissionIds = submissions.filter((s) => s.assessment_id).map((s) => s.id);
    const feedback = submissionIds.length
      ? await run<Feedback[]>(this.sb.from('feedback').select('*').in('submission_id', submissionIds).eq('released', true))
      : [];
    const closedIds = assessments.filter((a) => a.status === 'CLOSED').map((a) => a.id);
    const [rows, totals] = closedIds.length
      ? await Promise.all([
          run<AssessmentResultRow[]>(this.sb.from('assessment_results').select('*').eq('user_id', userId).in('assessment_id', closedIds)),
          run<AssessmentUserResult[]>(this.sb.from('assessment_user_results').select('*').eq('user_id', userId).in('assessment_id', closedIds)),
        ])
      : [[] as AssessmentResultRow[], [] as AssessmentUserResult[]];
    return assessments.map((assessment) => ({
      assessment,
      result: assessment.status === 'CLOSED' ? results.find((r) => r.assessment_id === assessment.id) ?? null : null,
      feedback: assessment.status === 'CLOSED'
        ? feedback.filter((f) => submissionIds.includes(f.submission_id) && submissions.find((s) => s.id === f.submission_id)?.assessment_id === assessment.id)
        : [],
      results: rows.filter((r) => r.assessment_id === assessment.id),
      total: totals.find((t) => t.assessment_id === assessment.id) ?? null,
    }));
  }

  async teacherClasses(userId: string): Promise<ClassRow[]> {
    const memberships = await run<Array<{ class_id: string }>>(
      this.sb.from('class_members').select('class_id').eq('user_id', userId).eq('role', 'TEACHER'),
    );
    if (!memberships.length) return [];
    return run<ClassRow[]>(
      this.sb.from('classes').select('*').in('id', memberships.map((m) => m.class_id)).order('name'),
    );
  }

  async classDaily(classId: string): Promise<KpiClassDaily[]> {
    return run<KpiClassDaily[]>(
      this.sb.from('kpi_class_daily').select('*').eq('class_id', classId).order('day', { ascending: true }),
    );
  }

  async classStudents(classId: string): Promise<ClassStudentRow[]> {
    const members = await run<Array<{ user_id: string }>>(
      this.sb.from('class_members').select('user_id').eq('class_id', classId).eq('role', 'STUDENT'),
    );
    if (!members.length) return [];
    const ids = members.map((m) => m.user_id);
    const since = daysAgo(29);
    const [profiles, daily, kpi, submissions] = await Promise.all([
      run<Profile[]>(this.sb.from('profiles').select('id,full_name,email').in('id', ids)),
      run<KpiStudentDaily[]>(this.sb.from('kpi_student_daily').select('*').in('user_id', ids).gte('day', since)),
      run<KpiAssessment[]>(this.sb.from('kpi_assessment').select('*').in('user_id', ids)),
      run<Array<Pick<Submission, 'user_id' | 'question_id' | 'verdict'>>>(this.sb.from('submissions').select('user_id,question_id,verdict').in('user_id', ids)),
    ]);
    return ids.map((userId) => {
      const profile = profiles.find((p) => p.id === userId);
      const rows = daily.filter((d) => d.user_id === userId);
      const mine = submissions.filter((s) => s.user_id === userId);
      const typed = rows.reduce((sum, d) => sum + Number(d.typed_chars), 0);
      const pasted = rows.reduce((sum, d) => sum + Number(d.paste_chars), 0);
      const attempted = new Set(mine.map((s) => s.question_id));
      const solved = new Set(mine.filter((s) => s.verdict === 'ACCEPTED').map((s) => s.question_id));
      return {
        userId,
        fullName: profile?.full_name ?? 'Unknown student',
        email: profile?.email ?? '',
        activeMinutes: rows.reduce((sum, d) => sum + Number(d.active_minutes), 0),
        solved: solved.size,
        attempted: attempted.size,
        pasteRatio: typed + pasted > 0 ? pasted / (typed + pasted) : null,
        flags: Array.from(new Set(kpi.filter((k) => k.user_id === userId).flatMap((k) => k.flags))),
        submissions: mine.length,
        lastActive: rows.reduce<string | null>((latest, d) => (!latest || d.day > latest ? d.day : latest), null),
      };
    });
  }

  async studentDrilldown(userId: string): Promise<StudentDrilldown> {
    const [daily, topics, submissions, profile] = await Promise.all([
      run<KpiStudentDaily[]>(
        this.sb.from('kpi_student_daily').select('*').eq('user_id', userId).gte('day', daysAgo(29)).order('day'),
      ),
      run<KpiStudentTopic[]>(this.sb.from('kpi_student_topic').select('*').eq('user_id', userId).order('topic')),
      run<Submission[]>(this.sb.from('submissions').select('*').eq('user_id', userId).order('finished_at', { ascending: false })),
      run<Pick<Profile, 'full_name' | 'email'> | null>(this.sb.from('profiles').select('full_name,email').eq('id', userId).maybeSingle()),
    ]);
    return { daily, topics, submissions, profile: profile ?? null };
  }

  async reviewSubmission(submissionId: string): Promise<SubmissionDetail> {
    const submission = await runOne<Submission>(
      this.sb.from('submissions').select('*').eq('id', submissionId).maybeSingle(),
      'Submission not found',
    );
    const feedback = await run<Feedback[]>(
      this.sb.from('feedback').select('*').eq('submission_id', submissionId).order('created_at'),
    );
    return { submission, feedback, results: Array.isArray(submission.results_json) ? submission.results_json : [] };
  }

  async saveFeedback(input: FeedbackInput): Promise<Feedback> {
    const user = await this.sb.auth.getUser();
    if (user.error || !user.data.user) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again to continue');
    return runOne<Feedback>(
      this.sb
        .from('feedback')
        .insert({
          submission_id: input.submissionId,
          teacher_id: user.data.user.id,
          body: input.body,
          score_override: input.scoreOverride,
          released: input.released,
        })
        .select('*')
        .single(),
      'Feedback could not be saved',
    );
  }

  async teacherCourses(userId: string): Promise<Course[]> {
    const classes = await this.teacherClasses(userId);
    const linked = classes.length
      ? await run<Array<{ course_id: string }>>(
          this.sb.from('class_courses').select('course_id').in('class_id', classes.map((c) => c.id)),
        )
      : [];
    const ids = new Set(linked.map((l) => l.course_id));
    const courses = await run<Course[]>(this.sb.from('courses').select('*').order('created_at', { ascending: false }));
    return courses.filter((c) => ids.has(c.id) || c.created_by === userId);
  }

  async courseBundle(courseId: string): Promise<CourseBundle> {
    const [course, questions, classLinks] = await Promise.all([
      runOne<Course>(this.sb.from('courses').select('*').eq('id', courseId).maybeSingle(), 'Course not found'),
      run<Question[]>(this.sb.from('questions').select('*').eq('course_id', courseId).order('order_index')),
      run<Array<{ class_id: string }>>(this.sb.from('class_courses').select('class_id').eq('course_id', courseId)),
    ]);
    const tests = questions.length
      ? await run<CourseBundle['tests']>(
          this.sb.from('question_tests').select('*').in('question_id', questions.map((q) => q.id)).order('ordinal'),
        )
      : [];
    return { course, questions, tests, classIds: classLinks.map((c) => c.class_id) };
  }

  async saveCourse(input: CourseInput): Promise<Course> {
    const values = {
      organization_id: input.organizationId,
      title: input.title,
      description: input.description,
      languages: input.languages,
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      return runOne<Course>(this.sb.from('courses').update(values).eq('id', input.id).select('*').single(), 'Course not found');
    }
    const user = await this.sb.auth.getUser();
    return runOne<Course>(
      this.sb.from('courses').insert({ ...values, created_by: user.data.user?.id ?? null }).select('*').single(),
      'Course could not be created',
    );
  }

  async saveQuestion(input: QuestionInput): Promise<Question> {
    const values = {
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
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      return runOne<Question>(this.sb.from('questions').update(values).eq('id', input.id).select('*').single(), 'Question not found');
    }
    return runOne<Question>(this.sb.from('questions').insert(values).select('*').single(), 'Question could not be created');
  }

  async reorderQuestions(courseId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await run(
        this.sb.from('questions').update({ order_index: index, updated_at: new Date().toISOString() }).eq('id', id).eq('course_id', courseId),
      );
    }
  }

  async deleteQuestion(questionId: string): Promise<void> {
    await run(this.sb.from('questions').delete().eq('id', questionId));
  }

  async saveTests(questionId: string, tests: TestInput[]): Promise<void> {
    await run(this.sb.from('question_tests').delete().eq('question_id', questionId));
    if (!tests.length) return;
    await run(
      this.sb.from('question_tests').insert(
        tests.map((test, index) => ({
          ...(test.id ? { id: test.id } : {}),
          question_id: questionId,
          kind: test.kind,
          ordinal: index,
          input: test.input,
          expected_output: test.expectedOutput,
        })),
      ),
    );
  }

  async linkClass(courseId: string, classId: string): Promise<void> {
    await run(this.sb.from('class_courses').insert({ course_id: courseId, class_id: classId }));
  }

  async unlinkClass(courseId: string, classId: string): Promise<void> {
    await run(this.sb.from('class_courses').delete().eq('course_id', courseId).eq('class_id', classId));
  }

  async publishCourse(courseId: string): Promise<PublishResult> {
    return this.callFunction<PublishResult>('publish-pack', { courseId });
  }

  async teacherAssessments(userId: string): Promise<AssessmentRow[]> {
    const classes = await this.teacherClasses(userId);
    const classIds = classes.map((c) => c.id);
    const assessments = classIds.length
      ? await run<Assessment[]>(this.sb.from('assessments').select('*').in('class_id', classIds).order('opens_at', { ascending: false }))
      : [];
    if (!assessments.length) return [];
    const courseIds = Array.from(new Set(assessments.map((a) => a.course_id)));
    const courses = await run<Array<{ id: string; title: string }>>(this.sb.from('courses').select('id,title').in('id', courseIds));
    return assessments.map((a) => ({
      ...a,
      class_name: classes.find((c) => c.id === a.class_id)?.name,
      course_title: courses.find((c) => c.id === a.course_id)?.title,
    }));
  }

  async getAssessment(assessmentId: string): Promise<{ assessment: Assessment; questions: Question[] }> {
    const assessment = await runOne<Assessment>(
      this.sb.from('assessments').select('*').eq('id', assessmentId).maybeSingle(),
      'Assessment not found',
    );
    const questions = assessment.question_ids.length
      ? await run<Question[]>(this.sb.from('questions').select('*').in('id', assessment.question_ids).order('order_index'))
      : [];
    return { assessment, questions };
  }

  async saveAssessment(input: AssessmentInput): Promise<Assessment> {
    const values = {
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
    };
    if (input.id) {
      return runOne<Assessment>(this.sb.from('assessments').update(values).eq('id', input.id).select('*').single(), 'Assessment not found');
    }
    const user = await this.sb.auth.getUser();
    return runOne<Assessment>(
      this.sb
        .from('assessments')
        .insert({ ...values, status: 'DRAFT', created_by: user.data.user?.id ?? null })
        .select('*')
        .single(),
      'Assessment could not be created',
    );
  }

  async publishAssessment(assessmentId: string): Promise<PublishResult> {
    return this.callFunction<PublishResult>('publish-pack', { assessmentId });
  }

  async teacherAssessmentResults(assessmentId: string): Promise<TeacherAssessmentResults> {
    const [rows, totals, kpi] = await Promise.all([
      run<AssessmentResultRow[]>(this.sb.from('assessment_results').select('*').eq('assessment_id', assessmentId)),
      run<AssessmentUserResult[]>(this.sb.from('assessment_user_results').select('*').eq('assessment_id', assessmentId)),
      run<KpiAssessment[]>(this.sb.from('kpi_assessment').select('*').eq('assessment_id', assessmentId)),
    ]);
    const userIds = Array.from(new Set([...rows.map((r) => r.user_id), ...totals.map((t) => t.user_id), ...kpi.map((k) => k.user_id)]));
    const profiles = userIds.length
      ? await run<Profile[]>(this.sb.from('profiles').select('*').in('id', userIds).order('full_name'))
      : [];
    return { rows, totals, kpi, profiles };
  }

  async adminDepartments(): Promise<Department[]> {
    return run<Department[]>(this.sb.from('departments').select('*').order('name'));
  }

  async saveDepartment(input: { id?: string; organizationId: string; name: string; code: string }): Promise<Department> {
    if (input.id) {
      return runOne<Department>(
        this.sb.from('departments').update({ name: input.name, code: input.code }).eq('id', input.id).select('*').single(),
        'Department not found',
      );
    }
    return runOne<Department>(
      this.sb.from('departments').insert({ organization_id: input.organizationId, name: input.name, code: input.code }).select('*').single(),
      'Department could not be created',
    );
  }

  async deleteDepartment(departmentId: string): Promise<void> {
    await run(this.sb.from('departments').delete().eq('id', departmentId));
  }

  async adminClasses(): Promise<ClassRow[]> {
    return run<ClassRow[]>(this.sb.from('classes').select('*').order('name'));
  }

  async saveClass(input: {
    id?: string;
    organizationId: string;
    departmentId: string | null;
    name: string;
    code: string;
    academicYear: string | null;
    semester: number | null;
  }): Promise<ClassRow> {
    const values = {
      organization_id: input.organizationId,
      department_id: input.departmentId,
      name: input.name,
      code: input.code,
      academic_year: input.academicYear,
      semester: input.semester,
    };
    if (input.id) {
      return runOne<ClassRow>(this.sb.from('classes').update(values).eq('id', input.id).select('*').single(), 'Class not found');
    }
    return runOne<ClassRow>(this.sb.from('classes').insert(values).select('*').single(), 'Class could not be created');
  }

  async deleteClass(classId: string): Promise<void> {
    await run(this.sb.from('classes').delete().eq('id', classId));
  }

  async classMembers(classId: string): Promise<ClassMemberRow[]> {
    const members = await run<Array<{ class_id: string; user_id: string; role: 'STUDENT' | 'TEACHER'; added_at: string }>>(
      this.sb.from('class_members').select('*').eq('class_id', classId).order('added_at'),
    );
    if (!members.length) return [];
    const profiles = await run<Profile[]>(
      this.sb.from('profiles').select('id,full_name,email,role,status').in('id', members.map((m) => m.user_id)),
    );
    return members.map((m) => {
      const profile = profiles.find((p) => p.id === m.user_id);
      return {
        ...m,
        profile: profile
          ? { full_name: profile.full_name, email: profile.email, role: profile.role, status: profile.status }
          : null,
      };
    });
  }

  async addClassMember(classId: string, userId: string, role: 'STUDENT' | 'TEACHER'): Promise<void> {
    await run(this.sb.from('class_members').insert({ class_id: classId, user_id: userId, role }));
  }

  async removeClassMember(classId: string, userId: string): Promise<void> {
    await run(this.sb.from('class_members').delete().eq('class_id', classId).eq('user_id', userId));
  }

  async orgProfiles(): Promise<Profile[]> {
    return run<Profile[]>(this.sb.from('profiles').select('*').order('full_name'));
  }

  async inviteUser(input: InviteInput): Promise<{ userId: string }> {
    return this.callFunction<{ userId: string }>('invite-user', input);
  }

  async orgOverview(): Promise<OrgOverviewPoint[]> {
    const classes = await run<Array<{ id: string }>>(this.sb.from('classes').select('id'));
    if (!classes.length) return [];
    const rows = await run<KpiClassDaily[]>(
      this.sb.from('kpi_class_daily').select('*').in('class_id', classes.map((c) => c.id)).order('day'),
    );
    const byDay = new Map<string, { students: number; minutes: number[] }>();
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? { students: 0, minutes: [] };
      entry.students += row.active_students;
      entry.minutes.push(Number(row.avg_active_minutes));
      byDay.set(row.day, entry);
    }
    return Array.from(byDay.entries()).map(([day, value]) => ({
      day,
      activeStudents: value.students,
      avgActiveMinutes: value.minutes.length
        ? Math.round((value.minutes.reduce((a, b) => a + b, 0) / value.minutes.length) * 10) / 10
        : 0,
    }));
  }

  async ownerOrganizations(): Promise<Organization[]> {
    return run<Organization[]>(this.sb.from('organizations').select('*').order('name'));
  }

  async createOrganization(input: { name: string; slug: string }): Promise<Organization> {
    return runOne<Organization>(
      this.sb.from('organizations').insert({ name: input.name, slug: input.slug }).select('*').single(),
      'Organization could not be created',
    );
  }

  async ownerCourses(): Promise<Course[]> {
    return run<Course[]>(
      this.sb.from('courses').select('*').is('organization_id', null).order('created_at', { ascending: false }),
    );
  }
}
