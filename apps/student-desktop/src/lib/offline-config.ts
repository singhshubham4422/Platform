// Offline-first mode switch and its configuration (phase 05).
// With VITE_OFFLINE_FIRST unset the app behaves exactly as before (legacy API login and sync).

export const OFFLINE_FIRST = import.meta.env.VITE_OFFLINE_FIRST === '1';

export interface OfflineConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  functionsUrl: string;
}

/** Throws OFFLINE_NOT_CONFIGURED when the Supabase settings are missing; never falls back to a built-in project. */
export function offlineConfig(env: Record<string, string | undefined> = import.meta.env): OfflineConfig {
  const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/+$/, '') ?? '';
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('OFFLINE_NOT_CONFIGURED: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  const functionsUrl = (env.VITE_FUNCTIONS_URL || `${supabaseUrl}/functions/v1`).replace(/\/+$/, '');
  return { supabaseUrl, supabaseAnonKey, functionsUrl };
}
