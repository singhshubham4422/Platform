import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Profile } from '../data/types';
import { GENERIC_OTP_MESSAGE, type AuthService } from './types';

type AuthState = 'loading' | 'signed_out' | 'active';

interface AuthContextValue {
  state: AuthState;
  profile: Profile | null;
  message: string | null;
  error: string | null;
  sending: boolean;
  verifying: boolean;
  signIn(email: string): Promise<void>;
  verify(email: string, token: string): Promise<void>;
  signOut(): Promise<void>;
  clearMessages(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await service.hasSession())) {
          if (!cancelled) setState('signed_out');
          return;
        }
        const loaded = await service.loadProfile();
        if (cancelled) return;
        if (!loaded || loaded.status === 'DISABLED') {
          await service.signOut();
          if (!cancelled) {
            setError('Account not active');
            setState('signed_out');
          }
          return;
        }
        setProfile(loaded);
        setState('active');
      } catch {
        if (!cancelled) setState('signed_out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service]);

  const signIn = useCallback(
    async (email: string) => {
      setSending(true);
      setError(null);
      setMessage(null);
      try {
        await service.signInWithOtp(email);
      } catch {
        // Deliberately generic: an unknown address and a delivery problem look the same.
      } finally {
        setMessage(GENERIC_OTP_MESSAGE);
        setSending(false);
      }
    },
    [service],
  );

  const verify = useCallback(
    async (email: string, token: string) => {
      setVerifying(true);
      setError(null);
      try {
        await service.verifyOtp(email, token);
        const loaded = await service.loadProfile();
        if (!loaded || loaded.status === 'DISABLED') {
          await service.signOut();
          setError('Account not active');
          setState('signed_out');
          return;
        }
        setProfile(loaded);
        setMessage(null);
        setState('active');
      } catch {
        setError('That code is not valid');
      } finally {
        setVerifying(false);
      }
    },
    [service],
  );

  const signOut = useCallback(async () => {
    await service.signOut();
    setProfile(null);
    setMessage(null);
    setError(null);
    setState('signed_out');
  }, [service]);

  const clearMessages = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, profile, message, error, sending, verifying, signIn, verify, signOut, clearMessages }),
    [state, profile, message, error, sending, verifying, signIn, verify, signOut, clearMessages],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
