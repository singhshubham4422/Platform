// Editor-independent completion data for the four judge languages. The Monaco workspace turns
// these into completion items; keeping the data plain makes it testable without a DOM.
import type { LanguageId } from '@lplatform/language-config';

export type CompletionKind = 'function' | 'keyword' | 'snippet' | 'property' | 'class';

export interface CompletionEntry {
  label: string;
  kind: CompletionKind;
  /** Monaco snippet syntax (${1:name}); plain text when no placeholders. */
  insert: string;
  detail?: string;
  doc?: string;
}

const fn = (label: string, detail: string, doc: string): CompletionEntry => ({ label, kind: 'function', insert: `${label}($1)`, detail, doc });
const kw = (words: string): CompletionEntry[] => words.split(' ').map((label) => ({ label, kind: 'keyword', insert: label }));
const snip = (label: string, insert: string, detail: string): CompletionEntry => ({ label, kind: 'snippet', insert, detail });

const PYTHON: CompletionEntry[] = [
  fn('print', '(*values)', 'Show values on the screen.'),
  fn('input', '(prompt)', 'Read a line typed by the user as text.'),
  fn('len', '(obj)', 'Number of items in a list, string or dict.'),
  fn('range', '(start, stop, step)', 'A sequence of numbers, often used in for loops.'),
  fn('int', '(x)', 'Convert to a whole number.'),
  fn('float', '(x)', 'Convert to a decimal number.'),
  fn('str', '(x)', 'Convert to text.'),
  fn('list', '(iterable)', 'Create a list.'),
  fn('dict', '(**kwargs)', 'Create a dictionary.'),
  fn('set', '(iterable)', 'Create a set of unique items.'),
  fn('sum', '(iterable)', 'Add up all numbers.'),
  fn('min', '(iterable)', 'Smallest item.'),
  fn('max', '(iterable)', 'Largest item.'),
  fn('abs', '(x)', 'Absolute value.'),
  fn('sorted', '(iterable, key=None, reverse=False)', 'Return a new sorted list.'),
  fn('enumerate', '(iterable)', 'Pairs of (index, item).'),
  fn('zip', '(*iterables)', 'Combine items from several lists.'),
  fn('map', '(func, iterable)', 'Apply a function to every item.'),
  ...kw('def return if elif else for while break continue pass import from as class try except finally raise with lambda yield True False None and or not in is global nonlocal'),
  snip('def', 'def ${1:name}(${2:params}):\n\t${3:pass}', 'function'),
  snip('forr', 'for ${1:i} in range(${2:n}):\n\t${3:pass}', 'for … in range'),
  snip('ifmain', 'if __name__ == "__main__":\n\t${1:main()}', 'entry point'),
  snip('readints', 'data = list(map(int, sys.stdin.read().split()))', 'read all integers from stdin'),
  snip('try', 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:print(e)}', 'try/except'),
  snip('class', 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}', 'class'),
];

export const PYTHON_MODULE_MEMBERS: Record<string, string[]> = {
  math: ['sqrt', 'floor', 'ceil', 'pi', 'e', 'sin', 'cos', 'tan', 'log', 'factorial', 'gcd', 'fabs', 'inf'],
  sys: ['stdin', 'stdout', 'setrecursionlimit', 'maxsize', 'argv'],
  collections: ['Counter', 'defaultdict', 'deque', 'OrderedDict', 'namedtuple'],
  heapq: ['heappush', 'heappop', 'heapify', 'nlargest', 'nsmallest'],
  itertools: ['permutations', 'combinations', 'product', 'accumulate', 'chain'],
  random: ['randint', 'random', 'choice', 'shuffle', 'sample'],
};

const C_COMMON = kw('int long short char float double void unsigned signed const static struct enum typedef return if else for while do switch case break continue default sizeof');

