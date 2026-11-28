// Student e-mail OTP sign-in and device-session management.
//
// Students sign in with an e-mailed one-time code. A code is only issued for an ACTIVE student in an
// ACTIVE organization with at least one ACTIVE section enrollment (approved college membership).
// Responses never reveal whether an e-mail address exists. Codes are stored as salted hashes,
// expire after 10 minutes, allow 5 attempts, and are never logged.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { getJwtSecret } from '../../lib/env.js';
import { authenticate } from '../../middleware/auth.js';
import { withScopedTx, withRequestTx } from '../../lib/scoped-sql.js';
import { issueSession, refreshLifetimeDays, setAuthCookies } from '../../lib/session.js';
import { sendEmail, emailProvider } from '../notifications/email.js';
import type { UserRole } from '../../lib/auth.js';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 5;

function hashCode(challengeId: string, code: string): string {
  return createHmac('sha256', Buffer.from(getJwtSecret())).update(`${challengeId}:${code}`).digest('hex');
}

const requestSchema = z.object({ email: z.string().email().max(254) });
const verifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  clientType: z.enum(['WEB', 'DESKTOP']).default('DESKTOP'),
  deviceName: z.string().max(100).nullish(),
});

export async function otpRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/otp/request',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) throw Errors.badRequest('A valid e-mail address is required');
      const email = parsed.data.email.toLowerCase();
      if (emailProvider() === 'none') {
        throw Errors.serviceUnavailable('E-mail delivery is not configured (EMAIL_PROVIDER). Contact your administrator.');
      }
      await withScopedTx({ systemContext: 'AUTH' }, async (tx) => {
        const u = await tx.query<{ id: string; first_name: string }>(
          `SELECT u.id, u.first_name FROM users u JOIN organizations o ON o.id = u.organization_id
           WHERE lower(u.email) = $1 AND u.role = 'STUDENT' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
             AND auth_student_has_active_enrollment(u.id)`,
          [email],
        );
        const user = u.rows[0];
        if (!user) return; // no enumeration: same response either way
        const recent = await tx.query<{ n: string }>(
          `SELECT COUNT(*) n FROM email_otp_challenges WHERE lower(email) = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
          [email],
        );
        if (Number(recent.rows[0].n) >= MAX_REQUESTS_PER_HOUR) return;
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const id = crypto.randomUUID();
        await tx.query(
          `INSERT INTO email_otp_challenges (id, email, user_id, purpose, code_hash, expires_at)
           VALUES ($1, $2, $3, 'LOGIN', $4, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes')`,
          [id, email, user.id, hashCode(id, code)],
        );
        await sendEmail(tx, {
          to: email,
          subject: 'Your PLATFORM sign-in code',
          template: 'otp-login',
          text: `Hello ${user.first_name},\n\nYour sign-in code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\nIf you did not request it, ignore this e-mail.\n`,
        });
      });
      return reply.send({ sent: true, message: 'If this e-mail belongs to an enrolled student, a sign-in code has been sent.', expiresInMinutes: OTP_TTL_MINUTES });
    },
  );

  app.post(
    '/api/auth/otp/verify',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const parsed = verifySchema.safeParse(request.body);
      if (!parsed.success) throw Errors.badRequest('E-mail and 6-digit code are required');
      const { code, clientType, deviceName } = parsed.data;
      const email = parsed.data.email.toLowerCase();

      const result = await withScopedTx({ systemContext: 'AUTH' }, async (tx) => {
        const c = await tx.query<{ id: string; user_id: string; code_hash: string; attempts: number }>(
          `SELECT id, user_id, code_hash, attempts FROM email_otp_challenges
           WHERE lower(email) = $1 AND consumed_at IS NULL AND expires_at > NOW()
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [email],
        );
        const challenge = c.rows[0];
        if (!challenge || challenge.attempts >= MAX_ATTEMPTS) return { ok: false as const };
        const expected = Buffer.from(challenge.code_hash, 'hex');
        const actual = Buffer.from(hashCode(challenge.id, code), 'hex');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          await tx.query(`UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
          return { ok: false as const };
        }
        await tx.query(`UPDATE email_otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challenge.id]);
        const u = await tx.query<{ id: string; email: string; first_name: string; last_name: string; role: string; organization_id: string | null; avatar_url: string | null; status: string }>(
          `SELECT id, email, first_name, last_name, role, organization_id, avatar_url, status FROM users WHERE id = $1`,
          [challenge.user_id],
        );
        const user = u.rows[0];
        if (!user || user.status !== 'ACTIVE') return { ok: false as const };
        const payload = { userId: user.id, email: user.email, role: user.role as UserRole, organizationId: user.organization_id, name: `${user.first_name} ${user.last_name}` };
        const session = await issueSession(tx, payload, request, { clientType, deviceName });
        await tx.query(
          `INSERT INTO audit_logs (id, organization_id, user_id, user_email, action, entity_type, entity_id, details, ip_address)
           VALUES (gen_random_uuid()::text, $1, $2, $3, 'LOGIN_OTP', 'user', $2, $4, $5)`,
          [user.organization_id, user.id, user.email, JSON.stringify({ clientType }), request.ip ?? null],
        );
        return { ok: true as const, user, session };
      });

      if (!result.ok) throw Errors.unauthorized('The code is invalid or has expired');
      setAuthCookies(reply, result.session.accessToken, result.session.refreshToken, refreshLifetimeDays(clientType));
      const u = result.user;
      return reply.send({
        user: { id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, name: `${u.first_name} ${u.last_name}`, role: u.role, organizationId: u.organization_id, avatarUrl: u.avatar_url },
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        sessionId: result.session.sessionId,
      });
    },
  );

  // Device sessions
  app.get('/api/auth/sessions', { preHandler: [authenticate] }, async (request) =>
    withRequestTx(async (tx) => {
      const r = await tx.query(
        `SELECT id, client_type, device_name, user_agent, ip_address, created_at, last_used_at, expires_at
         FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
        [request.user!.userId],
      );
      return { sessions: r.rows };
    }),
  );

  app.delete('/api/auth/sessions/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return withRequestTx(async (tx) => {
      const r = await tx.query(`UPDATE refresh_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, request.user!.userId]);
      if (r.rowCount === 0) throw Errors.notFound('Session not found');
      return { revoked: true };
    });
  });

  // Development-only: read the latest message for an address from the dev outbox (used by E2E tests).
  if (process.env.NODE_ENV !== 'production' && process.env.EMAIL_PROVIDER === 'dev-outbox') {
    app.get('/api/dev/outbox', async (request) => {
      const { to } = request.query as { to?: string };
      if (!to) throw Errors.badRequest('to is required');
      return withScopedTx({ systemContext: 'SYSTEM' }, async (tx) => {
        const r = await tx.query(`SELECT subject, body, template, created_at FROM email_outbox WHERE lower(to_email) = lower($1) ORDER BY created_at DESC LIMIT 5`, [to]);
        return { messages: r.rows, warning: 'Development outbox. Disabled in production.' };
      });
    });
  }
}
