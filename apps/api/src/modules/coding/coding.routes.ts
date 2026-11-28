// Programming Workspace API: languages, run (visible tests), job status, drafts, code history,
// activity events, faculty playback and similarity. Submissions continue to use POST /api/submissions,
// which enqueues a SUBMIT judge job (see submissions.routes.ts).
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LANGUAGES, isLanguageId } from '@platform/language-config';
import { authenticate, isPlatformDeveloperRole, requireRole } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { studentExecutionEnabled } from '../judge/judge.service.js';
import { withRequestTx, withScopedTx, JUDGE_CTX } from '../../lib/scoped-sql.js';
import { enforceJudgeQuota, resolveStudentQuestionAccess } from './coding.access.js';
import { compareWinnowing, compareWithJplag, type SimilarityInput } from './similarity.js';

const ACTIVITY_TYPES = [
  'question_opened', 'editor_started', 'code_changed', 'paste_detected', 'copy_inside_editor', 'run_requested',
  'execution_completed', 'test_passed', 'test_failed', 'submission_created', 'window_focus_lost', 'window_focus_gained',
  'question_completed', 'language_changed', 'draft_saved', 'reset_to_starter',
] as const;

const runSchema = z.object({
  questionId: z.string().min(1),
  assignmentId: z.string().min(1).nullish(),
  language: z.string().refine(isLanguageId, 'Unsupported language'),
  code: z.string().min(1).max(100_000),
  customInput: z.string().max(65_536).nullish(),
});

const eventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.enum(ACTIVITY_TYPES),
  clientTs: z.string().datetime(),
  questionId: z.string().nullish(),
  assignmentId: z.string().nullish(),
  courseId: z.string().nullish(),
  attemptId: z.string().max(100).nullish(),
  deviceSessionId: z.string().max(100).nullish(),
  schemaVersion: z.number().int().min(1).max(10).default(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const snapshotSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().min(1),
  assignmentId: z.string().nullish(),
  language: z.string().refine(isLanguageId),
  kind: z.enum(['CHECKPOINT', 'EDIT', 'PASTE', 'RUN', 'SUBMIT', 'RESET']),
  content: z.string().max(100_000),
  clientTs: z.string().datetime(),
  jobId: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const draftSchema = z.object({
  questionId: z.string().min(1),
  assignmentId: z.string().nullish(),
  language: z.string().refine(isLanguageId),
  content: z.string().max(100_000),
  clientUpdatedAt: z.string().datetime(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw Errors.badRequest('Validation failed', r.error.issues);
  return r.data;
}

/** Bounded metadata: drop large values so the activity log never becomes a covert content store. */
function boundMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta).slice(0, 20)) {
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

export async function codingRoutes(app: FastifyInstance) {
  app.get('/api/coding/languages', { preHandler: [authenticate] }, async () => ({
    languages: LANGUAGES.map(({ id, label, monaco, fileName, extension, standard, judge0Runtime, starterCode, defaultTimeLimitMs }) => ({
      id, label, monaco, fileName, extension, standard, runtime: judge0Runtime, starterCode, defaultTimeLimitMs,
    })),
  }));

  // Practice catalogue: published coding questions visible to the user (platform bank + own institution).
  app.get('/api/coding/practice', { preHandler: [authenticate] }, async (request) => {
    const q = request.query as { search?: string; difficulty?: string; topic?: string; language?: string; status?: string; page?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 30;
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const params: unknown[] = [user.userId, q.search ? `%${q.search}%` : null, q.difficulty ?? null, q.topic ?? null,
        q.language ? JSON.stringify([q.language.toUpperCase()]) : null, q.status ?? null, pageSize, (page - 1) * pageSize];
      const where = `q.question_type IN ('CODE','PROGRAMMING','CODING') AND q.status IN ('PUBLISHED','ACTIVE')
          AND ($2::text IS NULL OR q.title ILIKE $2 OR q.topic ILIKE $2)
          AND ($3::text IS NULL OR q.difficulty = $3)
          AND ($4::text IS NULL OR q.topic = $4)
          AND ($5::jsonb IS NULL OR q.supported_languages @> $5::jsonb)`;
      const stats = `LEFT JOIN LATERAL (
            SELECT bool_or(j.verdict = 'ACCEPTED') AS solved, COUNT(*) AS attempts, MAX(j.created_at) AS last_attempt
            FROM execution_jobs j WHERE j.question_id = q.id AND j.student_id = $1) st ON TRUE`;
      const statusFilter = `($6::text IS NULL OR ($6 = 'SOLVED' AND st.solved) OR ($6 = 'IN_PROGRESS' AND st.attempts > 0 AND NOT COALESCE(st.solved, FALSE)) OR ($6 = 'NEW' AND COALESCE(st.attempts, 0) = 0))`;
      const rows = await tx.query(
        `SELECT q.id, q.title, q.difficulty, q.topic, q.supported_languages, q.source_bank, q.review_status, q.marks,
                COALESCE(st.solved, FALSE) AS solved, COALESCE(st.attempts, 0)::int AS attempts, st.last_attempt
         FROM questions q ${stats}
         WHERE ${where} AND ${statusFilter}
         ORDER BY q.source_bank NULLS FIRST, q.topic, q.title LIMIT $7 OFFSET $8`,
        params,
      );
      const total = await tx.query<{ n: number }>(`SELECT COUNT(*)::int n FROM questions q ${stats} WHERE ${where} AND ${statusFilter}`, params.slice(0, 6));
      const topics = await tx.query<{ topic: string }>(
        `SELECT DISTINCT topic FROM questions WHERE question_type IN ('CODE','PROGRAMMING','CODING') AND status IN ('PUBLISHED','ACTIVE') ORDER BY topic`,
      );
      return { items: rows.rows, total: total.rows[0].n, page, pageSize, topics: topics.rows.map((t) => t.topic) };
    });
  });

  // Question detail for the workspace: never includes hidden test data or reference solutions.
  app.get('/api/coding/questions/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const { assignmentId } = request.query as { assignmentId?: string };
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const access = await resolveStudentQuestionAccess(tx, user, id, assignmentId ?? null);
      const q = await tx.query(
        `SELECT id, title, description, input_format, output_format, constraints, examples, difficulty, topic, topics, marks,
                starter_code, time_limit_ms, memory_limit_mb, supported_languages
         FROM questions WHERE id = $1`,
        [id],
      );
      const visible = await tx.query(
        `SELECT id, input, expected_output, order_num FROM test_cases WHERE question_id = $1 AND is_hidden = FALSE ORDER BY order_num, created_at`,
        [id],
      );
      const hidden = await tx.query<{ n: string }>(`SELECT COUNT(*) AS n FROM test_cases WHERE question_id = $1 AND is_hidden = TRUE`, [id]);
      const row = q.rows[0];
      return {
        ...row,
        allowedLanguages: access.allowedLanguages,
        assignmentId: access.assignmentId,
        visibleTests: visible.rows.map((t) => ({ id: t.id, input: t.input, expectedOutput: t.expected_output })),
        hiddenTestCount: Number(hidden.rows[0].n),
      };
    });
  });

  // RUN: visible tests (+ optional custom input). Hidden tests never run here.
  app.post('/api/coding/run', { preHandler: [authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!(await studentExecutionEnabled())) {
      throw Errors.serviceUnavailable('Execution service is unavailable. Your code was not queued; try again when the judge is healthy.');
    }
    const user = request.user!;
    if (isPlatformDeveloperRole(user.role)) throw Errors.forbidden('Platform developers cannot execute student code');
    const body = parse(runSchema, request.body);
    const job = await withRequestTx(async (tx) => {
      const access = await resolveStudentQuestionAccess(tx, user, body.questionId, body.assignmentId ?? null);
      if (!access.allowedLanguages.map((l) => l.toUpperCase()).includes(body.language.toUpperCase())) {
        throw Errors.badRequest(`Language ${body.language} is not allowed for this question`);
      }
      await enforceJudgeQuota(tx, user.userId, access.organizationId);
      const res = await tx.query<{ id: string; status: string; created_at: string }>(
        `INSERT INTO execution_jobs (organization_id, student_id, question_id, assignment_id, kind, language, source_code, custom_input)
         VALUES ($1,$2,$3,$4,'RUN',$5,$6,$7) RETURNING id, status, created_at`,
        [access.organizationId, user.userId, body.questionId, access.assignmentId, body.language.toUpperCase(), body.code, body.customInput ?? null],
      );
      return res.rows[0];
    });
    return reply.status(202).send({ jobId: job.id, status: job.status, createdAt: job.created_at });
  });

  app.get('/api/coding/jobs/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const j = await tx.query(
        `SELECT id, student_id, question_id, assignment_id, submission_id, kind, language, status, verdict, provider, compile_output,
                error, passed_tests, total_tests, max_time_ms, max_memory_kb, created_at, started_at, finished_at
         FROM execution_jobs WHERE id = $1`,
        [id],
      );
      const job = j.rows[0];
      if (!job) throw Errors.notFound('Execution job not found');
      const results = await tx.query(
        `SELECT ordinal, is_hidden, verdict, input, expected_output, stdout, stderr, time_ms, memory_kb FROM execution_results
         WHERE job_id = $1 ORDER BY ordinal`,
        [id],
      );
      const isStudent = user.role === 'STUDENT';
      return {
        ...job,
        results: results.rows.map((r) =>
          isStudent && r.is_hidden
            ? { ordinal: r.ordinal, hidden: true, verdict: r.verdict, timeMs: r.time_ms }
            : {
                ordinal: r.ordinal, hidden: r.is_hidden, verdict: r.verdict, input: r.input, expectedOutput: r.expected_output,
                stdout: r.stdout, stderr: r.stderr, timeMs: r.time_ms, memoryKb: r.memory_kb,
              },
        ),
      };
    });
  });

  app.get('/api/coding/history', { preHandler: [authenticate] }, async (request) => {
    const q = request.query as { questionId?: string; assignmentId?: string; studentId?: string; limit?: string };
    const user = request.user!;
    const studentId = user.role === 'STUDENT' ? user.userId : q.studentId ?? user.userId;
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 30));
    return withRequestTx(async (tx) => {
      const res = await tx.query(
        `SELECT j.id, j.kind, j.language, j.status, j.verdict, j.passed_tests, j.total_tests, j.max_time_ms, j.created_at, j.finished_at,
                j.question_id, j.assignment_id, j.submission_id, q.title AS question_title
         FROM execution_jobs j JOIN questions q ON q.id = j.question_id
         WHERE j.student_id = $1 AND ($2::text IS NULL OR j.question_id = $2) AND ($3::text IS NULL OR j.assignment_id = $3)
         ORDER BY j.created_at DESC LIMIT $4`,
        [studentId, q.questionId ?? null, q.assignmentId ?? null, limit],
      );
      return { items: res.rows };
    });
  });

  // Drafts: server keeps the newest copy; an older offline draft never overwrites a newer one.
  app.get('/api/coding/drafts', { preHandler: [requireRole('STUDENT')] }, async (request) => {
    const q = request.query as { questionId?: string; assignmentId?: string };
    if (!q.questionId) throw Errors.badRequest('questionId is required');
    return withRequestTx(async (tx) => {
      const res = await tx.query(
        `SELECT language, content, client_updated_at, updated_at FROM code_drafts
         WHERE student_id = $1 AND question_id = $2 AND COALESCE(assignment_id,'') = COALESCE($3,'')`,
        [request.user!.userId, q.questionId, q.assignmentId ?? null],
      );
      return { drafts: res.rows };
    });
  });

  app.put('/api/coding/drafts', { preHandler: [requireRole('STUDENT')] }, async (request) => {
    const body = parse(draftSchema, request.body);
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const access = await resolveStudentQuestionAccess(tx, user, body.questionId, body.assignmentId ?? null);
      const res = await tx.query<{ applied: boolean; client_updated_at: string }>(
        `INSERT INTO code_drafts (organization_id, student_id, question_id, assignment_id, language, content, client_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (student_id, question_id, COALESCE(assignment_id, ''), language)
         DO UPDATE SET content = EXCLUDED.content, client_updated_at = EXCLUDED.client_updated_at, updated_at = NOW()
           WHERE code_drafts.client_updated_at < EXCLUDED.client_updated_at
         RETURNING TRUE AS applied, client_updated_at`,
        [user.organizationId ?? null, user.userId, body.questionId, access.assignmentId, body.language.toUpperCase(), body.content, body.clientUpdatedAt],
      );
      return { applied: (res.rowCount ?? 0) > 0, stale: (res.rowCount ?? 0) === 0 };
    });
  });

  // Code history snapshots (idempotent by client id) for Code Playback.
  app.post('/api/coding/snapshots', { preHandler: [requireRole('STUDENT')] }, async (request) => {
    const body = request.body as { snapshots?: unknown[] };
    if (!Array.isArray(body?.snapshots) || body.snapshots.length > 200) throw Errors.badRequest('snapshots must be an array of at most 200');
    const items = body.snapshots.map((s) => parse(snapshotSchema, s));
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const checked = new Map<string, string | null>();
      let accepted = 0;
      for (const s of items) {
        const key = `${s.questionId}|${s.assignmentId ?? ''}`;
        if (!checked.has(key)) checked.set(key, (await resolveStudentQuestionAccess(tx, user, s.questionId, s.assignmentId ?? null)).assignmentId);
        const r = await tx.query(
          `INSERT INTO code_snapshots (id, organization_id, student_id, question_id, assignment_id, language, kind, content, content_sha256, job_id, metadata, client_ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [s.id, user.organizationId ?? null, user.userId, s.questionId, checked.get(key), s.language.toUpperCase(), s.kind, s.content,
            createHash('sha256').update(s.content).digest('hex'), s.jobId ?? null, JSON.stringify(boundMetadata(s.metadata)), s.clientTs],
        );
        accepted += r.rowCount ?? 0;
      }
      return { accepted, duplicates: items.length - accepted };
    });
  });

  // Activity events (application-scoped, batched, idempotent). No system-wide monitoring.
  app.post('/api/activity/events', { preHandler: [requireRole('STUDENT')] }, async (request) => {
    const body = request.body as { events?: unknown[] };
    if (!Array.isArray(body?.events) || body.events.length > 500) throw Errors.badRequest('events must be an array of at most 500');
    const events = body.events.map((e) => parse(eventSchema, e));
    const user = request.user!;
    return withRequestTx(async (tx) => {
      let accepted = 0;
      for (const e of events) {
        const r = await tx.query(
          `INSERT INTO activity_events (id, organization_id, student_id, course_id, assignment_id, question_id, attempt_id, device_session_id,
                                        event_type, client_ts, schema_version, metadata)
           SELECT $1,$2,$3,
                  (SELECT id FROM courses WHERE id = $4),
                  (SELECT id FROM assignments WHERE id = $5),
                  (SELECT id FROM questions WHERE id = $6),
                  $7,$8,$9,$10,$11,$12
           ON CONFLICT (id) DO NOTHING`,
          [e.id, user.organizationId ?? null, user.userId, e.courseId ?? null, e.assignmentId ?? null, e.questionId ?? null, e.attemptId ?? null,
            e.deviceSessionId ?? null, e.eventType, e.clientTs, e.schemaVersion, JSON.stringify(boundMetadata(e.metadata))],
        );
        accepted += r.rowCount ?? 0;
      }
      return { accepted, duplicates: events.length - accepted };
    });
  });

  // Faculty: activity timeline and code playback for one student + question.
  app.get(
    '/api/coding/playback',
    { preHandler: [requireRole('TEACHER', 'ORGANIZATION_ADMIN', 'STUDENT')] },
    async (request) => {
      const q = request.query as { studentId?: string; questionId?: string; assignmentId?: string };
      const user = request.user!;
      const studentId = user.role === 'STUDENT' ? user.userId : q.studentId;
      if (!studentId || !q.questionId) throw Errors.badRequest('studentId and questionId are required');
      return withRequestTx(async (tx) => {
        const visible = await tx.query(`SELECT rls_can_view_student_work($1, (SELECT organization_id FROM users WHERE id = $1)) AS ok`, [studentId]);
        if (!visible.rows[0]?.ok) throw Errors.forbidden('You are not authorised to view this student\'s work');
        const params = [studentId, q.questionId, q.assignmentId ?? null];
        const where = `student_id = $1 AND question_id = $2 AND ($3::text IS NULL OR assignment_id = $3)`;
        const [snaps, events, jobs] = await Promise.all([
          tx.query(`SELECT id, kind, language, content, content_sha256, job_id, metadata, client_ts, server_ts FROM code_snapshots WHERE ${where} ORDER BY client_ts, server_ts`, params),
          tx.query(`SELECT id, event_type, client_ts, server_ts, metadata FROM activity_events WHERE ${where} ORDER BY client_ts`, params),
          tx.query(`SELECT id, kind, language, status, verdict, passed_tests, total_tests, created_at, finished_at FROM execution_jobs WHERE ${where} ORDER BY created_at`, params),
        ]);
        await tx.query(
          `INSERT INTO audit_logs (id, organization_id, user_id, user_email, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid()::text, NULLIF(app_org_id(), ''), $1, $2, 'CODE_PLAYBACK_VIEWED', 'student', $3, $4)`,
          [user.userId, user.email, studentId, JSON.stringify({ questionId: q.questionId, assignmentId: q.assignmentId ?? null })],
        ).catch(() => undefined);
        return {
          studentId,
          questionId: q.questionId,
          snapshots: snaps.rows,
          events: events.rows,
          executions: jobs.rows,
          notice: 'Activity records are observations, not evidence of misconduct. Paste and focus events have many legitimate causes.',
        };
      });
    },
  );

  // Similarity analysis across final submissions of one assignment question.
  app.post('/api/coding/similarity', { preHandler: [requireRole('TEACHER', 'ORGANIZATION_ADMIN')] }, async (request, reply) => {
    const body = parse(
      z.object({ assignmentId: z.string().min(1), questionId: z.string().min(1), threshold: z.number().min(0.1).max(1).default(0.5) }),
      request.body,
    );
    const user = request.user!;
    const report = await withRequestTx(async (tx) => {
      const a = await tx.query<{ organization_id: string }>(`SELECT organization_id FROM assignments WHERE id = $1`, [body.assignmentId]);
      if (!a.rows[0]) throw Errors.notFound('Assignment not found');
      const subs = await tx.query<{ id: string; student_id: string; language: string; code: string; name: string }>(
        `SELECT DISTINCT ON (s.student_id) s.id, s.student_id, s.language, s.code, u.first_name || ' ' || u.last_name AS name
         FROM submissions s JOIN users u ON u.id = s.student_id
         WHERE s.assignment_id = $1 AND s.question_id = $2 AND s.code <> ''
         ORDER BY s.student_id, s.submitted_at DESC`,
        [body.assignmentId, body.questionId],
      );
      const inputs: SimilarityInput[] = subs.rows.map((r) => ({ submissionId: r.id, studentId: r.student_id, studentName: r.name, language: r.language, code: r.code }));
      const jplag = await compareWithJplag(inputs, body.threshold).catch(() => null);
      const pairs = jplag ?? compareWinnowing(inputs, body.threshold);
      const ins = await tx.query(
        `INSERT INTO similarity_reports (organization_id, assignment_id, question_id, provider, threshold, pairs, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, provider, threshold, pairs, created_at`,
        [a.rows[0].organization_id, body.assignmentId, body.questionId, jplag ? 'jplag' : 'builtin-winnowing', body.threshold, JSON.stringify(pairs), user.userId],
      );
      return { ...ins.rows[0], comparedSubmissions: inputs.length };
    });
    return reply.status(201).send({
      ...report,
      notice: 'Similarity indicates submissions worth a human review. It is not proof of copying and must not be used for automatic penalties.',
    });
  });

  app.get('/api/coding/similarity', { preHandler: [requireRole('TEACHER', 'ORGANIZATION_ADMIN')] }, async (request) => {
    const q = request.query as { assignmentId?: string };
    return withRequestTx(async (tx) => {
      const res = await tx.query(
        `SELECT id, assignment_id, question_id, provider, threshold, pairs, created_at FROM similarity_reports
         WHERE ($1::text IS NULL OR assignment_id = $1) ORDER BY created_at DESC LIMIT 50`,
        [q.assignmentId ?? null],
      );
      return { items: res.rows };
    });
  });

  // Operational status of the judge (no secrets).
  app.get('/api/coding/judge-status', { preHandler: [authenticate] }, async () => {
    const depth = await withScopedTx(JUDGE_CTX, async (tx) => {
      const r = await tx.query<{ queued: string; running: string; failed: string; last: string | null }>(
        `SELECT COUNT(*) FILTER (WHERE status='QUEUED') queued, COUNT(*) FILTER (WHERE status IN ('COMPILING','RUNNING')) running,
                COUNT(*) FILTER (WHERE status='FAILED' AND finished_at > NOW() - INTERVAL '1 hour') failed,
                MAX(finished_at) FILTER (WHERE status='COMPLETED') last
         FROM execution_jobs`,
      );
      return r.rows[0];
    });
    return {
      provider: process.env.JUDGE_PROVIDER || 'not-configured',
      queued: Number(depth.queued),
      running: Number(depth.running),
      failedLastHour: Number(depth.failed),
      lastCompletedAt: depth.last,
      networkRequiredForExecution: true,
    };
  });
}
