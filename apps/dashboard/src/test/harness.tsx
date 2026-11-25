import { render } from '@testing-library/react';
import { Root } from '../App';
export { Root };
import { createRuntime, type Runtime } from '../runtime';
import { MOCK_SCENARIO_KEY, MOCK_SESSION_KEY } from './mock-runtime';
import { MOCK_EMAILS } from './mock-data';
import type { Role } from '../data/types';

export type MockEmail = Role | 'DISABLED';

export async function renderApp(options: { email?: MockEmail; scenario?: 'empty' | 'publish-409'; hash?: string } = {}) {
  window.localStorage.clear();
  if (options.scenario) window.localStorage.setItem(MOCK_SCENARIO_KEY, options.scenario);
  if (options.email) window.localStorage.setItem(MOCK_SESSION_KEY, MOCK_EMAILS[options.email]);
  window.location.hash = options.hash ?? '';
  const runtime = await createRuntime({ MODE: 'test', VITE_DATA_SOURCE: 'mock' });
  if (!runtime.ok) throw new Error(`mock runtime unavailable: ${runtime.reason}`);
  const view = render(<Root runtime={runtime} />);
  return { ...view, runtime };
}

export { createRuntime };
export type { Runtime };
