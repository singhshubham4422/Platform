/**
 * End-to-end acceptance workflow against a real PostgreSQL database and a real judge worker process.
 *
 * Platform owner → college + admin invitation → academic hierarchy → students/faculty → course allocation →
 * coding question with visible/hidden tests → assignment publish (immutable version) → student e-mail OTP →
 * course package download → drafts/code history/activity → RUN (visible tests) → SUBMIT (hidden tests)
 * → faculty review, playback, similarity, grading → student result → college analytics, plus tenant isolation.
 *
 * The judge worker runs as a separate OS process (src/modules/judge/worker.ts) using the development
 * provider (local toolchains). Requires python, gcc/g++ and a JDK on PATH; see docs/development.
 */
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.EMAIL_PROVIDER = 'dev-outbox';
process.env.STORAGE_PROVIDER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'lp-storage-'));

const { default: app } = await import('../../index.js');
const { pool } = await import('../../db/connection.js');

const tag = crypto.randomBytes(3).toString('hex');
type Headers = Record<string, string>;
const auth = (token: string): Headers => ({ authorization: `Bearer ${token}` });

async function call(method: string, url: string, headers: Headers = {}, payload?: unknown, expected?: number) {
  const res = await app.inject({ method: method as 'GET', url, headers, payload: payload as object });
  const body = res.payload ? (() => { try { return JSON.parse(res.payload); } catch { return res.payload; } })() : null;
  if (expected !== undefined) expect(res.statusCode, `${method} ${url} → ${res.payload}`).toBe(expected);
  return { status: res.statusCode, body, raw: res };
}

async function login(email: string, password: string) {
  const r = await call('POST', '/api/auth/login', {}, { email, password }, 200);
  return r.body.accessToken as string;
}

async function latestOutbox(to: string): Promise<string> {
  const r = await pool.query(`SELECT body FROM email_outbox WHERE lower(to_email) = lower($1) ORDER BY created_at DESC LIMIT 1`, [to]);
  expect(r.rows[0], `no e-mail for ${to}`).toBeTruthy();
  return r.rows[0].body as string;
}

