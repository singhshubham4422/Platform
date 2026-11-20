// Institutional analytics computed from persisted academic records (no generated figures).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, isPlatformOwnerRole, requireRole } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { withRequestTx, type Tx } from '../../lib/scoped-sql.js';
import type { TokenPayload } from '../../lib/auth.js';
import { studentSkillProfile } from './skills.js';

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && k !== 'id' && !k.endsWith('_id') && !k.endsWith('code') ? Number(v) : v]));

function orgFor(user: TokenPayload, requested?: string): string {
  if (isPlatformOwnerRole(user.role) && requested) return requested;
  if (!user.organizationId) throw Errors.badRequest('organizationId is required');
  return user.organizationId;
}

/** Score % for released/graded coding and written work, per student. */
const STUDENT_SCORES_CTE = `
  student_scores AS (
    SELECT s.student_id, a.section_id, a.id AS assignment_id,
           100.0 * s.score / NULLIF(COALESCE(aq.marks, q.marks), 0) AS pct
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN questions q ON q.id = s.question_id
    LEFT JOIN assignment_questions aq ON aq.assignment_id = a.id AND aq.question_id = s.question_id
    WHERE a.organization_id = $1 AND s.status IN ('COMPLETED','GRADED','RELEASED') AND s.score IS NOT NULL
  )`;

async function departmentPerformance(tx: Tx, orgId: string, departmentId: string | null) {
  const r = await tx.query(
    `WITH ${STUDENT_SCORES_CTE}
     SELECT d.id, d.name, d.code,
            (SELECT COUNT(DISTINCT m.student_id) FROM classes c JOIN sections sec ON sec.class_id = c.id
               JOIN student_section_memberships m ON m.section_id = sec.id AND m.status = 'ACTIVE' WHERE c.department_id = d.id)::int AS students,
            (SELECT COUNT(DISTINCT t.teacher_id) FROM classes c JOIN sections sec ON sec.class_id = c.id
               JOIN teacher_section_memberships t ON t.section_id = sec.id AND t.status = 'ACTIVE' WHERE c.department_id = d.id)::int AS faculty,
            (SELECT ROUND(AVG(ss.pct)::numeric, 1) FROM student_scores ss JOIN sections sec ON sec.id = ss.section_id
               JOIN classes c ON c.id = sec.class_id WHERE c.department_id = d.id) AS avg_score
     FROM departments d WHERE d.organization_id = $1 AND ($2::text IS NULL OR d.id = $2) ORDER BY d.name`,
    [orgId, departmentId],
  );
  return r.rows.map(camel);
}

async function studentsNeedingSupport(tx: Tx, orgId: string, departmentId: string | null) {
  const r = await tx.query(
    `WITH ${STUDENT_SCORES_CTE},
     dept_students AS (
       SELECT DISTINCT m.student_id FROM student_section_memberships m JOIN sections sec ON sec.id = m.section_id
       JOIN classes c ON c.id = sec.class_id WHERE c.organization_id = $1 AND m.status = 'ACTIVE' AND ($2::text IS NULL OR c.department_id = $2)
     ),
     missed AS (
       SELECT m.student_id, COUNT(*) AS missed FROM assignments a
       JOIN student_section_memberships m ON m.section_id = a.section_id AND m.status = 'ACTIVE'
       WHERE a.organization_id = $1 AND a.status IN ('PUBLISHED','CLOSED') AND a.due_date < NOW()
         AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = m.student_id)
       GROUP BY m.student_id
     )
     SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.email,
            ROUND(AVG(ss.pct)::numeric, 1) AS avg_score, COUNT(ss.pct)::int AS graded, COALESCE(mi.missed, 0)::int AS missed
     FROM dept_students ds JOIN users u ON u.id = ds.student_id
     LEFT JOIN student_scores ss ON ss.student_id = u.id
     LEFT JOIN missed mi ON mi.student_id = u.id
     GROUP BY u.id, u.first_name, u.last_name, u.email, mi.missed
     HAVING (COUNT(ss.pct) >= 2 AND AVG(ss.pct) < 40) OR COALESCE(mi.missed, 0) >= 2
     ORDER BY COALESCE(mi.missed, 0) DESC, AVG(ss.pct) NULLS LAST LIMIT 50`,
    [orgId, departmentId],
  );
  return r.rows.map((row) => ({
    ...camel(row),
    reasons: [
      ...(Number(row.graded) >= 2 && Number(row.avg_score) < 40 ? [`Average score ${row.avg_score}% across ${row.graded} graded items`] : []),
      ...(Number(row.missed) >= 2 ? [`${row.missed} past-due assignments without a submission`] : []),
    ],
  }));
}

