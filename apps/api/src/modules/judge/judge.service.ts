// Judge gateway: provider selection, queue claiming and result persistence.
// Runs inside the separate judge worker process (src/modules/judge/worker.ts), never inside the API.
import type { LanguageId, Verdict } from '@lplatform/language-config';
import { Judge0Provider } from './judge0.provider.js';
import { LocalDevProvider } from './local-dev.provider.js';
import { JudgeUnavailableError, type JudgeProvider, type JudgeTestInput } from './provider.js';
import { addUsage, JUDGE_CTX, notify, withScopedTx, type Tx } from '../../lib/scoped-sql.js';

export const MAX_JOB_ATTEMPTS = 3;
const STALE_LOCK_MINUTES = 5;

export function createJudgeProvider(env: NodeJS.ProcessEnv = process.env): JudgeProvider | null {
  const kind = (env.JUDGE_PROVIDER || '').trim();
  if (kind === 'judge0') {
    if (!env.JUDGE0_URL) throw new Error('JUDGE_PROVIDER=judge0 requires JUDGE0_URL');
    return new Judge0Provider(env.JUDGE0_URL, env.JUDGE0_AUTH_TOKEN || undefined);
  }
  if (kind === 'local-unsandboxed-dev') {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      throw new Error('JUDGE_PROVIDER=local-unsandboxed-dev is permitted only when NODE_ENV is explicitly development or test.');
    }
    return new LocalDevProvider();
  }
  if (kind) throw new Error(`Unsupported JUDGE_PROVIDER '${kind}'. Configure judge0; unsafe or unknown providers are refused.`);
  if (env.NODE_ENV === 'production') {
    throw new Error('Production requires JUDGE_PROVIDER=judge0 and a reachable sandboxed Judge0 service.');
  }
  return null; // not configured: jobs fail as JUDGE_UNAVAILABLE, never faked.
}

/** Production readiness requires the isolated provider and every language the student app exposes. */
export async function productionJudgeReady(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true;
  const provider = createJudgeProvider();
  if (!provider) return false;
  const status = await provider.status().catch(() => null);
  return Boolean(
    status?.available && status.sandboxed && ['PYTHON', 'C', 'CPP', 'JAVA'].every((language) => status.languages[language as keyof typeof status.languages]),
  );
}

export async function studentExecutionEnabled(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true;
  if (process.env.ENABLE_STUDENT_EXECUTION !== 'true') return false;
  return productionJudgeReady();
}

interface JobRow {
  id: string;
  organization_id: string | null;
  student_id: string;
  question_id: string;
  assignment_id: string | null;
  submission_id: string | null;
  kind: 'RUN' | 'SUBMIT';
  language: LanguageId;
  source_code: string;
  custom_input: string | null;
  attempts: number;
}

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  return withScopedTx(JUDGE_CTX, async (tx) => {
    // Recover jobs whose worker died mid-flight.
    await tx.query(
      `UPDATE execution_jobs SET status = 'QUEUED', locked_by = NULL, locked_at = NULL
       WHERE status IN ('COMPILING','RUNNING') AND locked_at < NOW() - INTERVAL '${STALE_LOCK_MINUTES} minutes'
         AND attempts < $1`,
      [MAX_JOB_ATTEMPTS],
    );
    const res = await tx.query<JobRow>(
      `UPDATE execution_jobs SET status = 'COMPILING', locked_by = $1, locked_at = NOW(),
              attempts = attempts + 1, started_at = COALESCE(started_at, NOW())
       WHERE id = (
         SELECT id FROM execution_jobs WHERE status = 'QUEUED'
         ORDER BY CASE kind WHEN 'SUBMIT' THEN 0 ELSE 1 END, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, organization_id, student_id, question_id, assignment_id, submission_id, kind,
                 language, source_code, custom_input, attempts`,
      [workerId],
    );
    return res.rows[0] ?? null;
  });
}

interface TestRow {
  id: string;
  input: string;
  expected_output: string;
  is_hidden: boolean;
}

async function loadJobContext(job: JobRow) {
  return withScopedTx(JUDGE_CTX, async (tx) => {
    const q = await tx.query<{ time_limit_ms: number; memory_limit_mb: number; title: string; marks: number }>(
      `SELECT time_limit_ms, memory_limit_mb, title, marks FROM questions WHERE id = $1`,
      [job.question_id],
    );
    const tests = await tx.query<TestRow>(
      `SELECT id, input, expected_output, is_hidden FROM test_cases WHERE question_id = $1
       ${job.kind === 'RUN' ? 'AND is_hidden = FALSE' : ''}
       ORDER BY order_num, created_at`,
      [job.question_id],
    );
    let marks = q.rows[0]?.marks ?? 0;
    if (job.assignment_id) {
      const aq = await tx.query<{ marks: number }>(
        `SELECT marks FROM assignment_questions WHERE assignment_id = $1 AND question_id = $2`,
        [job.assignment_id, job.question_id],
      );
      if (aq.rows[0]) marks = aq.rows[0].marks;
    }
    return { question: q.rows[0], tests: tests.rows, marks };
  });
}

