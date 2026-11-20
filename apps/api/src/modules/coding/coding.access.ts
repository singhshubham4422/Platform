import { Errors } from '../../lib/errors.js';
import type { TokenPayload } from '../../lib/auth.js';
import type { Tx } from '../../lib/scoped-sql.js';

export interface QuestionAccess {
  questionId: string;
  assignmentId: string | null;
  organizationId: string | null;
  allowedLanguages: string[];
  courseId: string | null;
  sectionId: string | null;
}

/**
 * Resolve whether `user` may work on `questionId` (optionally inside `assignmentId`).
 * Organization is always derived from the database, never trusted from the client.
 */
export async function resolveStudentQuestionAccess(
  tx: Tx,
  user: TokenPayload,
  questionId: string,
  assignmentId: string | null | undefined,
): Promise<QuestionAccess> {
  const q = await tx.query<{ id: string; organization_id: string | null; supported_languages: string[]; course_id: string | null; question_type: string; status: string }>(
    `SELECT id, organization_id, supported_languages, course_id, question_type, status FROM questions WHERE id = $1`,
    [questionId],
  );
  const question = q.rows[0];
  if (!question) throw Errors.notFound('Question not found');
  if (!['CODE', 'PROGRAMMING', 'CODING'].includes(question.question_type)) {
    throw Errors.badRequest('Only coding questions can be executed');
  }

  if (assignmentId) {
    const a = await tx.query<{ id: string; organization_id: string; section_id: string; status: string; allowed_languages: string[]; course_id: string | null }>(
      `SELECT a.id, a.organization_id, a.section_id, a.status, a.allowed_languages, ca.course_id
       FROM assignments a LEFT JOIN course_allocations ca ON ca.id = a.course_allocation_id
       WHERE a.id = $1`,
      [assignmentId],
    );
    const assignment = a.rows[0];
    if (!assignment) throw Errors.notFound('Assignment not found');
    const linked = await tx.query(`SELECT 1 FROM assignment_questions WHERE assignment_id = $1 AND question_id = $2`, [assignmentId, questionId]);
    if (linked.rowCount === 0) throw Errors.badRequest('Question is not part of this assignment');
    if (user.role === 'STUDENT') {
      const m = await tx.query(
        `SELECT 1 FROM student_section_memberships WHERE section_id = $1 AND student_id = $2 AND status = 'ACTIVE'`,
        [assignment.section_id, user.userId],
      );
      if (m.rowCount === 0) throw Errors.forbidden('You are not enrolled in this assignment section');
      if (!['PUBLISHED', 'CLOSED'].includes(assignment.status)) throw Errors.forbidden('Assignment is not open');
    } else if (user.role === 'TEACHER') {
      const m = await tx.query(
        `SELECT 1 FROM teacher_section_memberships WHERE section_id = $1 AND teacher_id = $2 AND status = 'ACTIVE'`,
        [assignment.section_id, user.userId],
      );
      if (m.rowCount === 0) throw Errors.forbidden('You do not teach this section');
    } else if (user.role !== 'PLATFORM_OWNER' && user.role !== 'PLATFORM_ADMIN' && assignment.organization_id !== user.organizationId) {
      throw Errors.forbidden('Access denied');
    }
    return {
      questionId,
      assignmentId,
      organizationId: assignment.organization_id,
      allowedLanguages: assignment.allowed_languages,
      courseId: assignment.course_id ?? question.course_id,
      sectionId: assignment.section_id,
    };
  }

  // Practice mode: any published question the user can read (RLS already scoped the SELECT).
  if (user.role === 'STUDENT' && !['PUBLISHED', 'ACTIVE'].includes(question.status)) {
    throw Errors.forbidden('Question is not available for practice');
  }
  return {
    questionId,
    assignmentId: null,
    organizationId: user.organizationId,
    allowedLanguages: question.supported_languages?.length ? question.supported_languages : ['PYTHON', 'C', 'CPP', 'JAVA'],
    courseId: question.course_id,
    sectionId: null,
  };
}

export const MAX_ACTIVE_JOBS_PER_USER = Number(process.env.JUDGE_MAX_ACTIVE_JOBS_PER_USER || 3);

export async function enforceJudgeQuota(tx: Tx, userId: string, organizationId: string | null): Promise<void> {
  const active = await tx.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM execution_jobs WHERE student_id = $1 AND status IN ('QUEUED','COMPILING','RUNNING')`,
    [userId],
  );
  if (Number(active.rows[0].n) >= MAX_ACTIVE_JOBS_PER_USER) {
    throw Errors.tooManyRequests(`You already have ${MAX_ACTIVE_JOBS_PER_USER} executions in progress. Wait for them to finish.`);
  }
  if (!organizationId) return;
  const limit = await tx.query<{ limit: number | null; used: string | null }>(
    `SELECT (SELECT sp.judge_executions_per_month FROM organization_subscriptions os
               JOIN subscription_plans sp ON sp.id = os.plan_id
              WHERE os.organization_id = $1 AND os.status = 'ACTIVE' ORDER BY os.starts_at DESC LIMIT 1) AS limit,
            (SELECT quantity::text FROM usage_records WHERE organization_id = $1 AND metric = 'judge_executions'
              AND period = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM')) AS used`,
    [organizationId],
  );
  const row = limit.rows[0];
  if (row?.limit != null && Number(row.used ?? 0) >= row.limit) {
    throw Errors.tooManyRequests('Your institution has reached its monthly code-execution quota.');
  }
}
