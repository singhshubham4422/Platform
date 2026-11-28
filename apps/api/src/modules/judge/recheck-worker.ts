// Central re-check process for high-stakes assessment attempts.
// Run with: pnpm --filter @platform/api recheck:worker
// It deliberately refuses to start without the sandboxed Judge0 provider.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LanguageId, Verdict } from '@platform/language-config';
import { Judge0Provider } from './judge0.provider.js';
import type { JudgeProvider, JudgeTestOutcome } from './provider.js';

const LANGUAGES = new Set(['PYTHON', 'C', 'CPP', 'JAVA']);
const MAX_ATTEMPTS = 3;

export interface RecheckJob {
  id: string;
  question_id: string;
  language: string;
  source: string;
}
interface RecheckQuestion {
  time_limit_ms: number;
  memory_limit_mb: number;
  output_limit_kb: number;
}
interface RecheckTest { ordinal: number; input: string; expected_output: string; }

export interface RecheckStore {
  claim(): Promise<RecheckJob | null>;
  question(questionId: string): Promise<RecheckQuestion | null>;
  tests(questionId: string): Promise<RecheckTest[]>;
  complete(id: string, result: { verdict: Verdict; passed: number; total: number }): Promise<void>;
  requeue(id: string): Promise<void>;
  fail(id: string): Promise<void>;
}

export type RecheckJudge = Pick<JudgeProvider, 'name' | 'execute'>;

class SupabaseRecheckStore implements RecheckStore {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string, private readonly fetchImpl: typeof fetch) {}
  private async request(pathname: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${pathname}`, {
      ...init,
      headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`SUPABASE_${res.status}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async claim(): Promise<RecheckJob | null> {
    const data = await this.request('/rest/v1/rpc/claim_recheck', { method: 'POST', body: '{}' });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { id: row.id, question_id: row.question_id, language: row.language, source: row.source };
  }
  async question(questionId: string) {
    const rows = await this.request(`/rest/v1/questions?select=time_limit_ms,memory_limit_mb,output_limit_kb&id=eq.${encodeURIComponent(questionId)}`);
    return rows?.[0] ?? null;
  }
  async tests(questionId: string) {
    return await this.request(`/rest/v1/question_tests?select=ordinal,input,expected_output&question_id=eq.${encodeURIComponent(questionId)}&order=ordinal`) ?? [];
  }
  private patch(id: string, body: object) {
    return this.request(`/rest/v1/submissions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(body) });
  }
  async complete(id: string, result: { verdict: Verdict; passed: number; total: number }) {
    await this.patch(id, { recheck_verdict: result.verdict, recheck_passed: result.passed, recheck_total: result.total, recheck_at: new Date().toISOString(), recheck_status: 'DONE' });
  }
  async requeue(id: string) { await this.patch(id, { recheck_status: 'QUEUED' }); }
  async fail(id: string) { await this.patch(id, { recheck_status: 'FAILED' }); }
}

function passedCount(tests: JudgeTestOutcome[]) {
  return tests.filter((t) => t.verdict === 'ACCEPTED').length;
}

/** Processes one claimed job. Exported for the unit tests; failures are retried up to three times. */
export async function recheckOnce(store: RecheckStore, judge: RecheckJudge, attempts: Map<string, number>): Promise<'idle' | 'done' | 'retrying' | 'failed'> {
  const job = await store.claim();
  if (!job) return 'idle';
  const tries = (attempts.get(job.id) ?? 0) + 1;
  attempts.set(job.id, tries);
  try {
    if (judge.name !== 'judge0') throw new Error('JUDGE_PROVIDER_NOT_SANDBOXED');
    if (!LANGUAGES.has(job.language)) throw new Error('UNSUPPORTED_LANGUAGE');
    const [question, tests] = await Promise.all([store.question(job.question_id), store.tests(job.question_id)]);
    if (!question || tests.length === 0) throw new Error('QUESTION_TESTS_MISSING');
    const outcome = await judge.execute({
      language: job.language as LanguageId,
      source: job.source,
      tests: tests.map(t => ({ ordinal: t.ordinal, input: t.input, expectedOutput: t.expected_output })),
      timeLimitMs: question.time_limit_ms,
      memoryLimitMb: question.memory_limit_mb,
    });
    if (outcome.provider !== 'judge0') throw new Error('JUDGE_RESULT_NOT_SANDBOXED');
    await store.complete(job.id, { verdict: outcome.verdict, passed: passedCount(outcome.tests), total: tests.length });
    attempts.delete(job.id);
    return 'done';
  } catch {
    if (tries >= MAX_ATTEMPTS) { await store.fail(job.id); attempts.delete(job.id); return 'failed'; }
    await store.requeue(job.id);
    return 'retrying';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startRecheckWorker({ env = process.env, fetchImpl = fetch, judge, log = console }: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  judge?: RecheckJudge;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
} = {}) {
  if (env.JUDGE_PROVIDER !== 'judge0') throw new Error('Recheck worker requires JUDGE_PROVIDER=judge0');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JUDGE0_URL']) {
    if (!env[key]) throw new Error(`${key}_MISSING`);
  }
  const store = new SupabaseRecheckStore(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, fetchImpl);
  const provider = judge ?? new Judge0Provider(env.JUDGE0_URL!, env.JUDGE0_AUTH_TOKEN);
  if (provider.name !== 'judge0') throw new Error('Recheck worker requires the judge0 provider');
  const attempts = new Map<string, number>();
  const pollMs = Math.max(500, Number(env.RECHECK_POLL_MS ?? 2000));
  log.info('[recheck] worker started');
  for (;;) {
    try {
      const result = await recheckOnce(store, provider, attempts);
      if (result === 'done') log.info('[recheck] submission re-checked');
      else if (result === 'failed') log.warn('[recheck] re-check failed after retries');
      else await sleep(result === 'retrying' ? pollMs * 2 : pollMs);
    } catch {
      log.error('[recheck] store error; retrying');
      await sleep(pollMs);
    }
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  startRecheckWorker().catch((error: Error) => { console.error(`[recheck] cannot start: ${error.message}`); process.exit(1); });
}