async function coursePerformance(tx: Tx, orgId: string, departmentId: string | null) {
  const r = await tx.query(
    `WITH ${STUDENT_SCORES_CTE}
     SELECT co.id, co.title, co.semester_number, sec.id AS section_id, sec.name AS section_name, cl.name AS class_name,
            COUNT(DISTINCT ss.student_id)::int AS students_assessed, ROUND(AVG(ss.pct)::numeric, 1) AS avg_score,
            (SELECT COUNT(*) FROM assignments a WHERE a.course_allocation_id = ca.id AND a.status IN ('PUBLISHED','CLOSED'))::int AS assignments
     FROM course_allocations ca JOIN courses co ON co.id = ca.course_id
     JOIN sections sec ON sec.id = ca.section_id JOIN classes cl ON cl.id = sec.class_id
     LEFT JOIN assignments a2 ON a2.course_allocation_id = ca.id
     LEFT JOIN student_scores ss ON ss.assignment_id = a2.id
     WHERE ca.organization_id = $1 AND ca.status = 'ACTIVE' AND ($2::text IS NULL OR cl.department_id = $2)
     GROUP BY co.id, co.title, co.semester_number, sec.id, sec.name, cl.name, ca.id
     ORDER BY co.semester_number NULLS LAST, co.title, sec.name`,
    [orgId, departmentId],
  );
  return r.rows.map(camel);
}

async function semesterProgress(tx: Tx, orgId: string, departmentId: string | null) {
  const r = await tx.query(
    `SELECT sm.id, sm.name, sm.number, b.name AS batch_name, sm.status,
            COUNT(DISTINCT a.id)::int AS assignments,
            COUNT(DISTINCT m.student_id)::int AS students,
            COUNT(DISTINCT (s.student_id, s.assignment_id))::int AS submissions_made,
            (COUNT(DISTINCT a.id) * COUNT(DISTINCT m.student_id))::int AS submissions_expected
     FROM semesters sm LEFT JOIN batches b ON b.id = sm.batch_id
     LEFT JOIN classes c ON c.semester_id = sm.id AND ($2::text IS NULL OR c.department_id = $2)
     LEFT JOIN sections sec ON sec.class_id = c.id
     LEFT JOIN student_section_memberships m ON m.section_id = sec.id AND m.status = 'ACTIVE'
     LEFT JOIN assignments a ON a.section_id = sec.id AND a.status IN ('PUBLISHED','CLOSED')
     LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = m.student_id
     WHERE sm.organization_id = $1
     GROUP BY sm.id, sm.name, sm.number, b.name, sm.status ORDER BY b.name, sm.number`,
    [orgId, departmentId],
  );
  return r.rows.map((row) => ({
    ...camel(row),
    completionPct: Number(row.submissions_expected) > 0 ? Math.round((100 * Number(row.submissions_made)) / Number(row.submissions_expected)) : null,
  }));
}

