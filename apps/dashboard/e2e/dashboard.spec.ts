import { expect, test, type Page } from '@playwright/test';

type Role = 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'PLATFORM_OWNER';

const EMAIL: Record<Role, string> = {
  STUDENT: 'student@dashboard.test',
  TEACHER: 'teacher@dashboard.test',
  COLLEGE_ADMIN: 'admin@dashboard.test',
  PLATFORM_OWNER: 'owner@dashboard.test',
};

const COURSE = '77777777-7777-4777-8777-777777777777';
const CLASS = '12121212-1212-4212-8212-121212121212';
const QUESTION = '88888888-8888-4888-8888-888888888881';
const ASSESSMENT = '99999999-9999-4999-8999-999999999991';
const SUBMISSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STUDENT = '22222222-2222-4222-8222-222222222221';

const ROUTES: Record<Role, Array<{ path: string; expect: RegExp }>> = {
  STUDENT: [
    { path: '/student', expect: /Welcome, Asha Student/ },
    { path: '/student/topics', expect: /^Topics/ },
    { path: '/student/submissions', expect: /^Submissions/ },
    { path: `/student/submissions/${SUBMISSION}`, expect: /PYTHON submission/ },
    { path: '/student/assessments', expect: /^Assessments/ },
  ],
  TEACHER: [
    { path: '/teacher', expect: /^Classes/ },
    { path: `/teacher/classes/${CLASS}`, expect: /CSE 2026 A/ },
    { path: `/teacher/classes/${CLASS}/students/${STUDENT}`, expect: /Asha Student/ },
    { path: `/teacher/review/${SUBMISSION}`, expect: /Review submission/ },
    { path: '/teacher/courses', expect: /^Courses/ },
    { path: `/teacher/courses/${COURSE}`, expect: /Data Structures and Algorithms/ },
    { path: `/teacher/courses/${COURSE}/questions/${QUESTION}`, expect: /Two Sum/ },
    { path: '/teacher/assessments', expect: /^Assessments/ },
    { path: `/teacher/assessments/${ASSESSMENT}`, expect: /Mid-semester assessment/ },
  ],
  COLLEGE_ADMIN: [
    { path: '/admin', expect: /Organization overview/ },
    { path: '/admin/departments', expect: /^Departments/ },
    { path: '/admin/classes', expect: /^Classes/ },
    { path: `/admin/classes/${CLASS}`, expect: /CSE 2026 A/ },
  ],
  PLATFORM_OWNER: [
    { path: '/owner', expect: /^Organizations/ },
    { path: '/owner/courses', expect: /Platform-wide practice courses/ },
  ],
};

async function open(page: Page, role: Role, path: string, theme: 'light' | 'dark') {
  await page.addInitScript(
    ([email, storedTheme]) => {
      window.localStorage.setItem('lplatform.mock.session', String(email));
      window.localStorage.setItem('lplatform.dashboard.theme', String(storedTheme));
    },
    [EMAIL[role], theme],
  );
  await page.goto(`/#${path}`);
}

test.describe('every role, light and dark, desktop and mobile', () => {
  for (const role of Object.keys(ROUTES) as Role[]) {
    for (const route of ROUTES[role]) {
      for (const viewport of [
        { name: 'desktop', width: 1280, height: 800 },
        { name: 'mobile', width: 390, height: 844 },
      ]) {
        for (const theme of ['light', 'dark'] as const) {
          test(`${role} ${route.path} ${viewport.name} ${theme}`, async ({ page }) => {
            const errors: string[] = [];
            page.on('console', (message) => {
              if (message.type() === 'error') errors.push(message.text());
            });
            page.on('pageerror', (error) => errors.push(error.message));
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await open(page, role, route.path, theme);
            await expect(page.locator('main h1').first()).toContainText(route.expect, { timeout: 15_000 });
            const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
            expect(isDark).toBe(theme === 'dark');

            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);

            const name = `${role}-${route.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-${viewport.name}-${theme}`;
            await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
            expect(errors, errors.join('\n')).toEqual([]);
          });
        }
      }
    }
  }
});

test('login page renders without configuration', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
