import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const submitCode = vi.fn(async (_body: unknown) => ({ id: 's', jobId: 'j', status: 'EVALUATING' }));
const postEvents = vi.fn(async (_b: unknown[]) => ({ accepted: 1 }));
vi.mock('../src/lib/coding-api', () => ({
  postEvents: (b: unknown[]) => postEvents(b),
  postSnapshots: vi.fn(async () => ({ accepted: 1 })),
  pushDraft: vi.fn(async () => ({ applied: true, stale: false })),
  submitCode: (b: unknown) => submitCode(b),
}));

async function fresh() {
  vi.resetModules();
  const outbox = await import('../src/lib/outbox');
  await outbox.initOutbox();
  return outbox;
}

beforeEach(() => {
  store.clear();
  submitCode.mockClear();
  postEvents.mockClear();
});

describe('workspace outbox (browser fallback store; SQLite semantics are covered by Rust tests)', () => {
  it('keeps one draft per question, assignment and language and survives a restart', async () => {
    let outbox = await fresh();
    outbox.saveLocalDraft({ questionId: 'q', assignmentId: 'a', language: 'PYTHON', content: 'v1' });
    outbox.saveLocalDraft({ questionId: 'q', assignmentId: 'a', language: 'PYTHON', content: 'v2' });
    outbox.saveLocalDraft({ questionId: 'q', assignmentId: 'a', language: 'JAVA', content: 'java' });
    await outbox.flushLocalWrites();
    outbox = await fresh(); // simulated app restart
    expect(outbox.getLocalDraft('q', 'a', 'PYTHON')?.content).toBe('v2');
    expect(outbox.getLocalDraft('q', 'a', 'JAVA')?.content).toBe('java');
    expect(outbox.getLocalDraft('q', null, 'PYTHON')).toBeNull();
  });

  it('queues offline work, persists it across restart and flushes it exactly once', async () => {
    let outbox = await fresh();
    const sub = outbox.queueSubmission({ questionId: 'q', assignmentId: 'a', language: 'CPP', code: 'int main(){}' });
    outbox.recordEvent('question_opened', { questionId: 'q' });
    outbox.recordSnapshot({ questionId: 'q', language: 'CPP', kind: 'CHECKPOINT', content: 'x', metadata: {} });
    outbox.saveLocalDraft({ questionId: 'q', assignmentId: 'a', language: 'CPP', content: 'x' });
    await outbox.flushLocalWrites();
    outbox = await fresh();
    expect(outbox.outboxCounts()).toMatchObject({ events: 1, snapshots: 1, submissions: 1, unsyncedDrafts: 1 });

    await outbox.flushOutbox();
    await outbox.flushOutbox(); // retry must not resend acknowledged work
    expect(submitCode).toHaveBeenCalledTimes(1);
    expect(submitCode).toHaveBeenCalledWith(expect.objectContaining({ clientOperationId: sub.clientOperationId }));
    expect(outbox.outboxCounts()).toMatchObject({ events: 0, snapshots: 0, submissions: 0, unsyncedDrafts: 0 });
  });

  it('keeps items after a network failure and backs off instead of dropping them', async () => {
    const outbox = await fresh();
    submitCode.mockRejectedValueOnce(new Error('network down'));
    outbox.queueSubmission({ questionId: 'q', assignmentId: 'a', language: 'C', code: 'x' });
    await outbox.flushLocalWrites();
    await outbox.flushOutbox();
    expect(outbox.outboxCounts().submissions).toBe(1);
    await outbox.flushOutbox(); // still in backoff window
    expect(submitCode).toHaveBeenCalledTimes(1);
  });

  it('parks permanently rejected items and pauses on expired sessions', async () => {
    const outbox = await fresh();
    const { ApiRequestError } = await import('../src/lib/api');
    postEvents.mockRejectedValueOnce(new ApiRequestError('Validation failed', 400));
    outbox.recordEvent('code_changed', { questionId: 'q' });
    await outbox.flushLocalWrites();
    await outbox.flushOutbox();
    expect(outbox.outboxCounts()).toMatchObject({ events: 0, failed: 1 });

    submitCode.mockRejectedValueOnce(new ApiRequestError('expired', 401));
    outbox.queueSubmission({ questionId: 'q', assignmentId: 'a', language: 'C', code: 'x' });
    await outbox.flushLocalWrites();
    await outbox.flushOutbox();
    expect(outbox.outboxCounts().submissions).toBe(1);
  });

  it('skips duplicate edit snapshots with identical content', async () => {
    const outbox = await fresh();
    outbox.recordSnapshot({ questionId: 'q2', language: 'C', kind: 'EDIT', content: 'same', metadata: {} });
    outbox.recordSnapshot({ questionId: 'q2', language: 'C', kind: 'EDIT', content: 'same', metadata: {} });
    await outbox.flushLocalWrites();
    expect(outbox.outboxCounts().snapshots).toBe(1);
  });
});
