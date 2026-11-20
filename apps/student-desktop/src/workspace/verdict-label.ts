const VERDICT_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  COMPILE_ERROR: 'Compile Error',
  RUNTIME_ERROR: 'Runtime Error',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
  OUTPUT_LIMIT_EXCEEDED: 'Output Limit Exceeded',
  JUDGE_UNAVAILABLE: 'Judge Unavailable',
  SUBMISSION_FAILED: 'Submission Failed',
};

export function verdictLabel(verdict: string | null | undefined): string {
  return verdict ? (VERDICT_LABEL[verdict] ?? verdict) : 'Pending';
}
