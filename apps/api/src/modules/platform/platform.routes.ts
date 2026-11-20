// Platform-owner console: plans, subscriptions, license usage and operational health.
// Owners see aggregates and organization metadata; private student work is not exposed here.
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { Errors } from '../../lib/errors.js';
import { withRequestTx, withScopedTx, JUDGE_CTX, currentPeriod } from '../../lib/scoped-sql.js';
import { pool } from '../../db/connection.js';
import { createJudgeProvider } from '../judge/judge.service.js';
import { emailProvider } from '../notifications/email.js';
import { storageStatus } from '../files/storage.js';

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

const API_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version as string;
  } catch {
    return 'unknown';
  }
})();

const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(''),
  seatLimit: z.number().int().min(1),
  storageGb: z.number().int().min(1),
  judgeExecutionsPerMonth: z.number().int().min(0),
  pricePerSeatCents: z.number().int().min(0),
  currency: z.string().length(3).default('INR'),
  modules: z.array(z.string()).default([]),
  status: z.enum(['ACTIVE', 'RETIRED']).default('ACTIVE'),
});

const subscriptionSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().min(1),
  seats: z.number().int().min(0),
  startsAt: z.string().date(),
  renewsAt: z.string().date().nullish(),
  expiresAt: z.string().date().nullish(),
  status: z.enum(['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED', 'CANCELLED']).default('ACTIVE'),
  billingEmail: z.string().email().nullish(),
  billingReference: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
});

