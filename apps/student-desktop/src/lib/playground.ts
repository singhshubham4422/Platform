// Playground helpers kept free of Monaco/React so they can be unit tested.
import type { LanguageId } from '@platform/language-config';

export const PLAYGROUND_LANGUAGES: LanguageId[] = ['PYTHON', 'C', 'CPP', 'JAVA'];

export const PLAYGROUND_STARTERS: Record<LanguageId, string> = {
  PYTHON: [
    'name = input("What is your name? ")',
    'print(f"Hello, {name}!")',
    '',
    'for i in range(1, 4):',
    '    print(i, "squared is", i * i)',
    '',
  ].join('\n'),
  C: [
    '#include <stdio.h>',
    '',
    'int main(void) {',
    '    char name[64];',
    '    printf("What is your name? ");',
    '    if (scanf("%63s", name) == 1) {',
    '        printf("Hello, %s!\\n", name);',
    '    }',
    '    for (int i = 1; i <= 3; i++) {',
    '        printf("%d squared is %d\\n", i, i * i);',
    '    }',
    '    return 0;',
    '}',
    '',
  ].join('\n'),
  CPP: [
    '#include <iostream>',
    '#include <string>',
    '',
    'int main() {',
    '    std::string name;',
    '    std::cout << "What is your name? ";',
    '    std::cin >> name;',
    '    std::cout << "Hello, " << name << "!" << std::endl;',
    '    for (int i = 1; i <= 3; i++) {',
    '        std::cout << i << " squared is " << i * i << std::endl;',
    '    }',
    '    return 0;',
    '}',
    '',
  ].join('\n'),
  JAVA: [
    'import java.util.Scanner;',
    '',
    'public class Main {',
    '    public static void main(String[] args) {',
    '        Scanner in = new Scanner(System.in);',
    '        System.out.print("What is your name? ");',
    '        String name = in.hasNext() ? in.next() : "student";',
    '        System.out.println("Hello, " + name + "!");',
    '        for (int i = 1; i <= 3; i++) {',
    '            System.out.println(i + " squared is " + i * i);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'),
};

export const PLAYGROUND_LIMITS = { timeLimitMs: 10_000, memoryLimitMb: 512, outputLimitKb: 256 };

const DRAFT_KEY = (language: LanguageId) => `platform_playground_${language}`;

export function loadPlaygroundDraft(language: LanguageId): string {
  try {
    return localStorage.getItem(DRAFT_KEY(language)) ?? PLAYGROUND_STARTERS[language];
  } catch {
    return PLAYGROUND_STARTERS[language];
  }
}

export function savePlaygroundDraft(language: LanguageId, code: string): void {
  try {
    localStorage.setItem(DRAFT_KEY(language), code);
  } catch {
    /* storage unavailable: the code stays in the editor */
  }
}

export function clearPlaygroundDraft(language: LanguageId): void {
  try {
    localStorage.removeItem(DRAFT_KEY(language));
  } catch {
    /* ignore */
  }
}

/** Tidy a document: tabs to spaces at line start, no trailing spaces, one final newline. */
export function formatSource(text: string, tabSize = 4): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = lines.map((line) => {
    const lead = /^[ \t]*/.exec(line)![0];
    const width = [...lead].reduce(
      (w, ch) => (ch === '\t' ? w + tabSize - (w % tabSize) : w + 1),
      0,
    );
    return (' '.repeat(width) + line.slice(lead.length)).replace(/[ \t]+$/, '');
  });
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop();
  const joined = out.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

export interface Diagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

/** Turn compiler or traceback output into editor markers for the student's file. */
export function parseDiagnostics(
  language: LanguageId,
  output: string | null | undefined,
): Diagnostic[] {
  if (!output) return [];
  const text = output.replace(/\r\n?/g, '\n');
  const found: Diagnostic[] = [];
  if (language === 'C' || language === 'CPP') {
    // clang: <path>/main.c:3:5: error: message
    for (const m of text.matchAll(
      /(?:^|[\\/\s])main\.(?:c|cpp):(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/gm,
    )) {
      found.push({
        line: Number(m[1]),
        column: Number(m[2]),
        severity: m[3] === 'warning' ? 'warning' : 'error',
        message: m[4].trim(),
      });
    }
  } else if (language === 'JAVA') {
    // javac: <path>/Main.java:3: error: message
    for (const m of text.matchAll(/(?:^|[\\/\s])\w+\.java:(\d+):\s*(error|warning):\s*(.+)$/gm)) {
      found.push({
        line: Number(m[1]),
        column: 1,
        severity: m[2] === 'warning' ? 'warning' : 'error',
        message: m[3].trim(),
      });
    }
  } else {
    // Python traceback: File ".../main.py", line 3 ... final line "NameError: ..."
    const lines = [...text.matchAll(/File "[^"]*main\.py", line (\d+)/g)];
    if (lines.length) {
      const last = text.trim().split('\n').pop() ?? 'Error';
      found.push({
        line: Number(lines[lines.length - 1][1]),
        column: 1,
        severity: 'error',
        message: last.trim(),
      });
    }
  }
  return found;
}
