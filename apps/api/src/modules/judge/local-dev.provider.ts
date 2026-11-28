// DEVELOPMENT-ONLY execution provider.
//
// Runs student code with locally installed toolchains (python, gcc, g++, javac/java) in child
// processes started by the separate judge worker process — never by the API process. It applies
// wall-clock timeouts, output caps, a throw-away working directory and a minimal environment, but
// it is NOT a sandbox: there is no filesystem, network, process or memory isolation. It exists so
// the full workflow can be exercised on a developer machine where Judge0 (which needs Linux
// cgroups) cannot run. It refuses to start when NODE_ENV=production.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLanguage, javaMainClass, outputsMatch, type LanguageId } from '@platform/language-config';
import {
  aggregateVerdict,
  MAX_OUTPUT_BYTES,
  truncateOutput,
  type JudgeOutcome,
  type JudgeProvider,
  type JudgeProviderStatus,
  type JudgeRequest,
  type JudgeTestOutcome,
} from './provider.js';

const IS_WIN = process.platform === 'win32';
const PROGRAM_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'LANG'];

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  timeMs: number;
}

function minimalEnv(workDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of PROGRAM_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, TEMP: workDir, TMP: workDir, TMPDIR: workDir, HOME: workDir, USERPROFILE: workDir };
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs: number },
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    let stdout = '';
    let stderr = '';
    let outputExceeded = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: minimalEnv(opts.cwd), windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error), timedOut: false, outputExceeded: false, timeMs: 0 });
      return;
    }
    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const onData = (which: 'out' | 'err') => (chunk: Buffer) => {
      if (which === 'out') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES * 2) {
        outputExceeded = true;
        kill();
      }
    };
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));
    child.on('error', (err) => {
      stderr += String(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, outputExceeded, timeMs: Math.round(performance.now() - started) });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}

interface Prepared {
  run: { cmd: string; args: string[] };
  compileOutput: string | null;
  compileFailed: boolean;
}

async function prepare(language: LanguageId, source: string, dir: string): Promise<Prepared> {
  const lang = getLanguage(language)!;
  if (language === 'PYTHON') {
    await writeFile(join(dir, 'main.py'), source, 'utf8');
    return { run: { cmd: IS_WIN ? 'python' : 'python3', args: ['-I', '-B', 'main.py'] }, compileOutput: null, compileFailed: false };
  }
  if (language === 'C' || language === 'CPP') {
    const file = language === 'C' ? 'main.c' : 'main.cpp';
    const exe = IS_WIN ? 'main.exe' : 'main';
    await writeFile(join(dir, file), source, 'utf8');
    const flags = (lang.compileFlags ?? []).filter((f) => f !== '-lm');
    const res = await runProcess(language === 'C' ? 'gcc' : 'g++', [...flags, file, '-o', exe, ...(language === 'C' ? ['-lm'] : [])], {
      cwd: dir,
      timeoutMs: lang.compileTimeoutMs,
    });
    const failed = res.code !== 0;
    return { run: { cmd: join(dir, exe), args: [] }, compileOutput: truncateOutput(res.stderr || res.stdout) || null, compileFailed: failed };
  }
  // JAVA: keep the declared public class name (Main or Solution) as the file name.
  const cls = javaMainClass(source);
  await writeFile(join(dir, `${cls}.java`), source, 'utf8');
  const res = await runProcess('javac', ['-encoding', 'UTF-8', `${cls}.java`], { cwd: dir, timeoutMs: lang.compileTimeoutMs });
  return {
    run: { cmd: 'java', args: ['-Xmx256m', '-Xss64m', '-cp', '.', cls] },
    compileOutput: truncateOutput(res.stderr || res.stdout) || null,
    compileFailed: res.code !== 0,
  };
}

export class LocalDevProvider implements JudgeProvider {
  readonly name = 'local-unsandboxed-dev';

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LocalDevProvider is development-only and refuses to run with NODE_ENV=production.');
    }
  }

  async status(): Promise<JudgeProviderStatus> {
    const probes: Array<[LanguageId, string, string[]]> = [
      ['PYTHON', IS_WIN ? 'python' : 'python3', ['--version']],
      ['C', 'gcc', ['--version']],
      ['CPP', 'g++', ['--version']],
      ['JAVA', 'javac', ['-version']],
    ];
    const languages: JudgeProviderStatus['languages'] = {};
    const dir = await mkdtemp(join(tmpdir(), 'lp-probe-'));
    try {
      for (const [id, cmd, args] of probes) {
        const r = await runProcess(cmd, args, { cwd: dir, timeoutMs: 5000 });
        if (r.code === 0) languages[id] = (r.stdout || r.stderr).split(/\r?\n/)[0].trim();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return {
      provider: this.name,
      available: Object.keys(languages).length > 0,
      detail: 'Development-only local toolchains. NOT sandboxed — never use in production.',
      languages,
      sandboxed: false,
    };
  }

  async execute(req: JudgeRequest): Promise<JudgeOutcome> {
    const dir = await mkdtemp(join(tmpdir(), 'lp-judge-'));
    try {
      const prepared = await prepare(req.language, req.source, dir);
      if (prepared.compileFailed) {
        return {
          provider: this.name,
          verdict: 'COMPILE_ERROR',
          compileOutput: prepared.compileOutput,
          tests: req.tests.map((t) => ({ ordinal: t.ordinal, verdict: 'COMPILE_ERROR', stdout: '', stderr: '', timeMs: null, memoryKb: null })),
        };
      }
      const tests: JudgeTestOutcome[] = [];
      // JVM and interpreter start-up is excluded from the CPU limit in Judge0; allow a fixed margin here.
      const margin = req.language === 'JAVA' ? 1500 : req.language === 'PYTHON' ? 500 : 200;
      for (const t of req.tests) {
        const r = await runProcess(prepared.run.cmd, prepared.run.args, { cwd: dir, input: t.input, timeoutMs: req.timeLimitMs + margin });
        let verdict: JudgeTestOutcome['verdict'];
        if (r.timedOut) verdict = 'TIME_LIMIT_EXCEEDED';
        else if (r.outputExceeded) verdict = 'OUTPUT_LIMIT_EXCEEDED';
        else if (r.code !== 0) verdict = /OutOfMemoryError|MemoryError|bad_alloc/.test(r.stderr) ? 'MEMORY_LIMIT_EXCEEDED' : 'RUNTIME_ERROR';
        else if (t.expectedOutput === null) verdict = 'ACCEPTED';
        else verdict = outputsMatch(r.stdout, t.expectedOutput) ? 'ACCEPTED' : 'WRONG_ANSWER';
        tests.push({ ordinal: t.ordinal, verdict, stdout: truncateOutput(r.stdout), stderr: truncateOutput(r.stderr), timeMs: r.timeMs, memoryKb: null });
      }
      return { provider: this.name, verdict: aggregateVerdict(tests.map((t) => t.verdict)), compileOutput: prepared.compileOutput, tests };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
