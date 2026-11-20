// Private file storage and versioned offline course packages.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate, isPlatformDeveloperRole, isPlatformOwnerRole, requireRole } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { addUsage, withRequestTx, withScopedTx, type Tx } from '../../lib/scoped-sql.js';
import type { TokenPayload } from '../../lib/auth.js';
import { getStorage, maxUploadMb, sha256, signDownloadToken, validateUpload, verifyDownloadToken } from './storage.js';

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

const SAFE = /[^a-zA-Z0-9._-]/g;

/** Students may read course material only for courses allocated to one of their active sections (or platform-free courses). */
async function assertCourseReadable(tx: Tx, user: TokenPayload, courseId: string): Promise<{ organizationId: string | null }> {
  const c = await tx.query<{ organization_id: string | null; access_model: string }>(`SELECT organization_id, access_model FROM courses WHERE id = $1`, [courseId]);
  const course = c.rows[0];
  if (!course) throw Errors.notFound('Course not found');
  if (isPlatformOwnerRole(user.role)) return { organizationId: course.organization_id };
  if (user.role === 'STUDENT') {
    if (course.access_model === 'PLATFORM_FREE') return { organizationId: course.organization_id };
    const a = await tx.query(
      `SELECT 1 FROM course_allocations ca JOIN student_section_memberships m ON m.section_id = ca.section_id AND m.status = 'ACTIVE'
       WHERE ca.course_id = $1 AND m.student_id = $2 AND ca.status = 'ACTIVE' AND ca.access_enabled = TRUE`,
      [courseId, user.userId],
    );
    if (!a.rowCount) throw Errors.forbidden('This course is not allocated to you');
    return { organizationId: course.organization_id };
  }
  if (course.organization_id && course.organization_id !== user.organizationId) {
    const alloc = await tx.query(`SELECT 1 FROM course_allocations WHERE course_id = $1 AND organization_id = $2`, [courseId, user.organizationId]);
    if (!alloc.rowCount) throw Errors.forbidden();
  }
  return { organizationId: course.organization_id };
}

