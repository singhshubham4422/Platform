import { describe, expect, it, vi } from 'vitest';
import { recheckOnce, startRecheckWorker, type RecheckJob, type RecheckStore } from '../../modules/judge/recheck-worker.js';
import type { JudgeOutcome } from '../../modules/judge/provider.js';

const JOB: RecheckJob = {
  id: '11111111-1111-4111-8111-111111111111',
  question_id: '22222222-2222-4222-8222-222222222222',
  language: 'PYTHON',
  source: 'print(input())',
};

function store(overrides: Partial<RecheckStore> = {}): RecheckStore {
  return {
    claim: vi.fn(async () => JOB),
    question: vi.fn(async () => ({ time_limit_ms: 2000, memory_limit_mb: 256, output_limit_kb: 64 })),
    tests: vi.fn(async () => [
      { ordinal: 1, input: '1', expected_output: '1' },
      { ordinal: 2, input: '2', expected_output: '2' },
    ]),
    complete: vi.fn(async () => undefined),
    requeue: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

const outcome: JudgeOutcome = {
  verdict: 'WRONG_ANSWER',
  compileOutput: null,
  provider: 'judge0',
  tests: [
    { ordinal: 1, verdict: 'ACCEPTED', stdout: '1', stderr: '', timeMs: 1, memoryKb: 1 },
    { ordinal: 2, verdict: 'WRONG_ANSWER', stdout: '0', stderr: '', timeMs: 1, memoryKb: 1 },
  ],
};

describe('re-check worker', () => {
  it('claims a queued submission, runs every test through Judge0 and records the result', async () => {
    const s = store();
    const execute = vi.fn(async () => outcome);
    const result = await recheckOnce(s, { name: 'judge0', execute }, new Map());
    expect(result).toBe('done');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ language: 'PYTHON', source: JOB.source, timeLimitMs: 2000, memoryLimitMb: 256 }));
    expect(s.complete).toHaveBeenCalledWith(JOB.id, { verdict: 'WRONG_ANSWER', passed: 1, total: 2 });
    expect(s.fail).not.toHaveBeenCalled();
  });

  it('marks FAILED after three failed attempts and never records a pass', async () => {
    const s = store();
    const execute = vi.fn(async () => { throw new Error('JUDGE0_DOWN'); });
    const attempts = new Map<string, number>();
    expect(await recheckOnce(s, { name: 'judge0', execute }, attempts)).toBe('retrying');
    expect(await recheckOnce(s, { name: 'judge0', execute }, attempts)).toBe('retrying');
    expect(await recheckOnce(s, { name: 'judge0', execute }, attempts)).toBe('failed');
    expect(s.requeue).toHaveBeenCalledTimes(2);
    expect(s.fail).toHaveBeenCalledTimes(1);
    expect(s.complete).not.toHaveBeenCalled();
  });

  it('refuses to accept a result that did not come from Judge0', async () => {
    const s = store();
    const execute = vi.fn(async () => ({ ...outcome, provider: 'local-unsandboxed-dev' }));
    const attempts = new Map<string, number>();
    await recheckOnce(s, { name: 'judge0', execute }, attempts);
    await recheckOnce(s, { name: 'judge0', execute }, attempts);
    expect(await recheckOnce(s, { name: 'judge0', execute }, attempts)).toBe('failed');
    expect(s.complete).not.toHaveBeenCalled();
  });

  it('returns idle when nothing is queued', async () => {
    const s = store({ claim: vi.fn(async () => null) });
    expect(await recheckOnce(s, { name: 'judge0', execute: vi.fn() }, new Map())).toBe('idle');
  });

  it('refuses to start without JUDGE_PROVIDER=judge0', async () => {
    const judge = { name: 'judge0' as const, execute: vi.fn() };
    await expect(startRecheckWorker({ env: {}, judge })).rejects.toThrow('JUDGE_PROVIDER=judge0');
    await expect(startRecheckWorker({ env: { JUDGE_PROVIDER: 'local-unsandboxed-dev' }, judge })).rejects.toThrow('JUDGE_PROVIDER=judge0');
  });
});
