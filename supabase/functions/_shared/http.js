import { HttpError, badRequest, forbidden, notFound, tooLarge } from './errors.js';

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
export function createEdgeHandler({ run, env, createClient, allowedOrigins = [] }) {
  return async (request) => {
    const origin = request.headers.get('origin');
    const allowed = new Set([...allowedOrigins, 'tauri://localhost', 'http://tauri.localhost', ...(env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean)]);
    if (origin && !allowed.has(origin)) return json(403, { error: 'ORIGIN_DENIED' });
    const cors = origin ? { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' }, cors);
    try {
      const len = Number(request.headers.get('content-length') || 0);
      if (len > 65536) throw tooLarge();
      const raw = await request.arrayBuffer();
      if (raw.byteLength > 65536) throw tooLarge();
      let body;
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { throw badRequest('Expected a JSON request body'); }
      const data = await run({ request, body, env, createClient });
      return json(200, data, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json(status, { error: e instanceof HttpError ? e.code : 'INTERNAL_ERROR', message: status === 500 ? 'Request failed' : e.message }, cors);
    }
  };
}
export function uuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
export function requireUuid(v, name) { if (!uuid(v)) throw badRequest(`Invalid ${name}`); return v; }
export function requireHash(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/i.test(v)) throw badRequest('Invalid SHA-256'); return v.toLowerCase(); }
export async function authenticated({ request, env, createClient }) {
  const { createSupabaseClients } = await import('./auth.js');
  return createSupabaseClients({ authorization: request.headers.get('authorization'), env, createClient });
}
export function envOrThrow(env, key) { const v=env.get(key); if (!v) throw new Error(`${key}_MISSING`); return v; }
