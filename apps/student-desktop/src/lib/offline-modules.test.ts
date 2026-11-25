import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tauri: false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => mocks.invoke(...a), isTauri: () => mocks.tauri }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  mocks.tauri = false;
});

describe('keychain session storage', () => {
  it('round-trips keys in one entry and clears the entry when empty', async () => {
    const { createKeychainStorage } = await import('./supabase-client');
    let saved: string | null = null;
    const backend = { load: async () => saved, save: vi.fn(async (v: string) => void (saved = v)), clear: vi.fn(async () => void (saved = null)) };
    const s = createKeychainStorage(backend);
    await s.setItem('sb-x-auth-token', '{"a":1}');
    await s.setItem('other', 'v');
    expect(JSON.parse(saved!)).toEqual({ 'sb-x-auth-token': '{"a":1}', other: 'v' });
    expect(await s.getItem('sb-x-auth-token')).toBe('{"a":1}');
    await s.removeItem('other');
    await s.removeItem('sb-x-auth-token');
    expect(backend.clear).toHaveBeenCalled();
    expect(saved).toBeNull();
  });

  it('treats an unreadable entry as signed out', async () => {
    const { createKeychainStorage } = await import('./supabase-client');
    const s = createKeychainStorage({ load: async () => 'not json', save: async () => undefined, clear: async () => undefined });
    expect(await s.getItem('k')).toBeNull();
  });

  it('uses the keychain commands inside Tauri, never localStorage', async () => {
    mocks.tauri = true;
    mocks.invoke.mockResolvedValue(null);
    const { createKeychainStorage } = await import('./supabase-client');
    const s = createKeychainStorage();
    await s.setItem('k', 'v');
    expect(mocks.invoke).toHaveBeenCalledWith('load_auth_session');
    expect(mocks.invoke).toHaveBeenCalledWith('store_auth_session', { session: '{"k":"v"}' });
  });
});

describe('activity queue', () => {
  it('drops events when signed out and attributes them when signed in', async () => {
    const q = await import('./activity-queue');
    const sink = vi.fn(async () => 1);
    q.setActivitySinkForTests(sink);
    q.setActivityIdentity(null);
    q.queueActivity('question_opened', { questionId: 'q' }, { language: 'JAVA' });
    await q.flushActivity();
    expect(sink).not.toHaveBeenCalled();
    q.setActivityIdentity({ userId: 'u1', organizationId: 'o1' });
    q.queueActivity('question_opened', { questionId: 'q', packId: 'p@1', language: 'JAVA' }, { language: 'JAVA' });
    await q.flushActivity();
    const [[events]] = sink.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(events[0]).toMatchObject({ eventType: 'question_opened', userId: 'u1', organizationId: 'o1', packId: 'p@1', questionId: 'q', language: 'JAVA', schemaVersion: 2, metadata: { language: 'JAVA' } });
    expect(events[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('flushes at 50 events and re-queues on failure', async () => {
    const q = await import('./activity-queue');
    let fail = true;
    const sink = vi.fn(async () => {
      if (fail) throw new Error('db busy');
      return 1;
    });
    q.setActivitySinkForTests(sink);
    q.setActivityIdentity({ userId: 'u', organizationId: null });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < 50; i++) q.queueActivity('code_changed', {}, { insertedChars: 1, deletedChars: 0, burstMs: 10 });
    await Promise.resolve();
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(1);
    fail = false;
    await q.flushActivity();
    expect((sink.mock.calls[1] as unknown as [unknown[]])[0]).toHaveLength(50);
  });
});

describe('legacy flag-off behaviour', () => {
  it('refuses to build a Supabase client without configuration', async () => {
    const { offlineConfig } = await import('./offline-config');
    expect(() => offlineConfig({})).toThrow('OFFLINE_NOT_CONFIGURED');
    expect(offlineConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_ANON_KEY: 'anon' }).functionsUrl).toBe('https://x.supabase.co/functions/v1');
  });
});

describe('catalog', () => {
  it('marks installed, update available and not installed, ignoring unpublished courses', async () => {
    const { buildCatalog } = await import('./catalog');
    const course = (id: string, status = 'PUBLISHED') => ({ id, title: id.toUpperCase(), languages: ['JAVA'], status });
    const rows = [
      { pack_id: 'a@1', course_id: 'a', version: 1, size: 10, sha256: 'h', courses: course('a') },
      { pack_id: 'a@2', course_id: 'a', version: 2, size: 10, sha256: 'h', courses: course('a') },
      { pack_id: 'b@1', course_id: 'b', version: 1, size: 10, sha256: 'h', courses: course('b') },
      { pack_id: 'c@1', course_id: 'c', version: 1, size: 10, sha256: 'h', courses: course('c') },
      { pack_id: 'd@1', course_id: 'd', version: 1, size: 10, sha256: 'h', courses: course('d', 'ARCHIVED') },
    ];
    const installed = [
      { packId: 'a@1', kind: 'COURSE' as const, courseId: 'a', assessmentId: null, version: 1, title: 'A', languages: [], questionCount: 1, installedAt: '' },
      { packId: 'b@1', kind: 'COURSE' as const, courseId: 'b', assessmentId: null, version: 1, title: 'B', languages: [], questionCount: 1, installedAt: '' },
    ];
    expect(buildCatalog(rows, installed).map((c) => [c.courseId, c.packId, c.state])).toEqual([
      ['a', 'a@2', 'UPDATE_AVAILABLE'],
      ['b', 'b@1', 'INSTALLED'],
      ['c', 'c@1', 'NOT_INSTALLED'],
    ]);
  });
});