export async function platformRoutes(app: FastifyInstance) {
  const owner = requireRole('PLATFORM_OWNER', 'PLATFORM_ADMIN');

  app.get('/api/platform/plans', { preHandler: [authenticate] }, async () =>
    withRequestTx(async (tx) => ({ items: (await tx.query(`SELECT * FROM subscription_plans ORDER BY seat_limit`)).rows.map(camel) })),
  );

  app.post('/api/platform/plans', { preHandler: [owner] }, async (request, reply) => {
    const p = planSchema.parse(request.body ?? {});
    const row = await withRequestTx(async (tx) => {
      try {
        return (
          await tx.query(
            `INSERT INTO subscription_plans (code, name, description, seat_limit, storage_gb, judge_executions_per_month, price_per_seat_cents, currency, modules, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [p.code, p.name, p.description, p.seatLimit, p.storageGb, p.judgeExecutionsPerMonth, p.pricePerSeatCents, p.currency, JSON.stringify(p.modules), p.status],
          )
        ).rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw Errors.conflict('Plan code already exists');
        throw e;
      }
    });
    return reply.status(201).send(camel(row));
  });

  app.patch('/api/platform/plans/:id', { preHandler: [owner] }, async (request) => {
    const { id } = request.params as { id: string };
    const p = planSchema.partial().parse(request.body ?? {});
    return withRequestTx(async (tx) => {
      const r = await tx.query(
        `UPDATE subscription_plans SET name = COALESCE($2,name), description = COALESCE($3,description), seat_limit = COALESCE($4,seat_limit),
           storage_gb = COALESCE($5,storage_gb), judge_executions_per_month = COALESCE($6,judge_executions_per_month),
           price_per_seat_cents = COALESCE($7,price_per_seat_cents), modules = COALESCE($8,modules), status = COALESCE($9,status), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, p.name ?? null, p.description ?? null, p.seatLimit ?? null, p.storageGb ?? null, p.judgeExecutionsPerMonth ?? null,
          p.pricePerSeatCents ?? null, p.modules ? JSON.stringify(p.modules) : null, p.status ?? null],
      );
      if (!r.rows[0]) throw Errors.notFound('Plan not found');
      return camel(r.rows[0]);
    });
  });

  app.get('/api/platform/subscriptions', { preHandler: [requireRole('PLATFORM_OWNER', 'ORGANIZATION_ADMIN')] }, async () =>
    withRequestTx(async (tx) => {
      const r = await tx.query(
        `SELECT os.*, o.name AS organization_name, sp.name AS plan_name, sp.seat_limit, sp.judge_executions_per_month,
                (SELECT COUNT(*) FROM users u WHERE u.organization_id = os.organization_id AND u.role = 'STUDENT' AND u.status = 'ACTIVE')::int AS seats_used
         FROM organization_subscriptions os JOIN organizations o ON o.id = os.organization_id JOIN subscription_plans sp ON sp.id = os.plan_id
         ORDER BY o.name, os.starts_at DESC`,
      );
      return { items: r.rows.map(camel) };
    }),
  );

  app.post('/api/platform/subscriptions', { preHandler: [owner] }, async (request, reply) => {
    const s = subscriptionSchema.parse(request.body ?? {});
    const row = await withRequestTx(async (tx) => {
      const plan = await tx.query<{ seat_limit: number }>(`SELECT seat_limit FROM subscription_plans WHERE id = $1`, [s.planId]);
      if (!plan.rows[0]) throw Errors.badRequest('Plan not found');
      if (s.seats > plan.rows[0].seat_limit) throw Errors.badRequest(`Seats exceed the plan limit (${plan.rows[0].seat_limit})`);
      if (s.status === 'ACTIVE') {
        await tx.query(`UPDATE organization_subscriptions SET status = 'CANCELLED', updated_at = NOW() WHERE organization_id = $1 AND status = 'ACTIVE'`, [s.organizationId]);
      }
      return (
        await tx.query(
          `INSERT INTO organization_subscriptions (organization_id, plan_id, seats, starts_at, renews_at, expires_at, status, billing_email, billing_reference, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [s.organizationId, s.planId, s.seats, s.startsAt, s.renewsAt ?? null, s.expiresAt ?? null, s.status, s.billingEmail ?? null, s.billingReference ?? null, s.notes ?? null],
        )
      ).rows[0];
    });
    return reply.status(201).send(camel(row));
  });

  app.patch('/api/platform/subscriptions/:id', { preHandler: [owner] }, async (request) => {
    const { id } = request.params as { id: string };
    const s = subscriptionSchema.partial().parse(request.body ?? {});
    return withRequestTx(async (tx) => {
      const r = await tx.query(
        `UPDATE organization_subscriptions SET seats = COALESCE($2,seats), renews_at = COALESCE($3,renews_at), expires_at = COALESCE($4,expires_at),
           status = COALESCE($5,status), billing_email = COALESCE($6,billing_email), notes = COALESCE($7,notes), plan_id = COALESCE($8,plan_id), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, s.seats ?? null, s.renewsAt ?? null, s.expiresAt ?? null, s.status ?? null, s.billingEmail ?? null, s.notes ?? null, s.planId ?? null],
      );
      if (!r.rows[0]) throw Errors.notFound('Subscription not found');
      return camel(r.rows[0]);
    });
  });

  app.get('/api/platform/usage', { preHandler: [requireRole('PLATFORM_OWNER', 'ORGANIZATION_ADMIN')] }, async (request) => {
    const period = (request.query as { period?: string }).period ?? currentPeriod();
    if (!/^\d{4}-\d{2}$/.test(period)) throw Errors.badRequest('period must be YYYY-MM');
    return withRequestTx(async (tx) => {
      const r = await tx.query(
        `SELECT o.id AS organization_id, o.name AS organization_name, o.status,
           (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.role = 'STUDENT' AND u.status = 'ACTIVE')::int AS active_students,
           (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.role = 'TEACHER')::int AS faculty,
           (SELECT COALESCE(SUM(size_bytes),0) FROM file_objects f WHERE f.organization_id = o.id AND f.deleted_at IS NULL)::bigint AS storage_bytes,
           (SELECT COUNT(*) FROM file_objects f WHERE f.organization_id = o.id)::int AS uploads,
           (SELECT COUNT(*) FROM refresh_sessions rs JOIN users u ON u.id = rs.user_id WHERE u.organization_id = o.id
              AND rs.client_type = 'DESKTOP' AND rs.revoked_at IS NULL AND rs.expires_at > NOW())::int AS active_devices,
           COALESCE((SELECT quantity FROM usage_records ur WHERE ur.organization_id = o.id AND metric = 'judge_executions' AND period = $1),0)::bigint AS judge_executions,
           COALESCE((SELECT quantity FROM usage_records ur WHERE ur.organization_id = o.id AND metric = 'judge_execution_ms' AND period = $1),0)::bigint AS judge_execution_ms,
           COALESCE((SELECT quantity FROM usage_records ur WHERE ur.organization_id = o.id AND metric = 'download_bytes' AND period = $1),0)::bigint AS download_bytes,
           COALESCE((SELECT quantity FROM usage_records ur WHERE ur.organization_id = o.id AND metric = 'api_requests' AND period = $1),0)::bigint AS api_requests,
           (SELECT json_build_object('plan', sp.name, 'seats', os.seats, 'judgeLimit', sp.judge_executions_per_month, 'storageGb', sp.storage_gb,
                                     'expiresAt', os.expires_at, 'renewsAt', os.renews_at)
              FROM organization_subscriptions os JOIN subscription_plans sp ON sp.id = os.plan_id
             WHERE os.organization_id = o.id AND os.status IN ('ACTIVE','TRIAL') ORDER BY os.starts_at DESC LIMIT 1) AS subscription
         FROM organizations o ORDER BY o.name`,
        [period],
      );
      return { period, items: r.rows.map((row) => ({ ...camel(row), storageBytes: Number(row.storage_bytes), judgeExecutions: Number(row.judge_executions), judgeExecutionMs: Number(row.judge_execution_ms), downloadBytes: Number(row.download_bytes), apiRequests: Number(row.api_requests) })) };
    });
  });

  app.get('/api/platform/health', { preHandler: [owner] }, async () => {
    const started = Date.now();
    let database: { ok: boolean; latencyMs?: number; error?: string };
    try {
      await pool.query('SELECT 1');
      database = { ok: true, latencyMs: Date.now() - started };
    } catch (e) {
      database = { ok: false, error: (e as Error).message };
    }
    let queue: Record<string, unknown> = {};
    try {
      queue = await withScopedTx(JUDGE_CTX, async (tx) =>
        camel(
          (
            await tx.query(
              `SELECT COUNT(*) FILTER (WHERE status='QUEUED')::int AS queued, COUNT(*) FILTER (WHERE status IN ('COMPILING','RUNNING'))::int AS running,
                      COUNT(*) FILTER (WHERE status='FAILED' AND finished_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
                      COUNT(*) FILTER (WHERE status='COMPLETED' AND finished_at > NOW() - INTERVAL '24 hours')::int AS completed_24h,
                      MAX(locked_at) AS last_claimed_at, ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - created_at)) * 1000)
                        FILTER (WHERE finished_at > NOW() - INTERVAL '24 hours'))::int AS avg_turnaround_ms
               FROM execution_jobs`,
            )
          ).rows[0],
        ),
      );
    } catch (e) {
      queue = { error: (e as Error).message };
    }
    let judge: unknown;
    try {
      const provider = createJudgeProvider();
      judge = provider ? await provider.status() : { provider: 'not-configured', available: false, detail: 'Set JUDGE_PROVIDER' };
    } catch (e) {
      judge = { available: false, detail: (e as Error).message };
    }
    return {
      version: API_VERSION,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      database,
      judge,
      queue,
      storage: storageStatus(),
      email: { provider: emailProvider() },
      checkedAt: new Date().toISOString(),
    };
  });

  // Feature flags live in platform_settings.preferences.featureFlags.
  app.get('/api/platform/feature-flags', { preHandler: [authenticate] }, async () =>
    withRequestTx(async (tx) => {
      const r = await tx.query(`SELECT preferences FROM platform_settings WHERE id = 'default'`);
      return { flags: (r.rows[0]?.preferences?.featureFlags as Record<string, boolean>) ?? {} };
    }),
  );

  app.put('/api/platform/feature-flags', { preHandler: [owner] }, async (request) => {
    const flags = z.record(z.string().regex(/^[a-zA-Z0-9_.-]{1,60}$/), z.boolean()).parse(request.body ?? {});
    return withRequestTx(async (tx) => {
      await tx.query(
        `INSERT INTO platform_settings (id, preferences) VALUES ('default', jsonb_build_object('featureFlags', $1::jsonb))
         ON CONFLICT (id) DO UPDATE SET preferences = COALESCE(platform_settings.preferences, '{}'::jsonb) || jsonb_build_object('featureFlags', $1::jsonb), updated_at = NOW()`,
        [JSON.stringify(flags)],
      );
      return { flags };
    });
  });
}
