import { invoke } from '@tauri-apps/api/core';
import { verdictLabel } from '../workspace/verdict-label';

export type Limits = { timeLimitMs: number; memoryLimitMb: number; outputLimitKb: number };
export type Verdict = 'ACCEPTED'|'WRONG_ANSWER'|'COMPILE_ERROR'|'RUNTIME_ERROR'|'TIME_LIMIT_EXCEEDED'|'MEMORY_LIMIT_EXCEEDED'|'OUTPUT_LIMIT_EXCEEDED'|'JUDGE_UNAVAILABLE'|'SUBMISSION_FAILED';
export type TestResult = {testId:string;hidden:boolean;verdict:Verdict;timeMs:number;memoryKb:number;stdout:string|null;stderr:string|null;expectedOutput:string|null;input:string|null};
export type RunResult = {attemptId:string;mode:'RUN'|'SUBMIT'|'CUSTOM';verdict:Verdict;compileOutput:string|null;tests:TestResult[];passed:number;total:number;totalTimeMs:number;startedAt:string;finishedAt:string};
export { verdictLabel };
export async function runCustom(language:string,source:string,stdin:string,limits:Limits):Promise<RunResult>{
  if(typeof window==='undefined' || !('__TAURI_INTERNALS__' in window)) throw new Error('DESKTOP_ONLY');
  return invoke<RunResult>('run_custom',{language,source,stdin,limits});
}