async function waitForJob(token: string, jobId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await call('GET', `/api/coding/jobs/${jobId}`, auth(token), undefined, 200);
    if (['COMPLETED', 'FAILED'].includes(r.body.status)) return r.body;
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${r.body.status}`);
    await new Promise((res) => setTimeout(res, 400));
  }
}

let worker: ChildProcess | null = null;

describe('Unified platform acceptance workflow', () => {
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const emails = {
    admin: `admin.${tag}@college-${tag}.test`,
    faculty: `faculty.${tag}@college-${tag}.test`,
    student: `student.${tag}@college-${tag}.test`,
    student2: `student2.${tag}@college-${tag}.test`,
  };

  beforeAll(async () => {
    await app.ready();
    worker = spawn(process.execPath, ['--import', 'tsx', 'src/modules/judge/worker.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, JUDGE_PROVIDER: 'local-unsandboxed-dev', JUDGE_WORKER_POLL_MS: '200', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout?.on('data', (d) => process.env.DEBUG_JUDGE && process.stdout.write(`[worker] ${d}`));
    worker.stderr?.on('data', (d) => process.stderr.write(`[worker:err] ${d}`));
  }, 30_000);

  afterAll(async () => {
    worker?.kill();
    await app.close();
  });

  it('platform owner creates a college and invites its administrator', async () => {
    tokens.owner = await login('admin@platform.dev', 'Admin@123');
    const org = await call('POST', '/api/organizations', auth(tokens.owner), {
      name: `Acceptance Institute ${tag}`, slug: `acceptance-${tag}`, type: 'COLLEGE', contactName: 'Registrar', contactEmail: `registrar@college-${tag}.test`, city: 'Pune', country: 'India',
    }, 201);
    ids.org = org.body.id;
    const plans = await call('GET', '/api/platform/plans', auth(tokens.owner), undefined, 200);
    const plan = plans.body.items.find((p: { code: string }) => p.code === 'starter');
    await call('POST', '/api/platform/subscriptions', auth(tokens.owner), {
      organizationId: ids.org, planId: plan.id, seats: 100, startsAt: '2026-07-01', renewsAt: '2027-06-30',
    }, 201);
    const inv = await call('POST', '/api/invitations', auth(tokens.owner), { email: emails.admin, role: 'ORGANIZATION_ADMIN', organizationId: ids.org }, 201);
    expect(inv.body.emailDelivered).toBe(true);
    const token = /token=([A-Za-z0-9_-]+)/.exec(await latestOutbox(emails.admin))![1];
    await call('POST', '/api/invitations/accept', {}, { token, firstName: 'College', lastName: 'Admin', password: 'CollegeAdmin#2026' }, 201);
    await call('POST', '/api/invitations/accept', {}, { token, firstName: 'Again', lastName: 'Admin', password: 'CollegeAdmin#2026' }, 400);
  });

  it('college admin builds the academic hierarchy, people, enrollment and allocation', async () => {
    tokens.admin = await login(emails.admin, 'CollegeAdmin#2026');
    const h = auth(tokens.admin);
    ids.dept = (await call('POST', '/api/academic/departments', h, { name: 'Computer Engineering', code: 'COMP' }, 201)).body.id;
    ids.program = (await call('POST', '/api/academic/programs', h, { name: 'B.E. Computer', code: 'BECOMP', departmentId: ids.dept, degree: 'B.E.', durationSemesters: 8 }, 201)).body.id;
    ids.year = (await call('POST', '/api/academic/academic-years', h, { label: '2026-27', startsOn: '2026-07-01', endsOn: '2027-06-30' }, 201)).body.id;
    ids.batch = (await call('POST', '/api/academic/batches', h, { name: 'COMP 2026-30', programId: ids.program, startYear: 2026, endYear: 2030 }, 201)).body.id;
    ids.semester = (await call('POST', '/api/academic/semesters', h, { name: 'Semester 1', number: 1, batchId: ids.batch, academicYearId: ids.year }, 201)).body.id;
    // client-supplied organizationId is ignored for org admins
    const foreign = await call('POST', '/api/academic/departments', h, { name: 'Injected', code: 'INJ', organizationId: 'org-riverside-001' }, 201);
    expect(foreign.body.organizationId).toBe(ids.org);

    ids.class = (await call('POST', '/api/classes', h, { name: 'COMP 2026 Sem 1', grade: 'S1', academicYear: '2026-27' }, 201)).body.id;
    await call('PATCH', `/api/academic/classes/${ids.class}/placement`, h, { departmentId: ids.dept, programId: ids.program, batchId: ids.batch, semesterId: ids.semester }, 200);
    ids.section = (await call('POST', '/api/sections', h, { classId: ids.class, name: 'Division A', maxStudents: 60 }, 201)).body.id;

    ids.student = (await call('POST', '/api/users', h, { firstName: 'Priya', lastName: 'Student', email: emails.student, role: 'STUDENT' }, 201)).body.id;
    ids.student2 = (await call('POST', '/api/users', h, { firstName: 'Kabir', lastName: 'Student', email: emails.student2, role: 'STUDENT' }, 201)).body.id;
    ids.faculty = (await call('POST', '/api/users', h, { firstName: 'Faculty', lastName: 'One', email: emails.faculty, role: 'TEACHER', password: 'Faculty#2026pass' }, 201)).body.id;
    await call('POST', `/api/sections/${ids.section}/teachers`, h, { teacherIds: [ids.faculty] });
    await call('POST', `/api/sections/${ids.section}/students`, h, { studentIds: [ids.student, ids.student2] });
    await call('POST', '/api/academic/role-assignments', h, { userId: ids.faculty, role: 'HOD', scopeType: 'DEPARTMENT', scopeId: ids.dept }, 201);

    ids.course = (await call('POST', '/api/courses', h, { title: `Programming Fundamentals ${tag}`, language: 'C', category: 'Engineering' }, 201)).body.id;
    ids.allocation = (await call('POST', '/api/allocations', h, {
      courseId: ids.course, organizationId: ids.org, classId: ids.class, sectionId: ids.section, teacherId: ids.faculty,
      startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 120 * 86_400_000).toISOString(),
    }, 201)).body.id;
  });

  it('faculty authors a multi-language coding question, uploads material and publishes an assignment', async () => {
    tokens.faculty = await login(emails.faculty, 'Faculty#2026pass');
    const h = auth(tokens.faculty);
    const overview = await call('GET', '/api/analytics/faculty', h, undefined, 200);
    expect(overview.body.sections.some((s: { id: string }) => s.id === ids.section)).toBe(true);

    const q = await call('POST', '/api/questions', h, {
      title: 'Maximum of N numbers', description: 'Print the largest of N integers.', questionType: 'CODE', courseId: ids.course,
      inputFormat: 'N then N integers', outputFormat: 'One integer', constraints: '1 <= N <= 1000', difficulty: 'EASY', topic: 'Arrays',
      examples: [{ input: '3\n4 9 2', output: '9' }], supportedLanguages: ['PYTHON', 'C', 'CPP', 'JAVA'], marks: 20,
      starterCode: { PYTHON: 'import sys\n', C: '#include <stdio.h>\nint main(void){return 0;}\n' }, timeLimitMs: 2000, memoryLimitMb: 256,
      skills: ['Programming fundamentals', 'Data structures and algorithms'],
      testCases: [
        { input: '3\n4 9 2', expectedOutput: '9', isHidden: false, isSample: true },
        { input: '1\n-5', expectedOutput: '-5', isHidden: false },
        { input: '5\n-1 -7 -3 -9 -2', expectedOutput: '-1', isHidden: true },
        { input: '4\n1000000 999999 5 1000001', expectedOutput: '1000001', isHidden: true },
      ],
    }, 201);
    ids.question = q.body.id;

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const up = await app.inject({ method: 'POST', url: `/api/files?purpose=LEARNING_MATERIAL&fileName=week1-notes.pdf&courseId=${ids.course}`, headers: { ...h, 'content-type': 'application/pdf' }, payload: pdf });
    expect(up.statusCode, up.payload).toBe(201);
    ids.file = JSON.parse(up.payload).id;
    const fake = await app.inject({ method: 'POST', url: `/api/files?purpose=LEARNING_MATERIAL&fileName=evil.pdf&courseId=${ids.course}`, headers: { ...h, 'content-type': 'application/pdf' }, payload: Buffer.from('MZ not a pdf') });
    expect(fake.statusCode).toBe(400);
    await call('POST', `/api/courses/${ids.course}/packages`, h, {}, 201);

    const asg = await call('POST', '/api/assignments', h, {
      title: 'Lab 1: Arrays', sectionId: ids.section, courseAllocationId: ids.allocation, assignmentType: 'PROGRAMMING', status: 'DRAFT',
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(), totalMarks: 20, allowResubmit: true, maxAttempts: 5,
      allowedLanguages: ['PYTHON', 'C', 'CPP', 'JAVA'], questions: [{ questionId: ids.question, marks: 20 }],
    }, 201);
    ids.assignment = asg.body.id;
    const pub = await call('PATCH', `/api/assignments/${ids.assignment}/publish`, h, {}, 200);
    expect(pub.body.version).toBe(1);
  });

  it('student signs in with e-mail OTP and downloads the course package', async () => {
    await call('POST', '/api/auth/otp/request', {}, { email: emails.student }, 200);
    const unknown = await call('POST', '/api/auth/otp/request', {}, { email: `nobody.${tag}@nowhere.test` }, 200);
    expect(unknown.body.sent).toBe(true); // no account enumeration
    const code = /code is (\d{6})/.exec(await latestOutbox(emails.student))![1];
    await call('POST', '/api/auth/otp/verify', {}, { email: emails.student, code: code === '000000' ? '111111' : '000000' }, 401);
    const v = await call('POST', '/api/auth/otp/verify', {}, { email: emails.student, code, clientType: 'DESKTOP', deviceName: 'Acceptance laptop' }, 200);
    tokens.student = v.body.accessToken;
    const sessions = await call('GET', '/api/auth/sessions', auth(tokens.student), undefined, 200);
    expect(sessions.body.sessions.some((s: { client_type: string }) => s.client_type === 'DESKTOP')).toBe(true);

    const pkg = await call('GET', `/api/courses/${ids.course}/packages/latest`, auth(tokens.student), undefined, 200);
    expect(pkg.body.available).toBe(true);
    const resource = pkg.body.manifest.resources[0];
    const dl = await app.inject({ method: 'GET', url: pkg.body.downloads[resource.fileId] });
    expect(dl.statusCode).toBe(200);
    expect(crypto.createHash('sha256').update(dl.rawPayload).digest('hex')).toBe(resource.sha256);

    const notif = await call('GET', '/api/notifications', auth(tokens.student), undefined, 200);
    expect(notif.body.items.some((n: { type: string }) => n.type === 'ASSIGNMENT_PUBLISHED')).toBe(true);
  });

  it('student workspace never receives hidden tests; drafts, history and activity are stored', async () => {
    const h = auth(tokens.student);
    const q = await call('GET', `/api/coding/questions/${ids.question}?assignmentId=${ids.assignment}`, h, undefined, 200);
    expect(q.body.visibleTests).toHaveLength(2);
    expect(q.body.hiddenTestCount).toBe(2);
    expect(JSON.stringify(q.body)).not.toContain('1000001');

    const now = Date.now();
    await call('PUT', '/api/coding/drafts', h, { questionId: ids.question, assignmentId: ids.assignment, language: 'CPP', content: 'v2', clientUpdatedAt: new Date(now).toISOString() }, 200);
    const stale = await call('PUT', '/api/coding/drafts', h, { questionId: ids.question, assignmentId: ids.assignment, language: 'CPP', content: 'old offline', clientUpdatedAt: new Date(now - 60_000).toISOString() }, 200);
    expect(stale.body.stale).toBe(true);

    const snapIds = [crypto.randomUUID(), crypto.randomUUID()];
    await call('POST', '/api/coding/snapshots', h, { snapshots: [
      { id: snapIds[0], questionId: ids.question, assignmentId: ids.assignment, language: 'CPP', kind: 'CHECKPOINT', content: '#include <bits/stdc++.h>', clientTs: new Date(now - 5000).toISOString() },
      { id: snapIds[1], questionId: ids.question, assignmentId: ids.assignment, language: 'CPP', kind: 'PASTE', content: '#include <bits/stdc++.h>\nint main(){}', clientTs: new Date(now - 4000).toISOString(), metadata: { pastedChars: 12 } },
    ] }, 200);
    const replay = await call('POST', '/api/coding/snapshots', h, { snapshots: [{ id: snapIds[0], questionId: ids.question, assignmentId: ids.assignment, language: 'CPP', kind: 'CHECKPOINT', content: 'x', clientTs: new Date().toISOString() }] }, 200);
    expect(replay.body.duplicates).toBe(1);
    const ev = await call('POST', '/api/activity/events', h, { events: [
      { id: crypto.randomUUID(), eventType: 'question_opened', clientTs: new Date(now - 6000).toISOString(), questionId: ids.question, assignmentId: ids.assignment, courseId: ids.course },
      { id: crypto.randomUUID(), eventType: 'paste_detected', clientTs: new Date(now - 4000).toISOString(), questionId: ids.question, assignmentId: ids.assignment, metadata: { chars: 12, source: 'external' } },
    ] }, 200);
    expect(ev.body.accepted).toBe(2);
  });

  it('RUN executes visible tests only and returns authentic verdicts', async () => {
    const h = auth(tokens.student);
    const ok = await call('POST', '/api/coding/run', h, { questionId: ids.question, assignmentId: ids.assignment, language: 'PYTHON', code: 'import sys\nd=list(map(int,sys.stdin.read().split()))\nprint(max(d[1:]))\n' }, 202);
    const job = await waitForJob(tokens.student, ok.body.jobId);
    expect(job.status).toBe('COMPLETED');
    expect(job.verdict).toBe('ACCEPTED');
    expect(job.total_tests).toBe(2);
    expect(job.results.every((r: { hidden: boolean }) => !r.hidden)).toBe(true);

    const wrong = await call('POST', '/api/coding/run', h, { questionId: ids.question, assignmentId: ids.assignment, language: 'C', code: '#include <stdio.h>\nint main(void){printf("0\\n");return 0;}\n' }, 202);
    expect((await waitForJob(tokens.student, wrong.body.jobId)).verdict).toBe('WRONG_ANSWER');

    const broken = await call('POST', '/api/coding/run', h, { questionId: ids.question, assignmentId: ids.assignment, language: 'JAVA', code: 'public class Main { public static void main(String[] a) { int x = } }' }, 202);
    const bj = await waitForJob(tokens.student, broken.body.jobId);
    expect(bj.verdict).toBe('COMPILE_ERROR');
    expect(bj.compile_output).toBeTruthy();
  }, 180_000);

  it('SUBMIT runs hidden tests, persists results and notifies faculty', async () => {
    const h = auth(tokens.student);
    const code = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long n,x,best=LLONG_MIN;cin>>n;while(n--){cin>>x;best=max(best,x);}cout<<best<<"\\n";}\n';
    const sub = await call('POST', '/api/submissions', h, { assignmentId: ids.assignment, questionId: ids.question, language: 'CPP', code, clientOperationId: `op-${tag}` }, 202);
    ids.submission = sub.body.id;
    const replay = await call('POST', '/api/submissions', h, { assignmentId: ids.assignment, questionId: ids.question, language: 'CPP', code, clientOperationId: `op-${tag}` }, 200);
    expect(replay.body.id).toBe(ids.submission);

    const job = await waitForJob(tokens.student, sub.body.jobId);
    expect(job.verdict).toBe('ACCEPTED');
    expect(job.total_tests).toBe(4);
    const hidden = job.results.filter((r: { hidden: boolean }) => r.hidden);
    expect(hidden).toHaveLength(2);
    expect(hidden.every((r: Record<string, unknown>) => r.stdout === undefined && r.input === undefined)).toBe(true);

    // second student submits an identical solution (for similarity) — Python, wrong on hidden tests
    tokens.student2 = await (async () => {
      await call('POST', '/api/auth/otp/request', {}, { email: emails.student2 }, 200);
      const c = /code is (\d{6})/.exec(await latestOutbox(emails.student2))![1];
      return (await call('POST', '/api/auth/otp/verify', {}, { email: emails.student2, code: c }, 200)).body.accessToken;
    })();
    const s2 = await call('POST', '/api/submissions', auth(tokens.student2), { assignmentId: ids.assignment, questionId: ids.question, language: 'CPP', code }, 202);
    await waitForJob(tokens.student2, s2.body.jobId);

    const fnotif = await call('GET', '/api/notifications', auth(tokens.faculty), undefined, 200);
    expect(fnotif.body.items.some((n: { type: string }) => n.type === 'SUBMISSION_RECEIVED')).toBe(true);
  }, 180_000);

  it('faculty reviews code, playback and similarity, then grades and releases', async () => {
    const h = auth(tokens.faculty);
    const subs = await call('GET', `/api/submissions?assignmentId=${ids.assignment}`, h, undefined, 200);
    const list = (subs.body.items ?? subs.body) as Array<{ id: string; code: string; status: string }>;
    const mine = list.find((s) => s.id === ids.submission)!;
    expect(mine.status).toBe('COMPLETED');
    expect(mine.code).toContain('LLONG_MIN');

    const pb = await call('GET', `/api/coding/playback?studentId=${ids.student}&questionId=${ids.question}&assignmentId=${ids.assignment}`, h, undefined, 200);
    expect(pb.body.snapshots.length).toBeGreaterThanOrEqual(2);
    expect(pb.body.events.some((e: { event_type: string }) => e.event_type === 'paste_detected')).toBe(true);
    expect(pb.body.executions.length).toBeGreaterThanOrEqual(4);

    const sim = await call('POST', '/api/coding/similarity', h, { assignmentId: ids.assignment, questionId: ids.question, threshold: 0.5 }, 201);
    expect(sim.body.provider).toBe('builtin-winnowing');
    expect(sim.body.pairs.length).toBe(1);
    expect(sim.body.notice).toMatch(/not proof/i);

    const graded = await call('PATCH', `/api/submissions/${ids.submission}/grade`, h, { score: 18, teacherFeedback: 'Clean solution; consider edge cases.', releaseFeedback: true }, 200);
    expect(graded.body.score).toBe(18);
  }, 60_000);

  it('student sees the released result and skill evidence; college and HOD see analytics', async () => {
    const profile = await call('GET', `/api/analytics/students/${ids.student}/profile`, auth(tokens.student), undefined, 200);
    const result = profile.body.results.find((r: { id: string }) => r.id === ids.submission);
    expect(result.score).toBe(18);
    const fundamentals = profile.body.skills.find((s: { skill: string }) => s.skill === 'Programming fundamentals');
    expect(fundamentals.evidenceCount).toBe(1);
    expect(fundamentals.status).toBe('INSUFFICIENT_EVIDENCE');

    const s2profile = await call('GET', `/api/analytics/students/${ids.student2}/profile`, auth(tokens.student2), undefined, 200);
    expect(s2profile.body.results[0].score).toBeNull(); // not released yet

    const org = await call('GET', '/api/analytics/organization', auth(tokens.admin), undefined, 200);
    expect(org.body.totals.students).toBe(2);
    expect(org.body.courses.find((c: { id: string }) => c.id === ids.course).studentsAssessed).toBeGreaterThanOrEqual(1);
    expect(org.body.semesters.find((s: { id: string }) => s.id === ids.semester).completionPct).toBe(100);

    const hod = await call('GET', `/api/analytics/departments/${ids.dept}`, auth(tokens.faculty), undefined, 200);
    expect(hod.body.department.students).toBe(2);
  });

  it('enforces tenant isolation for the new modules', async () => {
    const riversideAdmin = await login('priya.sharma@riverside.edu', 'OrgAdmin@123');
    const r = auth(riversideAdmin);
    expect((await call('GET', `/api/analytics/departments/${ids.dept}`, r)).status).toBeGreaterThanOrEqual(403);
    expect((await call('GET', `/api/coding/playback?studentId=${ids.student}&questionId=${ids.question}`, r)).status).toBe(403);
    const deps = await call('GET', '/api/academic/departments', r, undefined, 200);
    expect(deps.body.items.some((d: { id: string }) => d.id === ids.dept)).toBe(false);
    const subs = await call('GET', `/api/platform/usage`, r, undefined, 200);
    expect(subs.body.items.every((i: { organizationId: string }) => i.organizationId !== ids.org)).toBe(true);
    // students cannot read another student's jobs or profile
    const otherProfile = await call('GET', `/api/analytics/students/${ids.student}/profile`, auth(tokens.student2));
    expect(otherProfile.status).toBe(403);
    const riversideStudent = await login('student1@riverside.edu', 'Student@123');
    expect((await call('POST', '/api/coding/run', auth(riversideStudent), { questionId: ids.question, assignmentId: ids.assignment, language: 'PYTHON', code: 'print(1)' })).status).toBeGreaterThanOrEqual(403);
    // owner sees operational health without student source code
    const health = await call('GET', '/api/platform/health', auth(tokens.owner), undefined, 200);
    expect(health.body.database.ok).toBe(true);
    expect(JSON.stringify(health.body)).not.toContain('LLONG_MIN');
  });
});
