import { describe, expect, it } from 'vitest';
import { aggregateVerdict, truncateOutput } from '../../modules/judge/provider.js';
import { adaptJavaSource, mapJudge0Status } from '../../modules/judge/judge0.provider.js';
import { createJudgeProvider, studentExecutionEnabled } from '../../modules/judge/judge.service.js';
import { compareWinnowing, tokenize } from '../../modules/coding/similarity.js';
import { signDownloadToken, validateUpload, verifyDownloadToken } from '../../modules/files/storage.js';
import { inferSkills } from '../../modules/analytics/skills.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('judge verdicts', () => {
  it('keeps student code execution disabled by default in production', async () => {
    const before = {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.ENABLE_STUDENT_EXECUTION,
      provider: process.env.JUDGE_PROVIDER,
    };
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_STUDENT_EXECUTION = 'false';
    delete process.env.JUDGE_PROVIDER;
    try {
      await expect(studentExecutionEnabled()).resolves.toBe(false);
    } finally {
      if (before.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before.nodeEnv;
      if (before.enabled === undefined) delete process.env.ENABLE_STUDENT_EXECUTION; else process.env.ENABLE_STUDENT_EXECUTION = before.enabled;
      if (before.provider === undefined) delete process.env.JUDGE_PROVIDER; else process.env.JUDGE_PROVIDER = before.provider;
    }
  });

  it('aggregates by severity, never upgrading a failure to Accepted', () => {
    expect(aggregateVerdict(['ACCEPTED', 'ACCEPTED'])).toBe('ACCEPTED');
    expect(aggregateVerdict(['ACCEPTED', 'WRONG_ANSWER'])).toBe('WRONG_ANSWER');
    expect(aggregateVerdict(['WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED'])).toBe('TIME_LIMIT_EXCEEDED');
    expect(aggregateVerdict(['COMPILE_ERROR', 'ACCEPTED'])).toBe('COMPILE_ERROR');
  });

  it('maps Judge0 statuses and re-checks output itself', () => {
    expect(mapJudge0Status({ status: { id: 3, description: 'Accepted' }, stdout: b64('9\n') }, '9')).toBe('ACCEPTED');
    expect(mapJudge0Status({ status: { id: 3, description: 'Accepted' }, stdout: b64('8') }, '9')).toBe('WRONG_ANSWER');
    expect(mapJudge0Status({ status: { id: 6, description: 'Compilation Error' } }, '9')).toBe('COMPILE_ERROR');
    expect(mapJudge0Status({ status: { id: 5, description: 'TLE' } }, '9')).toBe('TIME_LIMIT_EXCEEDED');
    expect(mapJudge0Status({ status: { id: 11, description: 'NZEC' }, stderr: b64('java.lang.OutOfMemoryError') }, '9')).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(mapJudge0Status({ status: { id: 13, description: 'Internal Error' } }, '9')).toBe('JUDGE_UNAVAILABLE');
  });

  it('wraps non-Main Java entry classes for Judge0', () => {
    const out = adaptJavaSource('public class Solution { public static void main(String[] a){} }');
    expect(out).toContain('class Solution');
    expect(out).not.toMatch(/public\s+class\s+Solution/);
    expect(out).toContain('public class Main');
    expect(adaptJavaSource('public class Main {}')).toBe('public class Main {}');
  });

  it('truncates large output', () => {
    expect(truncateOutput('x'.repeat(10), 4)).toContain('truncated');
  });

  it('requires Judge0 in production and restricts the unsafe fixture to explicit dev/test modes', () => {
    expect(createJudgeProvider({})).toBeNull();
    expect(() => createJudgeProvider({ JUDGE_PROVIDER: 'judge0' })).toThrow(/JUDGE0_URL/);
    expect(createJudgeProvider({ JUDGE_PROVIDER: 'judge0', JUDGE0_URL: 'http://judge0:2358' })?.name).toBe('judge0');
    expect(createJudgeProvider({ JUDGE_PROVIDER: 'local-unsandboxed-dev', NODE_ENV: 'test' })?.name).toBe('local-unsandboxed-dev');
    expect(createJudgeProvider({ JUDGE_PROVIDER: 'local-unsandboxed-dev', NODE_ENV: 'development' })?.name).toBe('local-unsandboxed-dev');
    expect(() => createJudgeProvider({ JUDGE_PROVIDER: 'local-unsandboxed-dev', NODE_ENV: 'production' })).toThrow(/only when NODE_ENV/);
    expect(() => createJudgeProvider({ JUDGE_PROVIDER: 'local-unsandboxed-dev' })).toThrow(/only when NODE_ENV/);
    expect(() => createJudgeProvider({ NODE_ENV: 'production' })).toThrow(/Production requires JUDGE_PROVIDER=judge0/);
    expect(() => createJudgeProvider({ JUDGE_PROVIDER: 'fake-success', NODE_ENV: 'development' })).toThrow(/Unsupported JUDGE_PROVIDER/);
  });
});

