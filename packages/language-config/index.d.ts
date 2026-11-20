export type LanguageId = 'PYTHON' | 'C' | 'CPP' | 'JAVA';

export type Verdict =
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'JUDGE_UNAVAILABLE'
  | 'SUBMISSION_FAILED';

export interface LanguageDefinition {
  id: LanguageId;
  label: string;
  monaco: string;
  fileName: string;
  extension: string;
  standard: string;
  judge0LanguageId: number;
  judge0Runtime: string;
  compileFlags?: string[];
  compileTimeoutMs: number;
  defaultTimeLimitMs: number;
  starterCode: string;
}

export declare const LANGUAGES: LanguageDefinition[];
export declare const LANGUAGE_IDS: LanguageId[];
export declare const VERDICTS: Verdict[];
export declare function getLanguage(id: string): LanguageDefinition | null;
export declare function isLanguageId(id: unknown): id is LanguageId;
export declare function javaMainClass(source: string): string;
export declare function outputsMatch(actual: string, expected: string): boolean;
