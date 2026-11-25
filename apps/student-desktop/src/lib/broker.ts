// Calls to the Supabase Edge Function broker (C8) with the signed-in user's JWT.
import type { SupabaseClient } from '@supabase/supabase-js';
import { offlineConfig } from './offline-config';
import { getSupabase } from './supabase-client';

export class BrokerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export async function callBroker<T>(
  name: string,
  body: unknown,
  deps: { sb?: SupabaseClient; functionsUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const sb = deps.sb ?? getSupabase();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new BrokerError(401, 'NOT_SIGNED_IN', 'Sign in to continue');
  const url = `${deps.functionsUrl ?? offlineConfig().functionsUrl}/${name}`;
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new BrokerError(0, 'NETWORK', e instanceof Error ? e.message : 'network error');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new BrokerError(res.status, json.error ?? `HTTP_${res.status}`, json.message ?? res.statusText);
  return json as T;
}
