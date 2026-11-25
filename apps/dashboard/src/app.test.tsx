import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_OTP_MESSAGE } from './auth/types';
import { NotConfiguredScreen } from './screens/NotConfiguredScreen';
import { createRuntime } from './runtime';
import { renderApp, Root } from './test/harness';
import { MOCK_SESSION_KEY, MOCK_CODE } from './test/mock-runtime';
import { MOCK_EMAILS } from './test/mock-data';

describe('login', () => {
  it('shows the same generic message for any email address', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email address'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(GENERIC_OTP_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/not registered/i)).toBeNull();
  });

  it('signs in a known email with the test code', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email address'), MOCK_EMAILS.STUDENT);
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('One-time code'), MOCK_CODE);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: /Welcome, Asha Student/ })).toBeTruthy();
    expect(window.localStorage.getItem(MOCK_SESSION_KEY)).toBe(MOCK_EMAILS.STUDENT);
  });

  it('rejects a wrong code with a generic error', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email address'), MOCK_EMAILS.STUDENT);
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('One-time code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That code is not valid')).toBeTruthy();
  });

  it('signs out a disabled profile', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email address'), MOCK_EMAILS.DISABLED);
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('One-time code'), MOCK_CODE);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Account not active')).toBeTruthy();
    expect(window.localStorage.getItem(MOCK_SESSION_KEY)).toBeNull();
  });

  it('signs out a restored disabled session', async () => {
    await renderApp({ email: 'DISABLED' });
    expect(await screen.findByText('Account not active')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull();
  });
});

describe('role routing', () => {
  const homes = [
    { email: 'STUDENT' as const, heading: /Welcome, Asha Student/ },
    { email: 'TEACHER' as const, heading: 'Classes' },
    { email: 'COLLEGE_ADMIN' as const, heading: 'Organization overview' },
    { email: 'PLATFORM_OWNER' as const, heading: 'Organizations' },
  ];

  for (const home of homes) {
    it(`sends ${home.email} to their home page`, async () => {
      await renderApp({ email: home.email });
      expect(await screen.findByRole('heading', { level: 1, name: home.heading })).toBeTruthy();
    });
  }

  it('redirects an unknown hash to the role home', async () => {
    await renderApp({ email: 'TEACHER', hash: '#/student/submissions' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Classes' })).toBeTruthy();
  });
});

describe('home pages with data', () => {
  it('student home shows activity and submissions', async () => {
    await renderApp({ email: 'STUDENT' });
    expect(await screen.findByRole('heading', { name: /Welcome, Asha Student/ })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Active minutes' })).toBeTruthy();
    expect(await screen.findByText('PYTHON · 2/2 tests')).toBeTruthy();
  });

  it('teacher home lists the teacher class', async () => {
    await renderApp({ email: 'TEACHER' });
    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeTruthy();
    expect(await screen.findByText('CSE 2026 A')).toBeTruthy();
  });

  it('admin home shows organization stats', async () => {
    await renderApp({ email: 'COLLEGE_ADMIN' });
    expect(await screen.findByRole('heading', { name: 'Organization overview' })).toBeTruthy();
    expect((await screen.findAllByText('Departments')).length).toBeGreaterThan(0);
  });

  it('owner home lists organizations', async () => {
    await renderApp({ email: 'PLATFORM_OWNER' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Organizations' })).toBeTruthy();
    expect((await screen.findAllByText('Northfield College')).length).toBeGreaterThan(0);
  });
});

describe('home pages with empty data', () => {
  it('student home shows the empty activity state', async () => {
    await renderApp({ email: 'STUDENT', scenario: 'empty' });
    expect(await screen.findByText('No activity recorded yet')).toBeTruthy();
    expect(await screen.findByText('No submissions yet')).toBeTruthy();
  });

  it('teacher home shows the empty class state', async () => {
    await renderApp({ email: 'TEACHER', scenario: 'empty' });
    expect(await screen.findByText('No classes yet')).toBeTruthy();
  });

  it('admin home shows the empty KPI state', async () => {
    await renderApp({ email: 'COLLEGE_ADMIN', scenario: 'empty' });
    expect((await screen.findAllByText('No KPI rows yet')).length).toBeGreaterThan(0);
  });

  it('owner home shows the empty organization state', async () => {
    await renderApp({ email: 'PLATFORM_OWNER', scenario: 'empty' });
    expect(await screen.findByText('No organizations')).toBeTruthy();
  });
});

describe('student submission detail', () => {
  it('never renders hidden test data even when the source returns it', async () => {
    const runtime = await createRuntime({ MODE: 'test', VITE_DATA_SOURCE: 'mock' });
    if (!runtime.ok) throw new Error('mock runtime unavailable');
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_SESSION_KEY, MOCK_EMAILS.STUDENT);
    window.location.hash = '#/student/submissions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const base = runtime.source;
    const leaky = {
      ...base,
      studentSubmission: async (userId: string, submissionId: string) => {
        const detail = await base.studentSubmission(userId, submissionId);
        return {
          ...detail,
          results: [
            ...detail.results,
            {
              testId: 'HIDDEN_SECRET_ID',
              hidden: true,
              verdict: 'ACCEPTED' as const,
              timeMs: 10,
              memoryKb: 10,
              stdout: 'HIDDEN_SECRET_OUTPUT',
              stderr: null,
              expectedOutput: 'HIDDEN_SECRET_EXPECTED',
              input: 'HIDDEN_SECRET_INPUT',
            },
          ],
        };
      },
    };
    render(<Root runtime={{ ...runtime, source: leaky }} />);
    expect(await screen.findByRole('heading', { name: 'PYTHON submission' })).toBeTruthy();
    expect(screen.queryByText(/HIDDEN_SECRET/)).toBeNull();
    expect(screen.getByText('v1')).toBeTruthy();
  });
});

describe('publish errors', () => {
  it('shows the code and message of a 409 assessment publish', async () => {
    const user = userEvent.setup();
    await renderApp({ email: 'TEACHER', scenario: 'publish-409', hash: '#/teacher/courses/77777777-7777-4777-8777-777777777777' });
    expect(await screen.findByRole('heading', { name: 'Data Structures and Algorithms' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Publish pack' }));
    expect(await screen.findByText(/ASSESSMENT_STARTED/)).toBeTruthy();
  });
});

describe('runtime configuration', () => {
  it('reports NOT_CONFIGURED with no project and no fallback', async () => {
    const runtime = await createRuntime({ MODE: 'production' });
    expect(runtime).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    render(<NotConfiguredScreen reason="NOT_CONFIGURED" />);
    expect(screen.getByRole('heading', { name: 'Not configured' })).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
  });

  it('refuses the mock source in a production build', async () => {
    vi.stubEnv('MODE', 'production');
    const runtime = await createRuntime({ MODE: 'production', VITE_DATA_SOURCE: 'mock' });
    expect(runtime).toEqual({ ok: false, reason: 'MOCK_OUTSIDE_TEST' });
    render(<NotConfiguredScreen reason="MOCK_OUTSIDE_TEST" />);
    expect(screen.getByRole('heading', { name: 'Configuration refused' })).toBeTruthy();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
