import { describe, expect, it } from 'vitest';
import {
  PLAYGROUND_LANGUAGES,
  PLAYGROUND_STARTERS,
  formatSource,
  parseDiagnostics,
} from './playground';

describe('playground helpers', () => {
  it('has a starter program for every language', () => {
    for (const id of PLAYGROUND_LANGUAGES)
      expect(PLAYGROUND_STARTERS[id].length).toBeGreaterThan(20);
    expect(PLAYGROUND_STARTERS.JAVA).toContain('public class Main');
  });

  it('formats indentation, trailing spaces and final newline', () => {
    expect(formatSource('if x:\r\n\tprint(1)   \n\n\n\n')).toBe('if x:\n    print(1)\n');
    expect(formatSource('a', 2)).toBe('a\n');
    expect(formatSource(' \tb', 4)).toBe('    b\n');
  });

  it('reads clang errors for C and C++', () => {
    const out =
      "C:\\x\\work\\src\\main.c:3:5: error: use of undeclared identifier 'y'\n/tmp/src/main.cpp:7:1: warning: unused variable";
    expect(parseDiagnostics('C', out)).toEqual([
      { line: 3, column: 5, severity: 'error', message: "use of undeclared identifier 'y'" },
      { line: 7, column: 1, severity: 'warning', message: 'unused variable' },
    ]);
  });

  it('reads javac errors', () => {
    expect(
      parseDiagnostics('JAVA', "/w/src/Main.java:4: error: ';' expected\n        int x = 1\n"),
    ).toEqual([{ line: 4, column: 1, severity: 'error', message: "';' expected" }]);
  });

  it('reads the last Python traceback frame', () => {
    const tb =
      'Traceback (most recent call last):\n  File "/w/src/main.py", line 2, in <module>\n    print(y)\nNameError: name \'y\' is not defined\n';
    expect(parseDiagnostics('PYTHON', tb)).toEqual([
      { line: 2, column: 1, severity: 'error', message: "NameError: name 'y' is not defined" },
    ]);
    expect(parseDiagnostics('PYTHON', '')).toEqual([]);
  });
});
