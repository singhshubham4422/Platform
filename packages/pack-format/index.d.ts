export type LanguageId = 'PYTHON' | 'C' | 'CPP' | 'JAVA';
export type OperatingSystem = 'windows' | 'macos' | 'linux';
export type Architecture = 'x86_64' | 'aarch64';
export interface EncFile { alg: 'A256GCM'; keyId: string; nonce: string; ciphertext: string }
export interface IndexEntry {
  language: LanguageId; version: string; os: OperatingSystem; arch: Architecture; size: number; sha256: string;
  path: string; sourceFile: string; compile: string[] | null; run: string[];
  smokeTest: { source: string; expectedOutput: string }; licenseFiles: string[];
}
export interface LangIndex { schemaVersion: 1; generatedAt: string; packs: IndexEntry[] }
export interface PackQuestion {
  id: string; title: string; path?: string; hiddenTestsPath?: string; topics: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'; points: number; order: number; statementMd: string;
  limits: { timeLimitMs: number; memoryLimitMb: number; outputLimitKb: number };
  starterCode: Partial<Record<LanguageId, string>>;
  visibleTests: { id: string; input: string; expectedOutput: string }[];
  hiddenTests: { id: string; input: string; expectedOutput: string }[];
}
export interface PackSource {
  kind: 'COURSE' | 'ASSESSMENT'; courseId: string; assessmentId: string | null; organizationId: string | null;
  version: number; minAppVersion: string; title: string; languages: LanguageId[]; questions: PackQuestion[];
  assessment: null | { opensAt: string; closesAt: string; durationMinutes: number; attemptsAllowed: number; gracePeriodMinutes: number; keyId: string; highStakes: boolean };
  encryption: null | { keyB64: string; keyId: string }; createdAt?: string; status?: string;
}
export interface PackManifest {
  schemaVersion: 1; packId: string; kind: 'COURSE' | 'ASSESSMENT'; courseId: string; assessmentId: string | null;
  organizationId: string | null; version: number; minAppVersion: string; title: string; languages: LanguageId[];
  createdAt: string; questions: { id: string; title: string; path: string; hiddenTestsPath: string; topics: string[]; difficulty: string; points: number; order: number }[];
  files: { path: string; sha256: string; size: number }[]; assessment: PackSource['assessment']; status?: string;
}
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string>;
export function generateKeyPair(): Promise<{ seedB64: string; publicKeyB64: string }>;
export function signDetached(bytes: Uint8Array | ArrayBuffer, seedB64: string): Promise<string>;
export function verifyDetached(bytes: Uint8Array | ArrayBuffer, sigB64: string, publicKeyB64: string): Promise<boolean>;
export function encryptHiddenTests(json: object, keyB64: string, keyId: string): Promise<EncFile>;
export function decryptHiddenTests(encFile: EncFile, keyB64: string): Promise<object>;
export function validateLangIndex(obj: unknown): Validation<LangIndex>;
export function validateManifest(obj: unknown): Validation<PackManifest>;
export function validateQuestion(obj: unknown): Validation<object>;
export function isSafeArchivePath(path: unknown): boolean;
export function buildPack(source: PackSource): Promise<{ bytes: Uint8Array; manifest: PackManifest; sha256: string }>;
export function readPack(bytes: Uint8Array | ArrayBuffer, options: { publicKeyB64: string; sigB64: string }): Promise<{ manifest: PackManifest; questions: Map<string, object>; hidden: Map<string, object> | null }>;
export function buildLangIndexEntry(entry: Omit<IndexEntry, 'size' | 'sha256'> & { zipBytes: Uint8Array }): Promise<IndexEntry>;
export function buildLangIndex(entries: IndexEntry[]): { json: string; bytes: Uint8Array };
