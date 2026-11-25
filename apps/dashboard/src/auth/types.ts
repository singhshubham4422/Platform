import type { Profile } from '../data/types';

export interface AuthService {
  signInWithOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<void>;
  loadProfile(): Promise<Profile | null>;
  signOut(): Promise<void>;
  hasSession(): Promise<boolean>;
}

export const GENERIC_OTP_MESSAGE = 'If this email is registered, a code has been sent';
