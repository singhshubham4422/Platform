// Supabase client for offline-first mode. The session is kept in the OS keychain through the
// existing store_auth_session / load_auth_session / delete_auth_session commands, never in
// localStorage inside Tauri. Outside Tauri (tests, browser preview) an in-memory store is used.
import { createClient, type SupportedStorage, type SupabaseClient } from '@supabase/supabase-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { offlineConfig } from './offline-config';

type Bag = Record<string, string>;

/** supabase-js storage adapter: all keys live in one keychain entry as a small JSON object. */
export function createKeychainStorage(backend?: {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  clear: () => Promise<void>;
}): SupportedStorage {
  const io =
    backend ??
    (isTauri()
      ? {
          load: () => invoke<string | null>('load_auth_session'),
          save: (value: string) => invoke<void>('store_auth_session', { session: value }),
          clear: () => invoke<void>('delete_auth_session'),
        }
      : (() => {
          let mem: string | null = null;
          return {
            load: async () => mem,
            save: async (v: string) => void (mem = v),
            clear: async () => void (mem = null),
          };
        })());
  let cache: Bag | null = null;
  const read = async (): Promise<Bag> => {
    if (cache) return cache;
    try {
      const raw = await io.load();
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Bag) : {};
    } catch {
      cache = {}; // an old-format or unreadable entry is treated as signed out
    }
    return cache;
  };
  const write = async (bag: Bag) => {
    cache = bag;
    if (Object.keys(bag).length === 0) await io.clear();
    else await io.save(JSON.stringify(bag));
  };
  return {
    getItem: async (key) => (await read())[key] ?? null,
    setItem: async (key, value) => write({ ...(await read()), [key]: value }),
    removeItem: async (key) => {
      const { [key]: _removed, ...rest } = await read();
      await write(rest);
    },
  };
}

let client: SupabaseClient | null = null;

/** Lazily created; never constructed when offline-first mode is off. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const cfg = offlineConfig();
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { storage: createKeychainStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

/** For tests only. */
export function setSupabaseForTests(c: SupabaseClient | null): void {
  client = c;
}

export interface StudentProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'PLATFORM_OWNER';
  organizationId: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

export async function loadProfile(sb: SupabaseClient = getSupabase()): Promise<StudentProfile | null> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('id,email,full_name,role,organization_id,status')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    organizationId: data.organization_id,
    status: data.status,
  };
}
