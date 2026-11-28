// Raw-SQL helper for workers and services that need several statements in one transaction
// under a specific RLS context (always via the restricted platform_app role when present).
import type pg from 'pg';
import { pool, isRestrictedRoleAvailable } from '../db/connection.js';
import { applySessionRlsVars, getCurrentRlsContext, type RlsContext } from '../db/rls-context.js';

export type Tx = pg.PoolClient;

export async function withScopedTx<T>(ctx: RlsContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const useRole = await isRestrictedRoleAvailable();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applySessionRlsVars(client, ctx, useRole);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Run with the current request's RLS context (the authenticated user). */
export function withRequestTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = getCurrentRlsContext() ?? {};
  return withScopedTx(
    {
      userId: ctx.userId ?? null,
      role: ctx.role ?? null,
      organizationId: ctx.organizationId ?? null,
      systemContext: ctx.systemContext ?? null,
    },
    fn,
  );
}

export const JUDGE_CTX: RlsContext = { systemContext: 'JUDGE' };
export const SYSTEM_CTX: RlsContext = { systemContext: 'SYSTEM' };

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function addUsage(tx: Tx, organizationId: string | null, metric: string, quantity: number): Promise<void> {
  if (!organizationId || quantity === 0) return;
  await tx.query(
    `INSERT INTO usage_records (organization_id, metric, period, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, metric, period)
     DO UPDATE SET quantity = usage_records.quantity + EXCLUDED.quantity, updated_at = NOW()`,
    [organizationId, metric, currentPeriod(), quantity],
  );
}

export async function notify(
  tx: Tx,
  n: { organizationId: string | null; userId: string; type: string; title: string; body?: string; link?: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (organization_id, user_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5,$6)`,
    [n.organizationId, n.userId, n.type, n.title, n.body ?? '', n.link ?? null],
  );
}