const C: CompletionEntry[] = [
  ...C_COMMON,
  fn('printf', '(const char *fmt, ...)', 'Formatted output to stdout.'),
  fn('scanf', '(const char *fmt, ...)', 'Formatted input from stdin.'),
  fn('malloc', '(size_t size)', 'Allocate memory.'),
  fn('free', '(void *ptr)', 'Release allocated memory.'),
  fn('strlen', '(const char *s)', 'Length of a string.'),
  fn('strcmp', '(const char *a, const char *b)', 'Compare strings.'),
  fn('qsort', '(void *base, size_t n, size_t size, cmp)', 'Sort an array.'),
  snip('main', 'int main(void) {\n\t${1}\n\treturn 0;\n}', 'main function'),
  snip('fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}', 'counted loop'),
  snip('readn', 'int ${1:n};\nif (scanf("%d", &${1:n}) != 1) return 0;', 'read an integer'),
  snip('inc', '#include <${1:stdio.h}>', 'include header'),
];

const CPP: CompletionEntry[] = [
  ...C_COMMON,
  ...kw('bool true false class public private protected template typename namespace using auto new delete nullptr'),
  { label: 'vector', kind: 'class', insert: 'vector<${1:int}> ${2:v}', detail: 'std::vector' },
  { label: 'string', kind: 'class', insert: 'string', detail: 'std::string' },
  { label: 'map', kind: 'class', insert: 'map<${1:int}, ${2:int}> ${3:m}', detail: 'std::map' },
  { label: 'unordered_map', kind: 'class', insert: 'unordered_map<${1:int}, ${2:int}> ${3:m}', detail: 'std::unordered_map' },
  fn('sort', '(first, last)', 'Sort a range.'),
  fn('max', '(a, b)', 'Larger of two values.'),
  fn('min', '(a, b)', 'Smaller of two values.'),
  snip('main', 'int main() {\n\tios::sync_with_stdio(false);\n\tcin.tie(nullptr);\n\t${1}\n\treturn 0;\n}', 'main with fast IO'),
  snip('fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t${3}\n}', 'counted loop'),
  snip('cout', 'cout << ${1} << "\\n";', 'print a line'),
  snip('cin', 'cin >> ${1};', 'read a value'),
  snip('readvec', 'int n; cin >> n;\nvector<long long> a(n);\nfor (auto &x : a) cin >> x;', 'read n numbers'),
];

const JAVA: CompletionEntry[] = [
  ...kw('public private protected static final class interface extends implements new return if else for while do switch case break continue try catch finally throw throws import package void int long double boolean char String null true false this super'),
  { label: 'Scanner', kind: 'class', insert: 'Scanner ${1:sc} = new Scanner(System.in);', detail: 'java.util.Scanner' },
  { label: 'ArrayList', kind: 'class', insert: 'List<${1:Integer}> ${2:list} = new ArrayList<>();', detail: 'java.util.ArrayList' },
  { label: 'HashMap', kind: 'class', insert: 'Map<${1:String}, ${2:Integer}> ${3:map} = new HashMap<>();', detail: 'java.util.HashMap' },
  snip('sout', 'System.out.println(${1});', 'print a line'),
  snip('psvm', 'public static void main(String[] args) {\n\t${1}\n}', 'main method'),
  snip('fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}', 'counted loop'),
  snip('foreach', 'for (${1:int} ${2:x} : ${3:items}) {\n\t${4}\n}', 'enhanced for'),
  snip('trycatch', 'try {\n\t${1}\n} catch (${2:Exception} e) {\n\t${3:e.printStackTrace();}\n}', 'try/catch'),
];

const BY_LANGUAGE: Record<LanguageId, CompletionEntry[]> = { PYTHON, C, CPP, JAVA };

/**
 * Suggestions for the text before the cursor on the current line.
 * Python `module.` prefixes return that module's members.
 */
export function completionsFor(language: LanguageId, linePrefix: string): CompletionEntry[] {
  if (language === 'PYTHON') {
    const member = /([A-Za-z_]\w*)\.(\w*)$/.exec(linePrefix);
    if (member) {
      const names = PYTHON_MODULE_MEMBERS[member[1]];
      if (names) return names.map((label) => ({ label, kind: 'property', insert: label }));
      return [];
    }
  }
  return BY_LANGUAGE[language];
}

/**
 * Whitespace normalisation used by "Format document": tabs → 4 spaces (Python/Java/C/C++),
 * trailing spaces removed, a single trailing newline. It never changes tokens, so it is safe for
 * every language; full language-aware formatting is not available in the offline editor.
 */
export function normalizeWhitespace(code: string): string {
  return (
    code
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\t/g, '    ').replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '') + '\n'
  );
}
