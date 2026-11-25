import { describe, expect, it, vi } from 'vitest';
import { OfflineSync, toSubmissionRow, type SyncDeps } from './offline-sync';
import type { AttemptRow } from './offline-store';

const attempt = (id: string, extra: Partial<AttemptRow> = {}): AttemptRow => ({
  attemptId: id,
  packId: 'c0000000-0000-4000-8000-000000000001@2',
  questionId: 'q1',
  assessmentId: null,
  language: 'JAVA',
  mode: 'SUBMIT',
  source: 'class Main{}',
  sourceSha256: 'a'.repeat(64),
  verdict: 'ACCEPTED',
  passed: 2,
  total: 2,
  totalTimeMs: 12,
  results: [],
  startedAt: '2026-11-25T10:00:00.000Z',
  finishedAt: '2026-11-25T10:00:01.000Z',
  monotonicSeq: 5,
  signature: 'sig',
  deviceId: 'd1',
  syncedAt: null,
  syncError: null,
  ...extra,
});

function setup(over: { due?: AttemptRow[]; session?: boolean; upsert?: (rows: unknown[]) => { error: null | { message: string; code?: string }; status: number } } = {}) {
  const calls: string[] = [];
  let due = [...(over.due ?? [])];
  let batches = [{ batchId: 'b1', gzBase64: btoa('gz'), sha256: 'f'.repeat(64), sizeBytes: 2, eventCount: 3 }];
  const cursors = new Map<string, string>();
  const upsert = vi.fn(async (rows: unknown[]) => {
    calls.push('upsert');
    return { data: null, ...(over.upsert ? over.upsert(rows) : { error: null, status: 201 }) };
  });
  const deps: SyncDeps = {
    sb: {
      auth: { getSession: async () => ({ data: { session: over.session === false ? null : { access_token: 't' } } }) },
      from: (table: string) => ({
        upsert,
        select: () => ({
          eq: async () => {
            calls.push(`select:${table}`);
            return { data: [{ submission_id: 's1', body: 'Nice', score_override: null, created_at: 'x', submissions: { question_id: 'q1', pack_id: 'p@1' } }], error: null, status: 200 };
          },
        }),
      }),
    },
    broker: vi.fn(async (name: string, body: unknown) => {
      calls.push(`broker:${name}`);
      if (name === 'activity-upload-url') return { uploadUrl: 'https://put.example/obj', objectPath: 'raw/x', expiresAt: 'x' };
      if (name === 'submit-assessment-attempts') {
        const ids = (body as { attempts: { attemptId: string }[] }).attempts.map((a) => a.attemptId);
        return { accepted: ids.slice(0, 1), duplicates: [], rejected: ids.slice(1).map((id) => ({ id, error: 'ATTEMPTS_EXCEEDED' })) };
      }
      return { ok: true };
    }) as SyncDeps['broker'],
    fetchImpl: vi.fn(async () => {
      calls.push('put');
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch,
    isOnline: () => true,
    store: {
      attemptsDue: async () => due.filter((a) => !a.syncedAt && !a.syncError),
      attemptsAck: vi.fn(async (ids: string[]) => {
        calls.push(`ack:${ids.join(',')}`);
        due = due.map((a) => (ids.includes(a.attemptId) ? { ...a, syncedAt: 'now' } : a));
        return ids.length;
      }),
      attemptsPark: vi.fn(async (id: string, error: string) => {
        calls.push(`park:${id}:${error}`);
        due = due.map((a) => (a.attemptId === id ? { ...a, syncError: error } : a));
        return 1;
      }),
      attemptsListParked: async () => due.filter((a) => a.syncError),
      activitySealBatch: async () => batches[0] ?? null,
      activityAckBatch: vi.fn(async (id: string) => {
        calls.push(`ackBatch:${id}`);
        batches = batches.filter((b) => b.batchId !== id);
      }),
      activityCounts: async () => ({ pendingEvents: 0, pendingBatches: batches.length }),
      deviceInfo: async () => ({ deviceId: 'd1', publicKey: 'pk', monotonicSeq: 9 }),
      getCursor: async (s: string) => cursors.get(s) ?? null,
      setCursor: async (s: string, v: string) => void cursors.set(s, v),
    },
    packs: {
      list: async () => [],
      catalog: async () => [
        { courseId: 'c1', title: 'Small', languages: ['JAVA'], packId: 'c1@3', version: 3, size: 1000, sha256: 'x', state: 'UPDATE_AVAILABLE' as const, installedVersion: 2 },
        { courseId: 'c2', title: 'Big', languages: ['JAVA'], packId: 'c2@2', version: 2, size: 80 * 1024 * 1024, sha256: 'x', state: 'UPDATE_AVAILABLE' as const, installedVersion: 1 },
      ],
      install: vi.fn(async (packId: string) => {
        calls.push(`install:${packId}`);
        return {} as never;
      }),
    },
  };
  return { deps, calls, cursors, upsert };
}

describe('offline sync engine', () => {
  it('runs device → attempts → activity → pull in order and acks only after success', async () => {
    const { deps, calls, cursors } = setup({ due: [attempt('a1')] });
    const s = await new OfflineSync(deps).syncNow();
    expect(s.state).toBe('idle');
    expect(calls).toEqual(['broker:register-device', 'upsert', 'ack:a1', 'broker:activity-upload-url', 'put', 'ackBatch:b1', 'install:c1@3', 'select:feedback']);
    expect(s.updatesAvailable.map((u) => u.packId)).toEqual(['c2@2']);
    expect(JSON.parse(cursors.get('feedback:v1')!)).toEqual([{ submissionId: 's1', questionId: 'q1', packId: 'p@1', body: 'Nice', scoreOverride: null, createdAt: 'x' }]);
  });

  it('registers the device only once per key', async () => {
    const { deps, calls } = setup();
    const e = new OfflineSync(deps);
    await e.syncNow();
    await e.syncNow();
    expect(calls.filter((c) => c === 'broker:register-device')).toHaveLength(1);
  });

  it('pauses without a session and uploads nothing', async () => {
    const { deps, calls } = setup({ due: [attempt('a1')], session: false });
    const s = await new OfflineSync(deps).syncNow();
    expect(s.state).toBe('paused-auth');
    expect(calls).toEqual([]);
  });

  it('keeps the batch when the PUT fails and backs off', async () => {
    const { deps, calls } = setup();
    deps.fetchImpl = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const e = new OfflineSync(deps);
    const s = await e.syncNow();
    expect(s.state).toBe('backoff');
    expect(calls.some((c) => c.startsWith('ackBatch'))).toBe(false);
    expect(s.pendingBatches).toBe(1);
    e.start()(); // clear timers
  });

  it('parks a refused practice attempt without blocking the others', async () => {
    const { deps, calls } = setup({
      due: [attempt('good'), attempt('bad')],
      upsert: (rows) => ((rows as { id: string }[]).some((r) => r.id === 'bad') ? { error: { message: 'fk', code: '23503' }, status: 409 } : { error: null, status: 201 }),
    });
    const s = await new OfflineSync(deps).syncNow();
    expect(calls).toContain('ack:good');
    expect(calls).toContain('park:bad:23503');
    expect(s.parked).toEqual([{ attemptId: 'bad', error: '23503' }]);
  });

  it('treats a duplicate upsert (already on the server) as success', async () => {
    const { deps, upsert } = setup({ due: [attempt('dup')] });
    await new OfflineSync(deps).syncNow();
    expect(upsert).toHaveBeenCalledWith([expect.objectContaining({ id: 'dup' })], { onConflict: 'id', ignoreDuplicates: true });
    expect(deps.store.attemptsAck).toHaveBeenCalledWith(['dup']);
  });

  it('routes assessment attempts to the broker and parks rejected ones', async () => {
    const aid = 'e0000000-0000-4000-8000-000000000001';
    const { deps, calls, upsert } = setup({ due: [attempt('x1', { assessmentId: aid, packId: `${aid}@1` }), attempt('x2', { assessmentId: aid, packId: `${aid}@1` })] });
    await new OfflineSync(deps).syncNow();
    expect(upsert).not.toHaveBeenCalled();
    expect(calls).toContain('broker:submit-assessment-attempts');
    expect(calls).toContain('ack:x1');
    expect(calls).toContain('park:x2:ATTEMPTS_EXCEEDED');
  });

  it('does nothing but report offline when there is no network', async () => {
    const { deps, calls } = setup({ due: [attempt('a1')] });
    deps.isOnline = () => false;
    const s = await new OfflineSync(deps).syncNow();
    expect(s.state).toBe('offline');
    expect(s.pendingSubmissions).toBe(1);
    expect(calls).toEqual([]);
  });

  it('maps attempts to the frozen C9 submissions columns', () => {
    const row = toSubmissionRow(attempt('a1'), 'c0000000-0000-4000-8000-000000000001');
    expect(Object.keys(row).sort()).toEqual(
      ['assessment_id', 'course_id', 'device_id', 'finished_at', 'id', 'language', 'monotonic_seq', 'pack_id', 'passed', 'question_id', 'results_json', 'signature', 'source', 'source_sha256', 'started_at', 'total', 'total_time_ms', 'verdict'].sort(),
    );
    expect(row).not.toHaveProperty('user_id');
  });
});
