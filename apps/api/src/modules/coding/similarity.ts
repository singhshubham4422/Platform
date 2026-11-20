// Code-similarity analysis to *start* a human review. Never an accusation and never AI-authorship detection.
//
// Providers:
//  - builtin-winnowing: token k-gram fingerprints (winnowing, Schleimer et al. 2003) with Jaccard overlap and
//    matching line regions. Language-agnostic: identifiers/literals are normalised so renaming does not hide copying.
//  - jplag: runs the JPlag CLI (JPLAG_JAR) when configured. JPlag parses source; it never executes it.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SimilarityInput {
  submissionId: string;
  studentId: string;
  studentName: string;
  language: string;
  code: string;
}

export interface SimilarityPair {
  a: { submissionId: string; studentId: string; studentName: string };
  b: { submissionId: string; studentId: string; studentName: string };
  score: number; // 0..1
  matches: Array<{ aLines: [number, number]; bLines: [number, number] }>;
}

const KEYWORDS = new Set(
  ('if else for while do return int long float double char void class public private protected static final new ' +
    'def import from as in not and or True False None print include using namespace std struct switch case break ' +
    'continue try catch except finally throw throws string String bool boolean auto const').split(' '),
);

interface Token {
  t: string;
  line: number;
}

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/#(?!include)[^\n]*/g, '');
  const re = /[A-Za-z_]\w*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|==|!=|<=|>=|&&|\|\||[{}()[\];,.+\-*/%<>=!&|^~?:]/g;
  const lines = stripped.split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(re)) {
      const raw = m[0];
      let t = raw;
      if (/^[A-Za-z_]/.test(raw)) t = KEYWORDS.has(raw) ? raw : 'ID';
      else if (/^\d/.test(raw)) t = 'NUM';
      else if (/^["']/.test(raw)) t = 'STR';
      tokens.push({ t, line: i + 1 });
    }
  });
  return tokens;
}

interface Fingerprint {
  hash: string;
  line: number;
}

export function fingerprints(code: string, k = 8, w = 4): Fingerprint[] {
  const tokens = tokenize(code);
  if (tokens.length < k) return [];
  const grams: Fingerprint[] = [];
  for (let i = 0; i + k <= tokens.length; i++) {
    const text = tokens.slice(i, i + k).map((x) => x.t).join(' ');
    grams.push({ hash: createHash('sha1').update(text).digest('hex').slice(0, 12), line: tokens[i].line });
  }
  const out = new Map<string, Fingerprint>();
  for (let i = 0; i + w <= grams.length; i++) {
    const win = grams.slice(i, i + w);
    const min = win.reduce((m, g) => (g.hash < m.hash ? g : m));
    if (!out.has(min.hash)) out.set(min.hash, min);
  }
  if (grams.length < w) for (const g of grams) out.set(g.hash, g);
  return [...out.values()];
}

function mergeRanges(lines: number[]): Array<[number, number]> {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const l of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && l - last[1] <= 2) last[1] = l;
    else ranges.push([l, l]);
  }
  return ranges;
}

export function compareWinnowing(inputs: SimilarityInput[], threshold: number): SimilarityPair[] {
  const prints = inputs.map((s) => ({ s, fp: fingerprints(s.code) }));
  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const A = prints[i];
      const B = prints[j];
      if (A.s.studentId === B.s.studentId || A.fp.length === 0 || B.fp.length === 0) continue;
      const bMap = new Map(B.fp.map((f) => [f.hash, f.line]));
      const shared = A.fp.filter((f) => bMap.has(f.hash));
      const union = new Set([...A.fp.map((f) => f.hash), ...B.fp.map((f) => f.hash)]).size;
      const score = union === 0 ? 0 : shared.length / union;
      if (score < threshold) continue;
      const aRanges = mergeRanges(shared.map((f) => f.line));
      const bRanges = mergeRanges(shared.map((f) => bMap.get(f.hash)!));
      pairs.push({
        a: { submissionId: A.s.submissionId, studentId: A.s.studentId, studentName: A.s.studentName },
        b: { submissionId: B.s.submissionId, studentId: B.s.studentId, studentName: B.s.studentName },
        score: Math.round(score * 1000) / 1000,
        matches: aRanges.slice(0, 20).map((r, idx) => ({ aLines: r, bLines: bRanges[Math.min(idx, bRanges.length - 1)] ?? r })),
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

const JPLAG_LANG: Record<string, string> = { PYTHON: 'python3', JAVA: 'java', CPP: 'cpp', C: 'cpp' };

/** Optional JPlag CLI integration (requires Java and JPLAG_JAR). Returns null when JPlag is not configured. */
export async function compareWithJplag(inputs: SimilarityInput[], threshold: number): Promise<SimilarityPair[] | null> {
  const jar = process.env.JPLAG_JAR;
  if (!jar || inputs.length < 2) return null;
  const language = JPLAG_LANG[inputs[0].language] ?? 'text';
  const dir = await mkdtemp(join(tmpdir(), 'lp-jplag-'));
  try {
    const ext: Record<string, string> = { PYTHON: 'py', JAVA: 'java', CPP: 'cpp', C: 'c' };
    for (const s of inputs) {
      const sub = join(dir, 'subs', s.submissionId);
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, `main.${ext[s.language] ?? 'txt'}`), s.code);
    }
    const resultFile = join(dir, 'result');
    await new Promise<void>((resolve, reject) =>
      execFile('java', ['-jar', jar, '-l', language, '-r', resultFile, '--csv-export', join(dir, 'subs')], { timeout: 120_000 }, (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    const csv = await readFile(join(dir, 'results.csv'), 'utf8').catch(() => readFile(`${resultFile}.csv`, 'utf8'));
    const byId = new Map(inputs.map((s) => [s.submissionId, s]));
    const pairs: SimilarityPair[] = [];
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const [first, second, avg] = line.split(',');
      const a = byId.get(first);
      const b = byId.get(second);
      const score = Number(avg);
      if (!a || !b || !(score >= threshold)) continue;
      pairs.push({
        a: { submissionId: a.submissionId, studentId: a.studentId, studentName: a.studentName },
        b: { submissionId: b.submissionId, studentId: b.studentId, studentName: b.studentName },
        score,
        matches: [],
      });
    }
    return pairs;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
