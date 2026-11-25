import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '../data/types';
import { ApiError } from '../data/source';
import type { AuthService } from './types';

export class SupabaseAuthService implements AuthService {
  private readonly sb: SupabaseClient;

  constructor(sb: SupabaseClient) {
    this.sb = sb;
  }

  async signInWithOtp(email: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw new ApiError(400, 'OTP_SEND_FAILED', error.message);
  }

  async verifyOtp(email: string, token: string): Promise<void> {
    const { error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw new ApiError(400, 'OTP_INVALID', error.message);
  }

  async loadProfile(): Promise<Profile | null> {
    const user = await this.sb.auth.getUser();
    if (user.error || !user.data.user) return null;
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', user.data.user.id).maybeSingle();
    if (error) throw new ApiError(400, 'PROFILE_UNAVAILABLE', error.message);
    return (data as Profile | null) ?? null;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  async hasSession(): Promise<boolean> {
    const { data } = await this.sb.auth.getSession();
    return Boolean(data.session);
  }
}
