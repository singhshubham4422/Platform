import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAccessToken, generateRefreshToken, hashRefreshToken, type TokenPayload } from './auth.js';
import type { Tx } from './scoped-sql.js';

export type ClientType = 'WEB' | 'DESKTOP';

/** Desktop sessions persist across restarts (stored in the OS keychain) but remain revocable. */
export function refreshLifetimeDays(clientType: ClientType): number {
  return clientType === 'DESKTOP' ? 30 : 7;
}

export async function issueSession(
  tx: Tx,
  payload: TokenPayload,
  request: FastifyRequest,
  opts: { clientType: ClientType; deviceName?: string | null },
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const accessToken = await createAccessToken(payload);
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + refreshLifetimeDays(opts.clientType) * 86_400_000);
  const res = await tx.query<{ id: string }>(
    `INSERT INTO refresh_sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, client_type, device_name, last_used_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
    [payload.userId, hashRefreshToken(refreshToken), request.headers['user-agent'] ?? null, request.ip ?? null, expiresAt,
      opts.clientType, opts.deviceName?.slice(0, 100) ?? null],
  );
  return { accessToken, refreshToken, sessionId: res.rows[0].id };
}

export function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string, days = 7): void {
  const secure = process.env.NODE_ENV === 'production';
  reply.setCookie('access_token', accessToken, { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: 15 * 60 });
  reply.setCookie('refresh_token', refreshToken, { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: days * 86_400 });
}
