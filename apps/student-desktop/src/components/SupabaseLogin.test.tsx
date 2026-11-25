// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GENERIC_SENT, SupabaseLogin } from './SupabaseLogin';

afterEach(cleanup);

function fakeClient(role: string, status = 'ACTIVE', otpError = false) {
  const signOut = vi.fn(async () => ({ error: null }));
  const signInWithOtp = vi.fn(async () => (otpError ? { error: { message: 'Signups not allowed for otp' } } : { error: null }));
  const client = {
    auth: {
      signInWithOtp,
      verifyOtp: vi.fn(async () => ({ error: null })),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: 'u1', email: 'a@college.edu', full_name: 'A B', role, organization_id: 'o1', status }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, signOut, signInWithOtp };
}

async function signIn(client: SupabaseClient, onSuccess = vi.fn()) {
  render(<SupabaseLogin client={client} onSuccess={onSuccess} />);
  fireEvent.change(screen.getByLabelText('College e-mail address'), { target: { value: 'a@college.edu' } });
  fireEvent.click(screen.getByRole('button', { name: 'E-mail me a sign-in code' }));
  await screen.findByText(GENERIC_SENT);
  fireEvent.change(screen.getByLabelText('Code from your e-mail'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
  return onSuccess;
}

describe('SupabaseLogin', () => {
  it('shows the same message whether or not the e-mail exists', async () => {
    const { client, signInWithOtp } = fakeClient('STUDENT', 'ACTIVE', true);
    render(<SupabaseLogin client={client} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('College e-mail address'), { target: { value: 'nobody@college.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'E-mail me a sign-in code' }));
    expect(await screen.findByText(GENERIC_SENT)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'nobody@college.edu', options: { shouldCreateUser: false } });
  });

  it('signs in an active student', async () => {
    const { client } = fakeClient('STUDENT');
    const onSuccess = await signIn(client);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', role: 'STUDENT', organizationId: 'o1' })));
  });

  it('rejects teachers and signs them out', async () => {
    const { client, signOut } = fakeClient('TEACHER');
    const onSuccess = await signIn(client);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('web dashboard'));
    expect(signOut).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('rejects disabled accounts', async () => {
    const { client, signOut } = fakeClient('STUDENT', 'DISABLED');
    await signIn(client);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('not active'));
    expect(signOut).toHaveBeenCalled();
  });
});
