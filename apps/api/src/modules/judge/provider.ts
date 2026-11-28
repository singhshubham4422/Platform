import type { LanguageId, Verdict } from '@platform/language-config';

export interface JudgeTestInput {
  ordinal: number;
  input: string;
  expectedOutput: string | null; // null = custom input, no expected output (RUN only)
}

export interface JudgeRequest {
  language: LanguageId;
  source: string;
  tests: JudgeTestInput[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface JudgeTestOutcome {
  ordinal: number;
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface JudgeOutcome {
  /** Overall verdict for the whole job. */
  verdict: Verdict;
  compileOutput: string | null;
  tests: JudgeTestOutcome[];
  provider: string;
}

export interface JudgeProviderStatus {
  provider: string;
  available: boolean;
  detail: string;
  languages: Partial<Record<LanguageId, string>>;
  sandboxed: boolean;
}

export interface JudgeProvider {
  readonly name: string;
  status(): Promise<JudgeProviderStatus>;
  execute(request: JudgeRequest): Promise<JudgeOutcome>;
}

/** Thrown when the execution backend cannot be reached; jobs are retried, then marked JUDGE_UNAVAILABLE. */
export class JudgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeUnavailableError';
  }
}

export const MAX_OUTPUT_BYTES = 64 * 1024;

export function truncateOutput(value: string | null | undefined, limit = MAX_OUTPUT_BYTES): string {
  const s = value ?? '';
  return s.length > limit ? `${s.slice(0, limit)}\n…[output truncated at ${limit} bytes]` : s;
}

/** Severity order used to aggregate per-test verdicts into a job verdict. */
const PRIORITY: Verdict[] = [
  'JUDGE_UNAVAILABLE',
  'SUBMISSION_FAILED',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'MEMORY_LIMIT_EXCEEDED',
  'TIME_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
  'WRONG_ANSWER',
  'ACCEPTED',
];

export function aggregateVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return 'ACCEPTED';
  for (const v of PRIORITY) if (verdicts.includes(v)) return v;
  return 'SUBMISSION_FAILED';
}