export async function markJobRunning(jobId: string): Promise<void> {
  await withScopedTx(JUDGE_CTX, (tx) => tx.query(`UPDATE execution_jobs SET status = 'RUNNING' WHERE id = $1`, [jobId]));
}

async function failJob(tx: Tx, job: JobRow, verdict: Verdict, error: string): Promise<void> {
  await tx.query(
    `UPDATE execution_jobs SET status = 'FAILED', verdict = $2, error = $3, finished_at = NOW(), locked_by = NULL
     WHERE id = $1`,
    [job.id, verdict, error.slice(0, 2000)],
  );
  if (job.submission_id) {
    await tx.query(`UPDATE submissions SET status = 'ERROR', verdict = $2, evaluated_at = NOW() WHERE id = $1`, [
      job.submission_id,
      verdict,
    ]);
    await notify(tx, {
      organizationId: job.organization_id,
      userId: job.student_id,
      type: 'SUBMISSION_FAILED',
      title: 'Submission could not be judged',
      body: verdict === 'JUDGE_UNAVAILABLE' ? 'The judge service is unavailable. Your code is saved; please submit again later.' : error.slice(0, 300),
    });
  }
}

/** Process one claimed job end-to-end. Never fabricates a verdict: failures are persisted as such. */
export async function processJob(provider: JudgeProvider | null, job: JobRow): Promise<Verdict> {
  if (!provider) {
    await withScopedTx(JUDGE_CTX, (tx) => failJob(tx, job, 'JUDGE_UNAVAILABLE', 'No judge provider configured (JUDGE_PROVIDER).'));
    return 'JUDGE_UNAVAILABLE';
  }
  const ctx = await loadJobContext(job);
  if (!ctx.question) {
    await withScopedTx(JUDGE_CTX, (tx) => failJob(tx, job, 'SUBMISSION_FAILED', 'Question no longer exists.'));
    return 'SUBMISSION_FAILED';
  }
  const tests: JudgeTestInput[] = ctx.tests.map((t, i) => ({ ordinal: i + 1, input: t.input, expectedOutput: t.expected_output }));
  if (job.kind === 'RUN' && job.custom_input !== null) {
    tests.push({ ordinal: tests.length + 1, input: job.custom_input, expectedOutput: null });
  }
  if (tests.length === 0) {
    await withScopedTx(JUDGE_CTX, (tx) =>
      failJob(tx, job, 'SUBMISSION_FAILED', job.kind === 'RUN' ? 'This question has no visible test cases. Provide custom input to run.' : 'This question has no test cases configured.'),
    );
    return 'SUBMISSION_FAILED';
  }

  await markJobRunning(job.id);
  let outcome;
  const started = Date.now();
  try {
    outcome = await provider.execute({
      language: job.language,
      source: job.source_code,
      tests,
      timeLimitMs: ctx.question.time_limit_ms,
      memoryLimitMb: ctx.question.memory_limit_mb,
    });
  } catch (error) {
    const unavailable = error instanceof JudgeUnavailableError;
    await withScopedTx(JUDGE_CTX, async (tx) => {
      if (unavailable && job.attempts < MAX_JOB_ATTEMPTS) {
        await tx.query(`UPDATE execution_jobs SET status = 'QUEUED', locked_by = NULL, error = $2 WHERE id = $1`, [job.id, String((error as Error).message).slice(0, 500)]);
      } else {
        await failJob(tx, job, unavailable ? 'JUDGE_UNAVAILABLE' : 'SUBMISSION_FAILED', (error as Error).message);
      }
    });
    return unavailable ? 'JUDGE_UNAVAILABLE' : 'SUBMISSION_FAILED';
  }

  const graded = outcome.tests.filter((t) => tests.find((x) => x.ordinal === t.ordinal)?.expectedOutput !== null);
  const passed = graded.filter((t) => t.verdict === 'ACCEPTED').length;
  const total = graded.length;
  const maxTime = outcome.tests.reduce((m, t) => Math.max(m, t.timeMs ?? 0), 0);
  const maxMem = outcome.tests.reduce((m, t) => Math.max(m, t.memoryKb ?? 0), 0);
  // A custom-input-only run has no expected output: report what ran, not "Accepted".
  const verdict: Verdict = total === 0 && outcome.verdict === 'ACCEPTED' ? 'ACCEPTED' : outcome.verdict;

  await withScopedTx(JUDGE_CTX, async (tx) => {
    for (const t of outcome.tests) {
      const meta = ctx.tests[t.ordinal - 1];
      const custom = !meta;
      await tx.query(
        `INSERT INTO execution_results (job_id, test_case_id, ordinal, is_hidden, verdict, input, expected_output, stdout, stderr, time_ms, memory_kb)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (job_id, ordinal) DO UPDATE SET verdict = EXCLUDED.verdict, stdout = EXCLUDED.stdout, stderr = EXCLUDED.stderr,
           time_ms = EXCLUDED.time_ms, memory_kb = EXCLUDED.memory_kb`,
        [job.id, meta?.id ?? null, t.ordinal, meta?.is_hidden ?? false, t.verdict, custom ? job.custom_input : meta.input,
          custom ? null : meta.expected_output, t.stdout, t.stderr, t.timeMs, t.memoryKb],
      );
    }
    await tx.query(
      `UPDATE execution_jobs SET status = 'COMPLETED', verdict = $2, provider = $3, compile_output = $4,
              passed_tests = $5, total_tests = $6, max_time_ms = $7, max_memory_kb = $8, finished_at = NOW(), locked_by = NULL, error = NULL
       WHERE id = $1`,
      [job.id, verdict, outcome.provider, outcome.compileOutput, passed, total, maxTime || null, maxMem || null],
    );
    await addUsage(tx, job.organization_id, 'judge_executions', 1);
    await addUsage(tx, job.organization_id, 'judge_execution_ms', Date.now() - started);

    if (job.kind === 'SUBMIT' && job.submission_id) {
      const score = total > 0 ? Math.round((ctx.marks * passed) / total) : 0;
      await tx.query(`DELETE FROM submission_results WHERE submission_id = $1`, [job.submission_id]);
      for (const t of outcome.tests) {
        const meta = ctx.tests[t.ordinal - 1];
        if (!meta) continue;
        await tx.query(
          `INSERT INTO submission_results (id, submission_id, test_case_id, status, actual_output, execution_time_ms, memory_used_kb, error_message)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
          [job.submission_id, meta.id, legacyResultStatus(t.verdict), meta.is_hidden ? null : t.stdout, t.timeMs, t.memoryKb,
            t.verdict === 'ACCEPTED' ? null : (t.verdict === 'COMPILE_ERROR' ? outcome.compileOutput : t.stderr)?.slice(0, 4000) ?? null],
        );
      }
      await tx.query(
        `UPDATE submissions SET status = 'COMPLETED', verdict = $2, score = $3, passed_test_cases = $4, total_test_cases = $5, evaluated_at = NOW()
         WHERE id = $1`,
        [job.submission_id, verdict, score, passed, total],
      );
      await notify(tx, {
        organizationId: job.organization_id,
        userId: job.student_id,
        type: 'SUBMISSION_JUDGED',
        title: `Submission judged: ${verdict.replace(/_/g, ' ').toLowerCase()}`,
        body: `${ctx.question.title}: ${passed}/${total} tests passed. Marks are released by your faculty.`,
        link: job.assignment_id ? `/assignments/${job.assignment_id}` : undefined,
      });
      if (job.assignment_id) {
        const teachers = await tx.query<{ teacher_id: string }>(
          `SELECT DISTINCT tsm.teacher_id FROM assignments a
           JOIN teacher_section_memberships tsm ON tsm.section_id = a.section_id AND tsm.status = 'ACTIVE'
           WHERE a.id = $1`,
          [job.assignment_id],
        );
        for (const t of teachers.rows) {
          await notify(tx, {
            organizationId: job.organization_id,
            userId: t.teacher_id,
            type: 'SUBMISSION_RECEIVED',
            title: 'New coding submission ready for review',
            body: `${ctx.question.title} — ${verdict.replace(/_/g, ' ').toLowerCase()} (${passed}/${total})`,
            link: `/teacher/submissions?assignmentId=${job.assignment_id}`,
          });
        }
      }
    }
  });
  return verdict;
}

function legacyResultStatus(v: Verdict): string {
  switch (v) {
    case 'ACCEPTED':
      return 'PASS';
    case 'WRONG_ANSWER':
      return 'FAIL';
    case 'TIME_LIMIT_EXCEEDED':
      return 'TIMEOUT';
    case 'MEMORY_LIMIT_EXCEEDED':
      return 'MEMORY_LIMIT';
    case 'COMPILE_ERROR':
      return 'COMPILE_ERROR';
    default:
      return 'RUNTIME_ERROR';
  }
}

export async function queueDepth(): Promise<{ queued: number; running: number; failedLastHour: number }> {
  return withScopedTx(JUDGE_CTX, async (tx) => {
    const r = await tx.query<{ queued: string; running: string; failed: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'QUEUED') AS queued,
              COUNT(*) FILTER (WHERE status IN ('COMPILING','RUNNING')) AS running,
              COUNT(*) FILTER (WHERE status = 'FAILED' AND finished_at > NOW() - INTERVAL '1 hour') AS failed
       FROM execution_jobs`,
    );
    return { queued: Number(r.rows[0].queued), running: Number(r.rows[0].running), failedLastHour: Number(r.rows[0].failed) };
  });
}
