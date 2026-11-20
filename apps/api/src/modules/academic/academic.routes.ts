// College academic hierarchy: Organization → Department → Program → Batch → Semester → Class/Section.
// Organization scope is resolved from the authenticated identity; only platform owners may target
// another organization explicitly. RLS enforces the same rules in the database.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, isPlatformOwnerRole, requireRole } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { withRequestTx, type Tx } from '../../lib/scoped-sql.js';
import type { TokenPayload } from '../../lib/auth.js';

type Field = { col: string; schema: z.ZodTypeAny };

const ENTITIES: Record<string, { table: string; order: string; fields: Record<string, Field> }> = {
  departments: {
    table: 'departments',
    order: 'name',
    fields: {
      name: { col: 'name', schema: z.string().min(2).max(120) },
      code: { col: 'code', schema: z.string().min(1).max(20) },
      description: { col: 'description', schema: z.string().max(1000).nullish() },
      hodUserId: { col: 'hod_user_id', schema: z.string().nullish() },
      status: { col: 'status', schema: z.enum(['ACTIVE', 'INACTIVE']) },
    },
  },
  programs: {
    table: 'programs',
    order: 'name',
    fields: {
      name: { col: 'name', schema: z.string().min(2).max(120) },
      code: { col: 'code', schema: z.string().min(1).max(20) },
      departmentId: { col: 'department_id', schema: z.string().nullish() },
      degree: { col: 'degree', schema: z.string().min(1).max(40) },
      durationSemesters: { col: 'duration_semesters', schema: z.number().int().min(1).max(12) },
      status: { col: 'status', schema: z.enum(['ACTIVE', 'INACTIVE']) },
    },
  },
  'academic-years': {
    table: 'academic_years',
    order: 'starts_on DESC',
    fields: {
      label: { col: 'label', schema: z.string().min(4).max(40) },
      startsOn: { col: 'starts_on', schema: z.string().date() },
      endsOn: { col: 'ends_on', schema: z.string().date() },
      status: { col: 'status', schema: z.enum(['ACTIVE', 'CLOSED']) },
    },
  },
  batches: {
    table: 'batches',
    order: 'start_year DESC, name',
    fields: {
      name: { col: 'name', schema: z.string().min(2).max(80) },
      programId: { col: 'program_id', schema: z.string().nullish() },
      startYear: { col: 'start_year', schema: z.number().int().min(2000).max(2100) },
      endYear: { col: 'end_year', schema: z.number().int().min(2000).max(2100) },
      status: { col: 'status', schema: z.enum(['ACTIVE', 'GRADUATED', 'INACTIVE']) },
    },
  },
  semesters: {
    table: 'semesters',
    order: 'number',
    fields: {
      name: { col: 'name', schema: z.string().min(1).max(80) },
      number: { col: 'number', schema: z.number().int().min(1).max(12) },
      batchId: { col: 'batch_id', schema: z.string().nullish() },
      academicYearId: { col: 'academic_year_id', schema: z.string().nullish() },
      startsOn: { col: 'starts_on', schema: z.string().date().nullish() },
      endsOn: { col: 'ends_on', schema: z.string().date().nullish() },
      status: { col: 'status', schema: z.enum(['ACTIVE', 'COMPLETED', 'UPCOMING']) },
    },
  },
};

const REFERENCES: Record<string, string> = {
  department_id: 'departments',
  program_id: 'programs',
  batch_id: 'batches',
  academic_year_id: 'academic_years',
  hod_user_id: 'users',
};

function orgFor(user: TokenPayload, requested?: string | null): string {
  if (isPlatformOwnerRole(user.role)) {
    const org = requested ?? user.organizationId;
    if (!org) throw Errors.badRequest('organizationId is required');
    return org;
  }
  if (!user.organizationId) throw Errors.forbidden('No organization membership');
  return user.organizationId; // client-supplied organizationId is ignored
}

function toCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return out;
}

async function assertSameOrgReferences(tx: Tx, orgId: string, values: Record<string, unknown>) {
  for (const [col, table] of Object.entries(REFERENCES)) {
    const id = values[col];
    if (id === undefined || id === null) continue;
    const r = await tx.query(`SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2`, [id, orgId]);
    if (r.rowCount === 0) throw Errors.badRequest(`${col} does not belong to this organization`);
  }
}

