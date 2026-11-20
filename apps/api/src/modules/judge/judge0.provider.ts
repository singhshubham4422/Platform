// Judge0 CE adapter. Talks only to the private Judge0 endpoint (never exposed to clients).
// Docs: https://ce.judge0.com — submissions are created in a batch with base64 encoding and polled.
import { getLanguage, javaMainClass, outputsMatch, type Verdict } from '@lplatform/language-config';
import {
  aggregateVerdict,
  JudgeUnavailableError,
  truncateOutput,
  type JudgeOutcome,
  type JudgeProvider,
  type JudgeProviderStatus,
  type JudgeRequest,
} from './provider.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

interface Judge0Submission {
  token?: string;
  status?: { id: number; description: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
}

/** Judge0 requires the public class to be `Main`; wrap other entry classes (J_Platform uses `Solution`). */
export function adaptJavaSource(source: string): string {
  const cls = javaMainClass(source);
  if (cls === 'Main') return source;
  const demoted = source.replace(new RegExp(`public\\s+((?:final\\s+)?class\\s+${cls}\\b)`), '$1');
  return `${demoted}\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        ${cls}.main(args);\n    }\n}\n`;
}

export function mapJudge0Status(sub: Judge0Submission, expected: string | null): Verdict {
  const id = sub.status?.id ?? 13;
  if (id === 6) return 'COMPILE_ERROR';
  if (id === 5) return 'TIME_LIMIT_EXCEEDED';
  if (id >= 7 && id <= 12) {
    // SIGKILL under the memory cgroup is how Judge0 reports memory exhaustion.
    const msg = `${sub.message ?? ''} ${unb64(sub.stderr)}`.toLowerCase();
    if (msg.includes('memory') || msg.includes('outofmemory')) return 'MEMORY_LIMIT_EXCEEDED';
    return 'RUNTIME_ERROR';
  }
  if (id === 13 || id === 14) return 'JUDGE_UNAVAILABLE';
  if (id === 3 || id === 4) {
    if (expected === null) return 'ACCEPTED';
    return outputsMatch(unb64(sub.stdout), expected) ? 'ACCEPTED' : 'WRONG_ANSWER';
  }
  return 'JUDGE_UNAVAILABLE';
}

export class Judge0Provider implements JudgeProvider {
  readonly name = 'judge0';
  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
    private readonly pollIntervalMs = 500,
    private readonly maxWaitMs = 60_000,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['X-Auth-Token'] = this.authToken;
    return h;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new JudgeUnavailableError(`Judge0 unreachable: ${(error as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429 || res.status === 503) {
      throw new JudgeUnavailableError(`Judge0 responded ${res.status}`);
    }
    if (!res.ok) throw new Error(`Judge0 request failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as T;
  }

  async status(): Promise<JudgeProviderStatus> {
    try {
      const langs = await this.call<Array<{ id: number; name: string }>>('/languages');
      const byId = new Map(langs.map((l) => [l.id, l.name]));
      const languages: JudgeProviderStatus['languages'] = {};
      for (const id of ['PYTHON', 'C', 'CPP', 'JAVA'] as const) {
        const name = byId.get(getLanguage(id)!.judge0LanguageId);
        if (name) languages[id] = name;
      }
      return { provider: this.name, available: true, detail: this.baseUrl, languages, sandboxed: true };
    } catch (error) {
      return {
        provider: this.name,
        available: false,
        detail: (error as Error).message,
        languages: {},
        sandboxed: true,
      };
    }
  }

  async execute(req: JudgeRequest): Promise<JudgeOutcome> {
    const lang = getLanguage(req.language);
    if (!lang) throw new Error(`Unsupported language ${req.language}`);
    const source = req.language === 'JAVA' ? adaptJavaSource(req.source) : req.source;
    const submissions = req.tests.map((t) => ({
      language_id: lang.judge0LanguageId,
      source_code: b64(source),
      stdin: b64(t.input),
      cpu_time_limit: Math.max(0.5, req.timeLimitMs / 1000),
      wall_time_limit: Math.max(2, (req.timeLimitMs * 3) / 1000),
      memory_limit: req.memoryLimitMb * 1024,
      max_file_size: 1024,
      enable_network: false,
      ...(lang.compileFlags ? { compiler_options: lang.compileFlags.filter((f) => f !== '-lm').join(' ') } : {}),
    }));
    const created = await this.call<Array<{ token?: string; error?: string }>>(
      '/submissions/batch?base64_encoded=true',
      { method: 'POST', body: JSON.stringify({ submissions }) },
    );
    const tokens = created.map((c) => c.token).filter((t): t is string => Boolean(t));
    if (tokens.length !== req.tests.length) throw new JudgeUnavailableError('Judge0 rejected submissions');

    const deadline = Date.now() + this.maxWaitMs;
    let results: Judge0Submission[] = [];
    for (;;) {
      const batch = await this.call<{ submissions: Judge0Submission[] }>(
        `/submissions/batch?base64_encoded=true&tokens=${tokens.join(',')}&fields=token,status,stdout,stderr,compile_output,message,time,memory`,
      );
      results = batch.submissions;
      if (results.every((r) => (r.status?.id ?? 1) > 2)) break;
      if (Date.now() > deadline) throw new JudgeUnavailableError('Judge0 did not finish in time');
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }

    const tests = results.map((r, i) => ({
      ordinal: req.tests[i].ordinal,
      verdict: mapJudge0Status(r, req.tests[i].expectedOutput),
      stdout: truncateOutput(unb64(r.stdout)),
      stderr: truncateOutput(unb64(r.stderr) || (r.message ?? '')),
      timeMs: r.time ? Math.round(Number(r.time) * 1000) : null,
      memoryKb: r.memory ?? null,
    }));
    const compileError = results.find((r) => r.status?.id === 6);
    return {
      provider: this.name,
      compileOutput: compileError ? truncateOutput(unb64(compileError.compile_output)) : null,
      verdict: aggregateVerdict(tests.map((t) => t.verdict)),
      tests,
    };
  }
}
