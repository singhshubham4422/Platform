// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function load(flag: string) {
  vi.stubEnv('VITE_OFFLINE_FIRST', flag);
  const aq = await import('./activity-queue');
  const sink = vi.fn(async () => 1);
  aq.setActivitySinkForTests(sink);
  aq.setActivityIdentity({ userId: 'u', organizationId: 'o' });
  const outbox = await import('./outbox');
  return { aq, sink, outbox };
}

describe('recordEvent routing by VITE_OFFLINE_FIRST', () => {
  it('flag off: events stay on the legacy outbox and never reach the offline queue', async () => {
    const { aq, sink, outbox } = await load('');
    const before = outbox.outboxCounts().events;
    outbox.recordEvent('question_opened', { questionId: 'q' }, { language: 'JAVA' });
    await outbox.flushLocalWrites();
    await aq.flushActivity();
    expect(sink).not.toHaveBeenCalled();
    expect(outbox.outboxCounts().events).toBe(before + 1);
  });

  it('flag on: events go to the offline activity queue with their context', async () => {
    const { aq, sink, outbox } = await load('1');
    outbox.recordEvent('paste_detected', { questionId: 'q', packId: 'p@1', language: 'JAVA', assessmentId: null }, { pastedChars: 5, source: 'external' });
    await aq.flushActivity();
    expect(sink).toHaveBeenCalledTimes(1);
    const [[events]] = sink.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(events[0]).toMatchObject({ eventType: 'paste_detected', packId: 'p@1', questionId: 'q', language: 'JAVA', metadata: { pastedChars: 5, source: 'external' } });
  });
});