export async function academicRoutes(app: FastifyInstance) {
  const writers = requireRole('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'ORGANIZATION_ADMIN');

  for (const [path, def] of Object.entries(ENTITIES)) {
    app.get(`/api/academic/${path}`, { preHandler: [authenticate] }, async (request) => {
      const q = request.query as { organizationId?: string };
      const orgId = orgFor(request.user!, q.organizationId);
      return withRequestTx(async (tx) => {
        const r = await tx.query(`SELECT * FROM ${def.table} WHERE organization_id = $1 ORDER BY ${def.order}`, [orgId]);
        return { items: r.rows.map(toCamel) };
      });
    });

    app.post(`/api/academic/${path}`, { preHandler: [writers] }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const orgId = orgFor(request.user!, body.organizationId as string | undefined);
      const cols: string[] = [];
      const vals: unknown[] = [];
      const valueMap: Record<string, unknown> = {};
      for (const [key, f] of Object.entries(def.fields)) {
        if (body[key] === undefined) continue;
        const parsed = f.schema.safeParse(body[key]);
        if (!parsed.success) throw Errors.badRequest(`Invalid ${key}`, parsed.error.issues);
        cols.push(f.col);
        vals.push(parsed.data);
        valueMap[f.col] = parsed.data;
      }
      const required = Object.entries(def.fields).filter(([, f]) => !f.schema.isOptional() && f.col !== 'status').map(([k]) => k);
      const missing = required.filter((k) => body[k] === undefined);
      if (missing.length) throw Errors.badRequest(`Missing fields: ${missing.join(', ')}`);
      const created = await withRequestTx(async (tx) => {
        await assertSameOrgReferences(tx, orgId, valueMap);
        try {
          const r = await tx.query(
            `INSERT INTO ${def.table} (organization_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
            [orgId, ...vals],
          );
          await tx.query(
            `INSERT INTO audit_logs (id, organization_id, user_id, user_email, action, entity_type, entity_id, details)
             VALUES (gen_random_uuid()::text, $1, $2, $3, 'CREATE', $4, $5, $6)`,
            [orgId, request.user!.userId, request.user!.email, def.table, r.rows[0].id, JSON.stringify(valueMap)],
          );
          return r.rows[0];
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw Errors.conflict('A record with this name/code already exists');
          throw error;
        }
      });
      return reply.status(201).send(toCamel(created));
    });

    app.patch(`/api/academic/${path}/:id`, { preHandler: [writers] }, async (request) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const sets: string[] = [];
      const vals: unknown[] = [id];
      const valueMap: Record<string, unknown> = {};
      for (const [key, f] of Object.entries(def.fields)) {
        if (body[key] === undefined) continue;
        const parsed = f.schema.safeParse(body[key]);
        if (!parsed.success) throw Errors.badRequest(`Invalid ${key}`, parsed.error.issues);
        vals.push(parsed.data);
        sets.push(`${f.col} = $${vals.length}`);
        valueMap[f.col] = parsed.data;
      }
      if (!sets.length) throw Errors.badRequest('Nothing to update');
      return withRequestTx(async (tx) => {
        const existing = await tx.query<{ organization_id: string }>(`SELECT organization_id FROM ${def.table} WHERE id = $1`, [id]);
        if (!existing.rows[0]) throw Errors.notFound();
        await assertSameOrgReferences(tx, existing.rows[0].organization_id, valueMap);
        const r = await tx.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
        if (!r.rows[0]) throw Errors.forbidden();
        return toCamel(r.rows[0]);
      });
    });
  }

  // Whole hierarchy with counts, for drill-down navigation.
  app.get('/api/academic/tree', { preHandler: [authenticate] }, async (request) => {
    const orgId = orgFor(request.user!, (request.query as { organizationId?: string }).organizationId);
    return withRequestTx(async (tx) => {
      const [depts, progs, batches, sems, classes] = await Promise.all([
        tx.query(`SELECT id, name, code, hod_user_id, status FROM departments WHERE organization_id = $1 ORDER BY name`, [orgId]),
        tx.query(`SELECT id, name, code, department_id, degree, duration_semesters FROM programs WHERE organization_id = $1 ORDER BY name`, [orgId]),
        tx.query(`SELECT id, name, program_id, start_year, end_year, status FROM batches WHERE organization_id = $1 ORDER BY start_year DESC`, [orgId]),
        tx.query(`SELECT id, name, number, batch_id, academic_year_id, status FROM semesters WHERE organization_id = $1 ORDER BY number`, [orgId]),
        tx.query(
          `SELECT c.id, c.name, c.department_id, c.program_id, c.batch_id, c.semester_id,
                  (SELECT COUNT(*) FROM sections s WHERE s.class_id = c.id)::int AS sections,
                  (SELECT COUNT(*) FROM student_section_memberships m JOIN sections s ON s.id = m.section_id
                    WHERE s.class_id = c.id AND m.status = 'ACTIVE')::int AS students
           FROM classes c WHERE c.organization_id = $1 ORDER BY c.name`,
          [orgId],
        ),
      ]);
      return {
        departments: depts.rows.map(toCamel),
        programs: progs.rows.map(toCamel),
        batches: batches.rows.map(toCamel),
        semesters: sems.rows.map(toCamel),
        classes: classes.rows.map(toCamel),
      };
    });
  });

  // Link an existing class (cohort) to the hierarchy.
  app.patch('/api/academic/classes/:id/placement', { preHandler: [writers] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ departmentId: z.string().nullish(), programId: z.string().nullish(), batchId: z.string().nullish(), semesterId: z.string().nullish() })
      .parse(request.body ?? {});
    return withRequestTx(async (tx) => {
      const c = await tx.query<{ organization_id: string }>(`SELECT organization_id FROM classes WHERE id = $1`, [id]);
      if (!c.rows[0]) throw Errors.notFound('Class not found');
      const orgId = c.rows[0].organization_id;
      const values = { department_id: body.departmentId, program_id: body.programId, batch_id: body.batchId };
      await assertSameOrgReferences(tx, orgId, values);
      if (body.semesterId) {
        const s = await tx.query(`SELECT 1 FROM semesters WHERE id = $1 AND organization_id = $2`, [body.semesterId, orgId]);
        if (!s.rowCount) throw Errors.badRequest('semesterId does not belong to this organization');
      }
      const r = await tx.query(
        `UPDATE classes SET department_id = COALESCE($2, department_id), program_id = COALESCE($3, program_id),
                batch_id = COALESCE($4, batch_id), semester_id = COALESCE($5, semester_id), updated_at = NOW()
         WHERE id = $1 RETURNING id, department_id, program_id, batch_id, semester_id`,
        [id, body.departmentId ?? null, body.programId ?? null, body.batchId ?? null, body.semesterId ?? null],
      );
      if (!r.rows[0]) throw Errors.forbidden();
      return toCamel(r.rows[0]);
    });
  });

  // Scoped role assignments (HOD, department admin, teaching assistant).
  app.get('/api/academic/role-assignments', { preHandler: [authenticate] }, async (request) =>
    withRequestTx(async (tx) => {
      const orgId = orgFor(request.user!, (request.query as { organizationId?: string }).organizationId);
      const r = await tx.query(
        `SELECT ra.id, ra.user_id, ra.role, ra.scope_type, ra.scope_id, ra.created_at, u.first_name || ' ' || u.last_name AS user_name, u.email,
                d.name AS department_name
         FROM role_assignments ra JOIN users u ON u.id = ra.user_id
         LEFT JOIN departments d ON ra.scope_type = 'DEPARTMENT' AND d.id = ra.scope_id
         WHERE ra.organization_id = $1 AND ra.revoked_at IS NULL ORDER BY ra.created_at DESC`,
        [orgId],
      );
      return { items: r.rows.map(toCamel) };
    }),
  );

  app.post('/api/academic/role-assignments', { preHandler: [writers] }, async (request, reply) => {
    const body = z
      .object({
        userId: z.string().min(1),
        role: z.enum(['DEPARTMENT_ADMIN', 'HOD', 'FACULTY', 'TEACHING_ASSISTANT']),
        scopeType: z.enum(['ORGANIZATION', 'DEPARTMENT', 'PROGRAM', 'COURSE', 'SECTION']),
        scopeId: z.string().nullish(),
        organizationId: z.string().nullish(),
      })
      .parse(request.body ?? {});
    const orgId = orgFor(request.user!, body.organizationId);
    const created = await withRequestTx(async (tx) => {
      const u = await tx.query<{ role: string }>(`SELECT role FROM users WHERE id = $1 AND organization_id = $2`, [body.userId, orgId]);
      if (!u.rows[0]) throw Errors.badRequest('User does not belong to this organization');
      if (['HOD', 'DEPARTMENT_ADMIN', 'FACULTY', 'TEACHING_ASSISTANT'].includes(body.role) && u.rows[0].role === 'STUDENT') {
        throw Errors.badRequest('Students cannot hold staff roles');
      }
      if (body.scopeType === 'DEPARTMENT') {
        const d = await tx.query(`SELECT 1 FROM departments WHERE id = $1 AND organization_id = $2`, [body.scopeId, orgId]);
        if (!d.rowCount) throw Errors.badRequest('Department not found in this organization');
        if (body.role === 'HOD') await tx.query(`UPDATE departments SET hod_user_id = $1, updated_at = NOW() WHERE id = $2`, [body.userId, body.scopeId]);
      }
      const r = await tx.query(
        `INSERT INTO role_assignments (user_id, organization_id, role, scope_type, scope_id, granted_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING RETURNING *`,
        [body.userId, orgId, body.role, body.scopeType, body.scopeId ?? null, request.user!.userId],
      );
      return r.rows[0] ?? { duplicate: true };
    });
    return reply.status(201).send(toCamel(created));
  });

  app.delete('/api/academic/role-assignments/:id', { preHandler: [writers] }, async (request) => {
    const { id } = request.params as { id: string };
    return withRequestTx(async (tx) => {
      const r = await tx.query(`UPDATE role_assignments SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
      if (!r.rowCount) throw Errors.notFound();
      return { revoked: true };
    });
  });

  // The departments this user may manage as HOD / department admin.
  app.get('/api/academic/my-scopes', { preHandler: [authenticate] }, async (request) =>
    withRequestTx(async (tx) => {
      const r = await tx.query(
        `SELECT ra.role, ra.scope_type, ra.scope_id, d.name AS department_name FROM role_assignments ra
         LEFT JOIN departments d ON d.id = ra.scope_id
         WHERE ra.user_id = $1 AND ra.revoked_at IS NULL`,
        [request.user!.userId],
      );
      return { scopes: r.rows.map(toCamel) };
    }),
  );
}
