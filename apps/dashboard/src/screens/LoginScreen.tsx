import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useTheme } from '../lib/theme';
import { Field } from '../components/ui';

export function LoginScreen() {
  const { signIn, verify, message, error, sending, verifying, clearMessages } = useAuth();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');

  const onSend = async (event: FormEvent) => {
    event.preventDefault();
    clearMessages();
    await signIn(email.trim());
    setStep('code');
  };

  const onVerify = async (event: FormEvent) => {
    event.preventDefault();
    await verify(email.trim(), code.trim());
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand" style={{ color: 'var(--foreground)' }}>
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span>PLATFORM</span>
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            Email one-time codes. No password is stored by this dashboard.
          </p>
        </div>

        {error ? (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="notice notice-info" role="status">
            {message}
          </div>
        ) : null}

        {step === 'email' ? (
          <form className="form-stack" onSubmit={onSend}>
            <Field label="Email address" htmlFor="login-email">
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={sending || !email.trim()}>
              {sending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form className="form-stack" onSubmit={onVerify}>
            <Field label="One-time code" htmlFor="login-code" hint={`Sent to ${email.trim() || 'your email address'}`}>
              <input
                id="login-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={verifying || !code.trim()}>
                {verifying ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  clearMessages();
                  setStep('email');
                  setCode('');
                }}
              >
                Use another email
              </button>
            </div>
          </form>
        )}

        <div className="auth-footer">
          <span>Static dashboard · access controlled by database policies</span>
          <button type="button" className="btn btn-small" onClick={toggle}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
    </div>
  );
}
