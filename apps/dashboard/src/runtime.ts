import { createClient } from '@supabase/supabase-js';
import { SupabaseDataSource } from './data/supabase-source';
import { SupabaseAuthService } from './auth/supabase-auth';
import type { DataSource } from './data/source';
import type { AuthService } from './auth/types';

export interface DashboardEnv {
  MODE?: string;
  PROD?: boolean;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_FUNCTIONS_URL?: string;
  VITE_DATA_SOURCE?: string;
}

export type Runtime =
  | { ok: true; mode: 'live' | 'mock'; source: DataSource; auth: AuthService }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'MOCK_OUTSIDE_TEST' };

/**
 * The only application module allowed to import the test-only mock runtime.
 * The branch is statically dead in a production build, so the mock chunk is
 * not emitted there.
 */
export async function createRuntime(env: DashboardEnv = import.meta.env): Promise<Runtime> {
  if (env.VITE_DATA_SOURCE === 'mock') {
    // A literal compile-time comparison, so a production bundle drops this branch
    // (and the mock chunk) entirely.
    if (import.meta.env.MODE !== 'test') return { ok: false, reason: 'MOCK_OUTSIDE_TEST' };
    const mock = await import('./test/mock-runtime');
    return mock.createMockRuntime();
  }
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, reason: 'NOT_CONFIGURED' };
  const functionsUrl = env.VITE_FUNCTIONS_URL || `${url.replace(/\/$/, '')}/functions/v1`;
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return {
    ok: true,
    mode: 'live',
    source: new SupabaseDataSource(sb, functionsUrl),
    auth: new SupabaseAuthService(sb),
  };
}
