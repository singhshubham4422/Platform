import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Judge0Provider } from '../../modules/judge/judge0.provider.js';

const baseUrl = process.env.JUDGE0_URL;
if (!baseUrl) throw new Error('Real Judge0 acceptance requires JUDGE0_URL; this suite never substitutes the local executor.');

const provider = new Judge0Provider(baseUrl, process.env.JUDGE0_AUTH_TOKEN, 500, 120_000);

const programs = [
  { language: 'PYTHON' as const, source: 'n = int(input())\nprint(n * 2)', input: '21\n' },
  { language: 'C' as const, source: '#include <stdio.h>\nint main(void){int n;if(scanf("%d",&n)!=1)return 2;printf("%d\\n",n*2);return 0;}', input: '21\n' },
  { language: 'CPP' as const, source: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}', input: '21\n' },
  { language: 'JAVA' as const, source: 'import java.util.*; public class Main { public static void main(String[] a){ Scanner s=new Scanner(System.in); System.out.println(s.nextInt()*2); } }', input: '21\n' },
];

describe('real isolated Judge0 CE acceptance', () => {
  beforeAll(async () => {
    const status = await provider.status();
    expect(status.available, status.detail).toBe(true);
    expect(status.sandboxed).toBe(true);
    for (const language of ['PYTHON', 'C', 'CPP', 'JAVA'] as const) {
      expect(status.languages[language], `Judge0 missing ${language}`).toBeTruthy();
    }
  }, 30_000);

  afterAll(() => undefined);

  it.each(programs)('executes $language in Judge0 with the expected result', async ({ language, source, input }) => {
    const outcome = await provider.execute({
      language,
      source,
      tests: [{ ordinal: 1, input, expectedOutput: '42\n' }],
      timeLimitMs: 3000,
      memoryLimitMb: 128,
    });
    expect(outcome.provider).toBe('judge0');
    expect(outcome.verdict, JSON.stringify(outcome)).toBe('ACCEPTED');
    expect(outcome.tests).toHaveLength(1);
  }, 150_000);

  it('executes a hidden-case-shaped input independently without exposing its expected result', async () => {
    const outcome = await provider.execute({
      language: 'PYTHON',
      source: 'n = int(input())\nprint(n * 2)',
      tests: [
        { ordinal: 1, input: '0\n', expectedOutput: '0\n' },
        { ordinal: 2, input: '987654\n', expectedOutput: '1975308\n' },
      ],
      timeLimitMs: 3000,
      memoryLimitMb: 128,
    });
    expect(outcome.verdict, JSON.stringify(outcome)).toBe('ACCEPTED');
    expect(outcome.tests.map((test) => test.ordinal)).toEqual([1, 2]);
  }, 150_000);
});