export async function filesRoutes(app: FastifyInstance) {
  // Raw binary uploads (encapsulated to this plugin).
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: maxUploadMb() * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/api/files', { preHandler: [authenticate], bodyLimit: maxUploadMb() * 1024 * 1024 }, async (request, reply) => {
    const user = request.user!;
    if (isPlatformDeveloperRole(user.role)) throw Errors.forbidden();
    const storage = getStorage();
    if (!storage) throw Errors.serviceUnavailable('File storage is not configured (STORAGE_PROVIDER).');
    const q = z
      .object({
        purpose: z.enum(['LEARNING_MATERIAL', 'SUBMISSION_ATTACHMENT', 'AVATAR', 'OTHER']),
        fileName: z.string().min(1).max(200),
        courseId: z.string().nullish(),
        assignmentId: z.string().nullish(),
      })
      .parse(request.query ?? {});
    if (q.purpose === 'LEARNING_MATERIAL' && !['TEACHER', 'ORGANIZATION_ADMIN', 'PLATFORM_OWNER', 'PLATFORM_ADMIN'].includes(user.role)) {
      throw Errors.forbidden('Only faculty and administrators can upload learning material');
    }
    const body = request.body as Buffer;
    if (!Buffer.isBuffer(body)) throw Errors.badRequest('Send the file as the raw request body');
    let contentType: string;
    try {
      contentType = validateUpload(q.fileName, body);
    } catch (e) {
      throw Errors.badRequest((e as Error).message);
    }
    const created = await withRequestTx(async (tx) => {
      let organizationId = user.organizationId;
      if (q.courseId) organizationId = (await assertCourseReadable(tx, user, q.courseId)).organizationId ?? user.organizationId;
      if (q.assignmentId) {
        const a = await tx.query<{ organization_id: string; max_file_size_mb: number | null; section_id: string }>(
          `SELECT organization_id, max_file_size_mb, section_id FROM assignments WHERE id = $1`,
          [q.assignmentId],
        );
        if (!a.rows[0]) throw Errors.notFound('Assignment not found');
        if (a.rows[0].max_file_size_mb && body.length > a.rows[0].max_file_size_mb * 1024 * 1024) {
          throw Errors.badRequest(`File exceeds the assignment limit of ${a.rows[0].max_file_size_mb} MB`);
        }
        organizationId = a.rows[0].organization_id;
      }
      const id = randomUUID();
      const key = `${(organizationId ?? 'platform').replace(SAFE, '_')}/${q.purpose.toLowerCase()}/${id}-${q.fileName.replace(SAFE, '_').slice(0, 120)}`;
      await storage.put(key, body, contentType);
      const r = await tx.query(
        `INSERT INTO file_objects (id, organization_id, owner_id, purpose, original_name, storage_provider, storage_key, content_type, size_bytes, sha256, course_id, assignment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, purpose, original_name, content_type, size_bytes, sha256, course_id, assignment_id, created_at`,
        [id, organizationId, user.userId, q.purpose, q.fileName, storage.name, key, contentType, body.length, sha256(body), q.courseId ?? null, q.assignmentId ?? null],
      );
      await addUsage(tx, organizationId, 'storage_upload_bytes', body.length);
      return r.rows[0];
    });
    return reply.status(201).send(camel(created));
  });

  app.get('/api/files', { preHandler: [authenticate] }, async (request) => {
    const q = request.query as { courseId?: string; assignmentId?: string; purpose?: string };
    return withRequestTx(async (tx) => {
      if (q.courseId && request.user!.role === 'STUDENT') await assertCourseReadable(tx, request.user!, q.courseId);
      const r = await tx.query(
        `SELECT f.id, f.purpose, f.original_name, f.content_type, f.size_bytes, f.sha256, f.course_id, f.assignment_id, f.created_at,
                u.first_name || ' ' || u.last_name AS owner_name
         FROM file_objects f LEFT JOIN users u ON u.id = f.owner_id
         WHERE f.deleted_at IS NULL AND ($1::text IS NULL OR f.course_id = $1) AND ($2::text IS NULL OR f.assignment_id = $2)
           AND ($3::text IS NULL OR f.purpose = $3)
         ORDER BY f.created_at DESC LIMIT 200`,
        [q.courseId ?? null, q.assignmentId ?? null, q.purpose ?? null],
      );
      return { items: r.rows.map((row) => ({ ...camel(row), sizeBytes: Number(row.size_bytes) })) };
    });
  });

  // Short-lived, user-scoped download URL (RLS decides whether the file row is visible at all).
  app.get('/api/files/:id/download-url', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    return withRequestTx(async (tx) => {
      const r = await tx.query<{ id: string; course_id: string | null }>(`SELECT id, course_id FROM file_objects WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!r.rows[0]) throw Errors.notFound('File not found');
      if (user.role === 'STUDENT' && r.rows[0].course_id) await assertCourseReadable(tx, user, r.rows[0].course_id);
      const token = signDownloadToken(id, user.userId);
      return { url: `/api/files/download?token=${encodeURIComponent(token)}`, expiresInSeconds: 300 };
    });
  });

  app.get('/api/files/download', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const claims = token ? verifyDownloadToken(token) : null;
    if (!claims) throw Errors.unauthorized('Download link is invalid or has expired');
    const storage = getStorage();
    if (!storage) throw Errors.serviceUnavailable('File storage is not configured');
    const file = await withScopedTx({ systemContext: 'SYSTEM' }, async (tx) => {
      const r = await tx.query<{ storage_key: string; original_name: string; content_type: string; organization_id: string | null; size_bytes: string }>(
        `SELECT storage_key, original_name, content_type, organization_id, size_bytes FROM file_objects WHERE id = $1 AND deleted_at IS NULL`,
        [claims.fileId],
      );
      if (r.rows[0]) await addUsage(tx, r.rows[0].organization_id, 'download_bytes', Number(r.rows[0].size_bytes));
      return r.rows[0];
    });
    if (!file) throw Errors.notFound('File not found');
    const body = await storage.get(file.storage_key);
    return reply
      .header('content-type', file.content_type)
      .header('content-disposition', `attachment; filename="${file.original_name.replace(/["\r\n]/g, '_')}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(body);
  });

  app.delete('/api/files/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return withRequestTx(async (tx) => {
      const r = await tx.query(`UPDATE file_objects SET deleted_at = NOW(), retention_status = 'DELETED' WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
      if (!r.rowCount) throw Errors.notFound('File not found or not yours');
      return { deleted: true, note: 'Soft-deleted; the stored object is removed by the retention job.' };
    });
  });

  // ---------- Course packages (offline delivery) ----------
  app.post('/api/courses/:id/packages', { preHandler: [requireRole('TEACHER', 'ORGANIZATION_ADMIN', 'PLATFORM_OWNER')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const created = await withRequestTx(async (tx) => {
      const { organizationId } = await assertCourseReadable(tx, user, id);
      const files = await tx.query<{ id: string; original_name: string; size_bytes: string; sha256: string; content_type: string }>(
        `SELECT id, original_name, size_bytes, sha256, content_type FROM file_objects
         WHERE course_id = $1 AND purpose = 'LEARNING_MATERIAL' AND deleted_at IS NULL ORDER BY created_at`,
        [id],
      );
      const course = await tx.query<{ title: string; version: string }>(`SELECT title, version FROM courses WHERE id = $1`, [id]);
      const last = await tx.query<{ v: number | null }>(`SELECT MAX(version) v FROM course_packages WHERE course_id = $1`, [id]);
      const version = (last.rows[0].v ?? 0) + 1;
      const manifest = {
        schemaVersion: 1,
        courseId: id,
        courseTitle: course.rows[0].title,
        courseVersion: course.rows[0].version,
        packageVersion: version,
        requiredAppVersion: '0.4.0',
        createdAt: new Date().toISOString(),
        access: { scope: organizationId ? 'ORGANIZATION' : 'PLATFORM', organizationId },
        resources: files.rows.map((f) => ({
          fileId: f.id,
          path: `resources/${f.id}/${f.original_name.replace(SAFE, '_')}`,
          name: f.original_name,
          sizeBytes: Number(f.size_bytes),
          sha256: f.sha256,
          contentType: f.content_type,
        })),
      };
      const r = await tx.query(
        `INSERT INTO course_packages (course_id, organization_id, version, manifest, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, version, created_at`,
        [id, organizationId ?? user.organizationId, version, JSON.stringify(manifest), user.userId],
      );
      const students = await tx.query<{ student_id: string }>(
        `SELECT DISTINCT m.student_id FROM course_allocations ca JOIN student_section_memberships m ON m.section_id = ca.section_id AND m.status = 'ACTIVE'
         WHERE ca.course_id = $1 AND ca.status = 'ACTIVE'`,
        [id],
      );
      for (const s of students.rows) {
        await tx.query(
          `INSERT INTO notifications (organization_id, user_id, type, title, body, link) VALUES ($1,$2,'COURSE_UPDATED',$3,$4,$5)`,
          [organizationId ?? user.organizationId, s.student_id, `Course updated: ${manifest.courseTitle}`, `Package v${version} with ${manifest.resources.length} resources is available for download.`, `/courses/${id}`],
        );
      }
      return { ...r.rows[0], manifest };
    });
    return reply.status(201).send(created);
  });

  app.get('/api/courses/:id/packages/latest', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    return withRequestTx(async (tx) => {
      await assertCourseReadable(tx, user, id);
      const r = await tx.query<{ id: string; version: number; manifest: { resources: Array<{ fileId: string }> }; created_at: string }>(
        `SELECT id, version, manifest, created_at FROM course_packages WHERE course_id = $1 AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`,
        [id],
      );
      const pkg = r.rows[0];
      if (!pkg) return { available: false };
      return {
        available: true,
        packageId: pkg.id,
        version: pkg.version,
        createdAt: pkg.created_at,
        manifest: pkg.manifest,
        downloads: Object.fromEntries(pkg.manifest.resources.map((res) => [res.fileId, `/api/files/download?token=${encodeURIComponent(signDownloadToken(res.fileId, user.userId, 900))}`])),
      };
    });
  });
}
