import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'node:crypto';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { invitations, organizations } from '../db/schema/index.js';
import { Errors } from '../lib/errors.js';
import { z } from 'zod';
import { hashPassword } from '../lib/auth.js';
import { withRequestTx, withScopedTx, type Tx } from '../lib/scoped-sql.js';
import { sendEmail } from '../modules/notifications/email.js';

async function sendInvitationEmail(tx: Tx, to: string, orgName: string, role: string, token: string): Promise<boolean> {
  const base = (process.env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return sendEmail(tx, {
    to,
    subject: `You are invited to ${orgName} on L_Platform`,
    template: 'invitation',
    text: `You have been invited to join ${orgName} as ${role.replace('_', ' ').toLowerCase()}.

Accept: ${base}/invite/accept?token=${token}

This link expires in 7 days.`,
  });
}
import { isPlatformOwnerRole, requireRole } from '../middleware/auth.js';

async function toInvitationDto(invitation: typeof invitations.$inferSelect) {
  const organization = await db.query.organizations.findFirst({
    where: eq(organizations.id, invitation.organizationId),
    columns: { name: true },
  });
  return {
    id: invitation.id,
    publicId: invitation.id.toUpperCase(),
    recipient: invitation.email,
    channel: invitation.channel,
    role: invitation.role,
    organizationId: invitation.organizationId,
    organizationName: organization?.name || null,
    status: invitation.status,
    invitedAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    lastSentAt: invitation.lastSentAt.toISOString(),
  };
}

async function getManagedInvitation(
  id: string,
  user: { role: any; organizationId: string | null },
) {
  const invitation = await db.query.invitations.findFirst({ where: eq(invitations.id, id) });
  if (!invitation) throw Errors.notFound('Invitation not found');
  if (!isPlatformOwnerRole(user.role) && invitation.organizationId !== user.organizationId) {
    throw Errors.forbidden('You do not have access to this invitation');
  }
  return invitation;
}

export async function invitationRoutes(app: FastifyInstance) {
  app.get(
    '/api/invitations',
    { preHandler: [requireRole('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN')] },
    async (request, reply) => {
      const query = request.query as any;
      const page = Math.max(1, parseInt(query.page || '1', 10));
      const pageSize = Math.max(1, Math.min(100, parseInt(query.pageSize || '20', 10)));
      let organizationId = query.organizationId?.trim();
      if (!isPlatformOwnerRole(request.user!.role)) {
        organizationId = request.user!.organizationId || undefined;
        if (!organizationId) {
          return reply.send({ items: [], total: 0, page, pageSize, totalPages: 0 });
        }
      }

      const conditions: any[] = [];
      if (organizationId && organizationId !== 'ALL') {
        conditions.push(eq(invitations.organizationId, organizationId));
      }
      if (query.status && query.status !== 'ALL')
        conditions.push(eq(invitations.status, query.status));
      if (query.role && query.role !== 'ALL') conditions.push(eq(invitations.role, query.role));
      if (query.search)
        conditions.push(ilike(invitations.email, `%${String(query.search).trim()}%`));
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [list, count] = await Promise.all([
        db.query.invitations.findMany({
          where: whereClause,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          orderBy: desc(invitations.createdAt),
        }),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(invitations)
          .where(whereClause),
      ]);
      const total = count[0]?.count || 0;
      const items = await Promise.all(list.map((invitation) => toInvitationDto(invitation)));
      return reply.send({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    },
  );

  app.post(
    '/api/invitations',
    { preHandler: [requireRole('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN')] },
    async (request, reply) => {
      const body = request.body as any;
      const recipient = body.email ?? body.recipient;
      if (!recipient) throw Errors.badRequest('Recipient is required');
      const isPlatformOwner = isPlatformOwnerRole(request.user!.role);
      let organizationId = body.organizationId;
      if (!isPlatformOwner) organizationId = request.user!.organizationId;
      if (!organizationId) throw Errors.badRequest('organizationId is required');
      if (!['EMAIL', 'USERNAME', undefined].includes(body.channel)) {
        throw Errors.badRequest('Unsupported invitation channel');
      }
      const requestedRole = String(body.role || 'STUDENT').trim();
      const allowedInviteRoles = isPlatformOwner
        ? ['ORGANIZATION_ADMIN', 'TEACHER', 'STUDENT']
        : ['TEACHER', 'STUDENT'];
      if (!allowedInviteRoles.includes(requestedRole)) {
        throw Errors.forbidden(
          `Role '${requestedRole}' cannot be invited by ${request.user!.role}`,
        );
      }

      const organization = await db.query.organizations.findFirst({
        where: eq(organizations.id, organizationId),
      });
      if (!organization) throw Errors.notFound('Organization not found');

      const rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const [created] = await db
        .insert(invitations)
        .values({
          id: `inv-${uuidv4().slice(0, 8)}`,
          organizationId,
          email: String(recipient).trim(),
          channel: body.channel === 'USERNAME' ? 'USERNAME' : 'EMAIL',
          role: body.role || 'STUDENT',
          status: 'PENDING',
          tokenHash,
          invitedBy: request.user!.userId,
          expiresAt,
          lastSentAt: new Date(),
        })
        .returning();
      const delivered = await withRequestTx((tx) =>
        sendInvitationEmail(tx, created.email, organization.name, created.role, rawToken),
      );
      return reply.status(201).send({ ...(await toInvitationDto(created)), emailDelivered: delivered });
    },
  );

  app.post(
    '/api/invitations/:id/resend',
    { preHandler: [requireRole('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await getManagedInvitation(id, request.user!);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const [updated] = await db
        .update(invitations)
        .set({
          status: 'PENDING',
          expiresAt,
          lastSentAt: new Date(),
          tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        })
        .where(eq(invitations.id, id))
        .returning();
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, existing.organizationId),
      });
      const delivered = await withRequestTx((tx) =>
        sendInvitationEmail(tx, updated.email, org?.name ?? 'your institution', updated.role, rawToken),
      );
      return reply.send({ ...(await toInvitationDto(updated)), emailDelivered: delivered });
    },
  );

  app.patch(
    '/api/invitations/:id/revoke',
    { preHandler: [requireRole('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await getManagedInvitation(id, request.user!);
      const [updated] = await db
        .update(invitations)
        .set({ status: 'REVOKED' })
        .where(eq(invitations.id, id))
        .returning();
      return reply.send(await toInvitationDto(updated));
    },
  );

  // POST /api/invitations/accept — public; the token proves possession of the invited e-mail.
  app.post(
    '/api/invitations/accept',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = z
        .object({
          token: z.string().min(20).max(200),
          firstName: z.string().min(1).max(80),
          lastName: z.string().min(1).max(80),
          password: z.string().min(10).max(200).optional(),
        })
        .safeParse(request.body);
      if (!body.success) throw Errors.badRequest('Invalid invitation acceptance', body.error.issues);
      const tokenHash = crypto.createHash('sha256').update(body.data.token).digest('hex');
      const result = await withScopedTx({ systemContext: 'AUTH' }, async (tx) => {
        const inv = await tx.query<{ id: string; organization_id: string; email: string; role: string; status: string; expires_at: Date }>(
          `SELECT id, organization_id, email, role, status, expires_at FROM invitations WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        );
        const invitation = inv.rows[0];
        if (!invitation || invitation.status !== 'PENDING' || new Date(invitation.expires_at) < new Date()) {
          throw Errors.badRequest('This invitation is invalid, already used or expired');
        }
        if (invitation.role !== 'STUDENT' && !body.data.password) {
          throw Errors.badRequest('Staff accounts must set a password of at least 10 characters');
        }
        const existing = await tx.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [invitation.email]);
        if (existing.rowCount) throw Errors.conflict('An account with this e-mail already exists');
        const userId = crypto.randomUUID();
        await tx.query(
          `INSERT INTO users (id, organization_id, first_name, last_name, email, role, status) VALUES ($1,$2,$3,$4,lower($5),$6,'ACTIVE')`,
          [userId, invitation.organization_id, body.data.firstName.trim(), body.data.lastName.trim(), invitation.email, invitation.role],
        );
        if (body.data.password) {
          await tx.query(`INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)`, [userId, await hashPassword(body.data.password)]);
        }
        await tx.query(`UPDATE invitations SET status = 'ACCEPTED' WHERE id = $1`, [invitation.id]);
        return { userId, email: invitation.email, role: invitation.role, organizationId: invitation.organization_id };
      });
      return reply.status(201).send(result);
    },
  );
}
