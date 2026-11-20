// Single source of truth for programming languages supported by the platform.
// Consumed by the API (judge), the web console (question authoring) and the
// student desktop (Monaco workspace). Plain ESM + .d.ts so no build step is needed.

/** @type {import('./index').LanguageDefinition[]} */
export const LANGUAGES = [
  {
    id: 'PYTHON',
    label: 'Python 3',
    monaco: 'python',
    fileName: 'main.py',
    extension: '.py',
    standard: 'Python 3.11',
    judge0LanguageId: 71,
    judge0Runtime: 'Python (3.8.1) on Judge0 CE 1.13.1',
    compileTimeoutMs: 0,
    defaultTimeLimitMs: 4000,
    starterCode: [
      'import sys',
      '',
      '',
      'def main() -> None:',
      '    data = sys.stdin.read().split()',
      '    # Write your solution here',
      '',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '',
    ].join('\n'),
  },
  {
    id: 'C',
    label: 'C (C11)',
    monaco: 'c',
    fileName: 'main.c',
    extension: '.c',
    standard: 'C11',
    judge0LanguageId: 50,
    judge0Runtime: 'C (GCC 9.2.0) on Judge0 CE 1.13.1',
    compileFlags: ['-std=c11', '-O2', '-Wall', '-lm'],
    compileTimeoutMs: 15000,
    defaultTimeLimitMs: 2000,
    starterCode: [
      '#include <stdio.h>',
      '',
      'int main(void) {',
      '    /* Write your solution here */',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'CPP',
    label: 'C++ (C++17)',
    monaco: 'cpp',
    fileName: 'main.cpp',
    extension: '.cpp',
    standard: 'C++17',
    judge0LanguageId: 54,
    judge0Runtime: 'C++ (GCC 9.2.0) on Judge0 CE 1.13.1',
    compileFlags: ['-std=c++17', '-O2', '-Wall'],
    compileTimeoutMs: 20000,
    defaultTimeLimitMs: 2000,
    starterCode: [
      '#include <bits/stdc++.h>',
      'using namespace std;',
      '',
      'int main() {',
      '    ios::sync_with_stdio(false);',
      '    cin.tie(nullptr);',
      '    // Write your solution here',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'JAVA',
    label: 'Java 17',
    monaco: 'java',
    fileName: 'Main.java',
    extension: '.java',
    standard: 'Java 17 (source level)',
    judge0LanguageId: 62,
    judge0Runtime: 'Java (OpenJDK 13.0.1) on Judge0 CE 1.13.1',
    compileTimeoutMs: 30000,
    defaultTimeLimitMs: 4000,
    starterCode: [
      'import java.util.*;',
      '',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner sc = new Scanner(System.in);',
      '        // Write your solution here',
      '    }',
      '}',
      '',
    ].join('\n'),
  },
];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id);

/** @param {string} id */
export function getLanguage(id) {
  return LANGUAGES.find((l) => l.id === String(id).toUpperCase()) ?? null;
}

/** @param {unknown} id */
export function isLanguageId(id) {
  return typeof id === 'string' && LANGUAGE_IDS.includes(id.toUpperCase());
}

/**
 * Java sources may declare any public class name (J_Platform questions use `Solution`).
 * @param {string} source
 */
export function javaMainClass(source) {
  const match = /public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(source);
  return match ? match[1] : 'Main';
}

/** Verdicts produced by the judge pipeline. */
export const VERDICTS = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
  'JUDGE_UNAVAILABLE',
  'SUBMISSION_FAILED',
];

/**
 * Normalised output comparison: ignores trailing whitespace on each line and trailing blank lines,
 * and treats CRLF as LF. Interior whitespace is significant.
 * @param {string} actual
 * @param {string} expected
 */
export function outputsMatch(actual, expected) {
  const norm = (s) =>
    String(s ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}
