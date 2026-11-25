import React, { useState } from 'react';
import { AlertCircle, Lock, Mail } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, loadProfile, type StudentProfile } from '../lib/supabase-client';

// One message whether or not the address is registered, so the form reveals no accounts.
export const GENERIC_SENT = 'If this e-mail is registered, a sign-in code has been sent.';

interface Props {
  onSuccess: (profile: StudentProfile) => void;
  client?: SupabaseClient;
}

/** Offline-first sign-in: Supabase Auth e-mail OTP. Only active STUDENT profiles may use the desktop app. */
export const SupabaseLogin: React.FC<Props> = ({ onSuccess, client }) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const sb = client ?? getSupabase();
    try {
      if (!sent) {
        // Errors such as "user not found" are deliberately not shown (no account enumeration).
        await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } }).catch(() => undefined);
        setSent(true);
        setInfo(GENERIC_SENT);
        return;
      }
      const { error: verifyError } = await sb.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
      if (verifyError) {
        setError('That code is not valid or has expired. Request a new one.');
        return;
      }
      const profile = await loadProfile(sb);
      if (!profile || profile.status !== 'ACTIVE') {
        await sb.auth.signOut();
        setError('This account is not active. Contact your college administrator.');
        return;
      }
      if (profile.role !== 'STUDENT') {
        await sb.auth.signOut();
        setError('This app is for students. Teachers and administrators should use the web dashboard.');
        return;
      }
      onSuccess(profile);
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <main className="login-grid" style={{ gridTemplateColumns: 'minmax(0, 460px)', justifyContent: 'center' }}>
        <section className="login-card">
          <div className="login-card-header">
            <span className="eyebrow">Student Sign In</span>
            <h2>Welcome</h2>
            <p className="muted-text">Use the e-mail address your college enrolled you with. You only need to be online to sign in and to sync; everything else works offline.</p>
          </div>
          {error && (
            <div className="inline-banner danger" role="alert" style={{ marginBottom: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={16} />
                {error}
              </span>
            </div>
          )}
          {info && !error && (
            <div className="inline-banner" role="status" style={{ marginBottom: 14 }}>
              {info}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="form-field">
              <label htmlFor="sb-email">College e-mail address</label>
              <div className="input-with-icon">
                <Mail size={15} className="leading-icon" />
                <input id="sb-email" type="email" className="input-control" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={sent} autoComplete="email" />
              </div>
            </div>
            {sent && (
              <div className="form-field">
                <label htmlFor="sb-code">Code from your e-mail</label>
                <div className="input-with-icon">
                  <Lock size={15} className="leading-icon" />
                  <input
                    id="sb-code"
                    inputMode="numeric"
                    maxLength={10}
                    className="input-control"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                    required
                    autoFocus
                    autoComplete="one-time-code"
                  />
                </div>
              </div>
            )}
            <button type="submit" className="btn btn-primary login-submit-btn" disabled={busy}>
              {busy ? 'Please wait…' : sent ? 'Verify and sign in' : 'E-mail me a sign-in code'}
            </button>
            {sent && (
              <div className="login-alt-links">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setSent(false);
                    setCode('');
                    setInfo('');
                  }}
                >
                  Use a different e-mail
                </button>
              </div>
            )}
          </form>
        </section>
      </main>
    </div>
  );
};
