import type { AuthService } from '../auth/types';
import type { Profile } from '../data/types';
import { ApiError } from '../data/source';
import type { Runtime } from '../runtime';
import { createMockSource } from './mock-source';
import { profiles } from './mock-data';

export const MOCK_SESSION_KEY = 'platform.mock.session';
export const MOCK_SCENARIO_KEY = 'platform.mock.scenario';
export const MOCK_CODE = '123456';

function mockAuth(): AuthService {
  const read = () => {
    try {
      return window.localStorage.getItem(MOCK_SESSION_KEY);
    } catch {
      return null;
    }
  };
  const findProfile = (email: string): Profile | null => profiles.find((row) => row.email === email.trim().toLowerCase()) ?? null;

  return {
    async signInWithOtp() {
      // Deliberately succeeds for any address: the UI must show a generic message.
    },
    async verifyOtp(email, token) {
      if (token !== MOCK_CODE) throw new Error('Invalid token');
      const profile = findProfile(email);
      if (!profile) throw new Error('Invalid token');
      window.localStorage.setItem(MOCK_SESSION_KEY, profile.email);
    },
    async loadProfile() {
      const email = read();
      return email ? findProfile(email) : null;
    },
    async signOut() {
      window.localStorage.removeItem(MOCK_SESSION_KEY);
    },
    async hasSession() {
      return read() !== null;
    },
  };
}

export function createMockRuntime(): Runtime {
  let scenario: string | null = null;
  try {
    scenario = window.localStorage.getItem(MOCK_SCENARIO_KEY);
  } catch {
    scenario = null;
  }
  const publishError =
    scenario === 'publish-409'
      ? new ApiError(409, 'ASSESSMENT_STARTED', 'The assessment has already started and can no longer be republished')
      : null;
  return {
    ok: true,
    mode: 'mock',
    source: createMockSource({ empty: scenario === 'empty', publishError }),
    auth: mockAuth(),
  };
}