describe('similarity (winnowing)', () => {
  const a = 'int main(){ int total = 0; for (int i = 0; i < n; i++) { total += values[i]; } printf("%d", total); return 0; }';
  const renamed = 'int main(){ int s = 0; for (int k = 0; k < n; k++) { s += arr[k]; } printf("%d", s); return 0; }';
  const different = 'def f(x):\n    return sorted(x)[-1]\nprint(f([1,2,3]))';

  it('normalises identifiers so renaming does not hide copying', () => {
    expect(tokenize('int total = 5;').map((t) => t.t)).toEqual(['int', 'ID', '=', 'NUM', ';']);
    const pairs = compareWinnowing(
      [
        { submissionId: 's1', studentId: 'u1', studentName: 'A', language: 'C', code: a },
        { submissionId: 's2', studentId: 'u2', studentName: 'B', language: 'C', code: renamed },
        { submissionId: 's3', studentId: 'u3', studentName: 'C', language: 'PYTHON', code: different },
      ],
      0.5,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].score).toBeGreaterThan(0.9);
    expect(pairs[0].matches.length).toBeGreaterThan(0);
  });
});

describe('uploads', () => {
  it('accepts content matching its extension and rejects disguised files', () => {
    expect(validateUpload('notes.pdf', Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(validateUpload('main.py', Buffer.from('print(1)\n'))).toBe('text/x-python');
    expect(() => validateUpload('notes.pdf', Buffer.from('MZ\x90\x00'))).toThrow(/does not match/);
    expect(() => validateUpload('run.exe', Buffer.from('MZ'))).toThrow(/not allowed/);
    expect(() => validateUpload('empty.txt', Buffer.alloc(0))).toThrow(/empty/);
  });

  it('download tokens are scoped, signed and expire', () => {
    const t = signDownloadToken('file-1', 'user-1', 60);
    expect(verifyDownloadToken(t)).toEqual({ fileId: 'file-1', userId: 'user-1' });
    const tampered = Buffer.from(Buffer.from(t, 'base64url').toString().replace('file-1', 'file-2')).toString('base64url');
    expect(verifyDownloadToken(tampered)).toBeNull();
    expect(verifyDownloadToken(signDownloadToken('f', 'u', -10))).toBeNull();
  });
});

describe('skills', () => {
  it('uses explicit skills, otherwise infers from topic and language', () => {
    expect(inferSkills({ skills: ['OOPS'], topic: 'x', title: 'y' }, 'JAVA')).toEqual(['OOPS']);
    const inferred = inferSkills({ skills: [], topic: 'Sorting arrays', title: 'Bubble sort' }, 'CPP');
    expect(inferred).toContain('Data structures and algorithms');
    expect(inferred).toContain('C/C++');
    expect(inferred).toContain('Problem solving');
  });
});