async function assertDepartmentScope(tx: Tx, user: TokenPayload, departmentId: string): Promise<string> {
  const d = await tx.query<{ organization_id: string }>(`SELECT organization_id FROM departments WHERE id = $1`, [departmentId]);
  if (!d.rows[0]) throw Errors.notFound('Department not found');
  if (isPlatformOwnerRole(user.role) || user.role === 'ORGANIZATION_ADMIN') return d.rows[0].organization_id;
  const ra = await tx.query(
    `SELECT 1 FROM role_assignments WHERE user_id = $1 AND role IN ('HOD','DEPARTMENT_ADMIN') AND scope_type = 'DEPARTMENT'
       AND scope_id = $2 AND revoked_at IS NULL`,
    [user.userId, departmentId],
  );
  if (!ra.rowCount) throw Errors.forbidden('You are not authorised for this department');
  return d.rows[0].organization_id;
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/organization', { preHandler: [requireRole('PLATFORM_OWNER', 'ORGANIZATION_ADMIN')] }, async (request) => {
    const orgId = orgFor(request.user!, (request.query as { organizationId?: string }).organizationId);
    return withRequestTx(async (tx) => {
      const totals = await tx.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'STUDENT')::int AS students,
           (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'STUDENT' AND status = 'ACTIVE')::int AS active_students,
           (SELECT COUNT(DISTINCT student_id) FROM activity_events WHERE organization_id = $1 AND client_ts > NOW() - INTERVAL '7 days')::int AS students_active_7d,
           (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'TEACHER')::int AS faculty,
           (SELECT COUNT(*) FROM departments WHERE organization_id = $1)::int AS departments,
           (SELECT COUNT(*) FROM programs WHERE organization_id = $1)::int AS programs,
           (SELECT COUNT(*) FROM batches WHERE organization_id = $1)::int AS batches,
           (SELECT COUNT(DISTINCT course_id) FROM course_allocations WHERE organization_id = $1 AND status = 'ACTIVE')::int AS courses,
           (SELECT COUNT(*) FROM assignments WHERE organization_id = $1 AND status = 'PUBLISHED')::int AS active_assignments,
           (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.organization_id = $1)::int AS submissions,
           (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
              WHERE a.organization_id = $1 AND s.feedback_released_at IS NOT NULL)::int AS released_results`,
        [orgId],
      );
      const [departments, courses, semesters, support] = await Promise.all([
        departmentPerformance(tx, orgId, null),
        coursePerformance(tx, orgId, null),
        semesterProgress(tx, orgId, null),
        studentsNeedingSupport(tx, orgId, null),
      ]);
      return { organizationId: orgId, totals: camel(totals.rows[0]), departments, courses, semesters, studentsNeedingSupport: support };
    });
  });

  app.get('/api/analytics/departments/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return withRequestTx(async (tx) => {
      const orgId = await assertDepartmentScope(tx, request.user!, id);
      const [dept, courses, semesters, support, faculty] = await Promise.all([
        departmentPerformance(tx, orgId, id),
        coursePerformance(tx, orgId, id),
        semesterProgress(tx, orgId, id),
        studentsNeedingSupport(tx, orgId, id),
        tx.query(
          `SELECT DISTINCT u.id, u.first_name || ' ' || u.last_name AS name, u.email FROM classes c
           JOIN sections sec ON sec.class_id = c.id JOIN teacher_section_memberships t ON t.section_id = sec.id AND t.status = 'ACTIVE'
           JOIN users u ON u.id = t.teacher_id WHERE c.department_id = $1 ORDER BY name`,
          [id],
        ),
      ]);
      const assignmentStats = await tx.query(
        `SELECT COUNT(DISTINCT a.id)::int AS assignments, COUNT(s.id)::int AS submissions,
                COUNT(s.id) FILTER (WHERE s.review_status = 'PENDING' AND s.status IN ('COMPLETED','PENDING_REVIEW','PENDING'))::int AS pending_review
         FROM assignments a JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
         LEFT JOIN submissions s ON s.assignment_id = a.id WHERE c.department_id = $1`,
        [id],
      );
      return { department: dept[0] ?? null, courses, semesters, studentsNeedingSupport: support, faculty: faculty.rows.map(camel), assignmentStats: camel(assignmentStats.rows[0]) };
    });
  });

  // Full historical academic profile; semester moves never reset it.
  app.get('/api/analytics/students/:id/profile', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (user.role === 'STUDENT' && user.userId !== id) throw Errors.forbidden();
    return withRequestTx(async (tx) => {
      const ok = await tx.query(`SELECT rls_can_view_student_work($1, (SELECT organization_id FROM users WHERE id = $1)) AS ok`, [id]);
      if (!ok.rows[0]?.ok && !isPlatformOwnerRole(user.role)) throw Errors.forbidden('Not authorised for this student');
      const u = await tx.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.status, u.created_at, o.name AS organization_name FROM users u
         LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = $1`,
        [id],
      );
      if (!u.rows[0]) throw Errors.notFound('Student not found');
      const enrollments = await tx.query(
        `SELECT sec.id AS section_id, sec.name AS section_name, c.name AS class_name, d.name AS department_name, p.name AS program_name,
                b.name AS batch_name, sm.name AS semester_name, sm.number AS semester_number, m.status, m.joined_at, m.left_at
         FROM student_section_memberships m JOIN sections sec ON sec.id = m.section_id JOIN classes c ON c.id = sec.class_id
         LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN programs p ON p.id = c.program_id
         LEFT JOIN batches b ON b.id = c.batch_id LEFT JOIN semesters sm ON sm.id = c.semester_id
         WHERE m.student_id = $1 ORDER BY sm.number NULLS LAST, m.joined_at`,
        [id],
      );
      const results = await tx.query(
        `SELECT s.id, s.assignment_id, a.title AS assignment_title, q.title AS question_title, s.language, s.status, s.verdict, s.score,
                COALESCE(aq.marks, q.marks) AS max_marks, s.passed_test_cases, s.total_test_cases, s.submitted_at, s.feedback_released_at,
                s.teacher_feedback, co.title AS course_title, co.semester_number
         FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN questions q ON q.id = s.question_id
         LEFT JOIN assignment_questions aq ON aq.assignment_id = a.id AND aq.question_id = q.id
         LEFT JOIN course_allocations ca ON ca.id = a.course_allocation_id LEFT JOIN courses co ON co.id = ca.course_id
         WHERE s.student_id = $1 ORDER BY s.submitted_at DESC LIMIT 200`,
        [id],
      );
      const coding = await tx.query(
        `SELECT language, COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE verdict = 'ACCEPTED')::int AS accepted
         FROM execution_jobs WHERE student_id = $1 GROUP BY language`,
        [id],
      );
      const notes = user.role === 'STUDENT' ? { rows: [] } : await tx.query(
        `SELECT n.id, n.body, n.created_at, u.first_name || ' ' || u.last_name AS author FROM faculty_notes n
         JOIN users u ON u.id = n.author_id WHERE n.student_id = $1 ORDER BY n.created_at DESC`,
        [id],
      );
      const skills = await studentSkillProfile(tx, id);
      const isStudent = user.role === 'STUDENT';
      return {
        student: camel(u.rows[0]),
        enrollments: enrollments.rows.map(camel),
        results: results.rows.map((r) => {
          const row = camel(r);
          // Students only see marks once released by faculty.
          if (isStudent && !r.feedback_released_at) return { ...row, score: null, teacherFeedback: null };
          return row;
        }),
        coding: coding.rows.map(camel),
        notes: notes.rows.map(camel),
        ...skills,
      };
    });
  });

  app.post('/api/analytics/students/:id/notes', { preHandler: [requireRole('TEACHER', 'ORGANIZATION_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(request.body ?? {});
    const user = request.user!;
    const note = await withRequestTx(async (tx) => {
      const r = await tx.query(
        `INSERT INTO faculty_notes (organization_id, student_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at`,
        [user.organizationId, id, user.userId, body],
      );
      return r.rows[0];
    });
    return reply.status(201).send(camel(note));
  });

  // Faculty teaching overview.
  app.get('/api/analytics/faculty', { preHandler: [requireRole('TEACHER')] }, async (request) => {
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const sections = await tx.query(
        `SELECT sec.id, sec.name, c.name AS class_name, co.title AS course_title, co.id AS course_id, ca.id AS allocation_id,
                (SELECT COUNT(*) FROM student_section_memberships m WHERE m.section_id = sec.id AND m.status = 'ACTIVE')::int AS students
         FROM teacher_section_memberships t JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
         LEFT JOIN course_allocations ca ON ca.section_id = sec.id AND ca.status = 'ACTIVE' LEFT JOIN courses co ON co.id = ca.course_id
         WHERE t.teacher_id = $1 AND t.status = 'ACTIVE' ORDER BY c.name, sec.name`,
        [user.userId],
      );
      const pending = await tx.query(
        `SELECT s.id, s.student_id, u.first_name || ' ' || u.last_name AS student_name, a.title AS assignment_title, q.title AS question_title,
                s.language, s.verdict, s.status, s.score, s.submitted_at, s.assignment_id
         FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN questions q ON q.id = s.question_id JOIN users u ON u.id = s.student_id
         WHERE s.review_status = 'PENDING' AND s.status IN ('COMPLETED','PENDING_REVIEW','PENDING','ERROR')
           AND EXISTS (SELECT 1 FROM teacher_section_memberships t WHERE t.section_id = a.section_id AND t.teacher_id = $1 AND t.status = 'ACTIVE')
         ORDER BY s.submitted_at DESC LIMIT 20`,
        [user.userId],
      );
      const completion = await tx.query(
        `SELECT a.id, a.title, a.due_date, a.status,
                (SELECT COUNT(*) FROM student_section_memberships m WHERE m.section_id = a.section_id AND m.status = 'ACTIVE')::int AS students,
                (SELECT COUNT(DISTINCT s.student_id) FROM submissions s WHERE s.assignment_id = a.id)::int AS submitted
         FROM assignments a WHERE a.status IN ('PUBLISHED','CLOSED')
           AND EXISTS (SELECT 1 FROM teacher_section_memberships t WHERE t.section_id = a.section_id AND t.teacher_id = $1 AND t.status = 'ACTIVE')
         ORDER BY a.due_date DESC LIMIT 12`,
        [user.userId],
      );
      const activity = await tx.query(
        `SELECT e.event_type, e.client_ts, u.first_name || ' ' || u.last_name AS student_name, q.title AS question_title
         FROM activity_events e JOIN users u ON u.id = e.student_id LEFT JOIN questions q ON q.id = e.question_id
         WHERE e.event_type IN ('submission_created','question_completed','execution_completed') AND e.client_ts > NOW() - INTERVAL '14 days'
         ORDER BY e.client_ts DESC LIMIT 15`,
      );
      return {
        sections: sections.rows.map(camel),
        pendingReviews: pending.rows.map(camel),
        assignmentCompletion: completion.rows.map(camel),
        recentActivity: activity.rows.map(camel),
      };
    });
  });
}
