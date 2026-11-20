import React, { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Code2,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  Mail,
  Server,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { CAN_CONFIGURE_SERVER, getApiBaseUrl, login, requestOtp, setApiBaseUrl, verifyOtp } from '../lib/api';
import type { User } from '../types';

interface LoginProps {
  onSuccess: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [backendUrl, setBackendUrl] = useState(getApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState('');

  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      setApiBaseUrl(backendUrl.trim() || 'http://localhost:3001');
      if (!otpSent) {
        const res = await requestOtp(email.trim());
        setOtpSent(true);
        setInfo(`${res.message} The code expires in ${res.expiresInMinutes} minutes.`);
      } else {
        const ua = navigator.userAgent;
        const device = ua.includes('Windows') ? 'Windows desktop' : ua.includes('Mac') ? 'macOS desktop' : 'Desktop';
        const data = await verifyOtp(email.trim(), code.trim(), device);
        onSuccess(data.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const normalizedUrl = backendUrl.trim() || 'http://localhost:3001';
      setApiBaseUrl(normalizedUrl);
      const data = await login(email.trim(), password);
      onSuccess(data.user);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Unable to sign in. Check your credentials or server.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (studentEmail: string) => {
    if (!import.meta.env.DEV) return;
    setMode('password');
    setEmail(studentEmail);
    setPassword('Student@123');
    setError('');
  };

  return (
    <div className="login-shell">
      <header className="login-topbar">
        <div className="login-brand">
          <span className="brand-mark">LP</span>
          <div className="login-brand-text">
            <strong>L Platform</strong>
            <span>Student app</span>
          </div>
        </div>
        {CAN_CONFIGURE_SERVER && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowServerConfig((v) => !v)}
          >
            <Server size={14} />
            <span>{showServerConfig ? 'Hide Server URL' : 'Server Configuration'}</span>
          </button>
        )}
      </header>

      <main className="login-grid">
        <section className="login-hero">
          <span className="pill pill-violet">
            <Sparkles size={12} />
            Student Learning &amp; Coding Environment
          </span>
          <h1>
            Learn, Code, and Master Skills{' '}
            <span className="gradient-phrase">in One Workspace</span>
          </h1>
          <p className="login-hero-copy">
            Open your college courses, complete assignments and tests, and write Python, C, C++ and
            Java in a full code editor. Programs run on your college judge, so there is nothing to install.
          </p>

          <div className="login-features">
            <div className="login-feature-item">
              <div className="login-feature-icon">
                <BookOpen size={16} />
              </div>
              <div>
                <strong>Structured Courses</strong>
                <span>Free platform courses &amp; school curriculum modules</span>
              </div>
            </div>

            <div className="login-feature-item">
              <div className="login-feature-icon">
                <Code2 size={16} />
              </div>
              <div>
                <strong>Multi-Language IDE</strong>
                <span>Python, C, C++ and Java with remote judging</span>
              </div>
            </div>

            <div className="login-feature-item">
              <div className="login-feature-icon">
                <GraduationCap size={16} />
              </div>
              <div>
                <strong>Assessments &amp; Grades</strong>
                <span>Autosaved attempts and teacher rubric feedback</span>
              </div>
            </div>

            <div className="login-feature-item">
              <div className="login-feature-icon">
                <WifiOff size={16} />
              </div>
              <div>
                <strong>Offline Resilience</strong>
                <span>Drafts and downloaded course files work offline</span>
              </div>
            </div>
          </div>
        </section>

        <section className="login-card">
          <div className="login-card-header">
            <span className="eyebrow">Student Sign In</span>
            <h2>Welcome back</h2>
            <p className="muted-text">
              Use the e-mail address your college enrolled you with. We send a one-time code; this device stays signed in until you sign out or revoke it in Settings.
            </p>
          </div>

          {error && (
            <div className="inline-banner danger" role="alert" style={{ marginBottom: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={16} />
                {error}
              </span>
            </div>
          )}

          {info && mode === 'otp' && (
            <div className="inline-banner" role="status" style={{ marginBottom: 14 }}>
              {info}
            </div>
          )}

          {mode === 'otp' ? (
            <form onSubmit={handleOtp}>
              <div className="form-field">
                <label htmlFor="otp-email">College e-mail address</label>
                <div className="input-with-icon">
                  <Mail size={15} className="leading-icon" />
                  <input
                    id="otp-email"
                    type="email"
                    className="input-control"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.edu"
                    required
                    disabled={otpSent}
                    autoComplete="email"
                  />
                </div>
              </div>
              {otpSent && (
                <div className="form-field">
                  <label htmlFor="otp-code">6-digit code from your e-mail</label>
                  <div className="input-with-icon">
                    <Lock size={15} className="leading-icon" />
                    <input
                      id="otp-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      className="input-control"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="000000"
                      required
                      autoFocus
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>
              )}
              <button type="submit" className="btn btn-primary login-submit-btn" disabled={loading}>
                {loading ? 'Please wait…' : otpSent ? 'Verify and sign in' : 'E-mail me a sign-in code'}
              </button>
              <div className="login-alt-links">
                {otpSent ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setOtpSent(false);
                      setCode('');
                      setInfo('');
                    }}
                  >
                    Use a different e-mail
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMode('password');
                    setError('');
                  }}
                >
                  Sign in with a password instead
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="student-email">Email Address</label>
              <div className="input-with-icon">
                <Mail size={15} className="leading-icon" />
                <input
                  id="student-email"
                  type="email"
                  className="input-control"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@school.edu"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="student-password">Password</label>
              <div className="input-with-icon">
                <Lock size={15} className="leading-icon" />
                <input
                  id="student-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {CAN_CONFIGURE_SERVER && showServerConfig && (
              <div className="server-config-box">
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="backend-url-input">L_Platform API Endpoint</label>
                  <input
                    id="backend-url-input"
                    type="url"
                    className="input-control"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="http://localhost:3001"
                  />
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary login-submit-btn" disabled={loading}>
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
            <div className="login-alt-links">
              <span />
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setMode('otp');
                  setError('');
                }}
              >
                Sign in with an e-mail code
              </button>
            </div>
          </form>
          )}

          {import.meta.env.DEV && (
            <div className="quick-accounts">
              <span className="quick-accounts-label">Local Seeded Student Accounts</span>
              <div className="quick-account-grid">
                <button
                  type="button"
                  className="quick-account-btn"
                  onClick={() => handleQuickFill('student1@demo-college.test')}
                >
                  <strong>Rohan (Demo college)</strong>
                  <span>student1@demo-college.test</span>
                </button>
                <button
                  type="button"
                  className="quick-account-btn"
                  onClick={() => handleQuickFill('student1@riverside.edu')}
                >
                  <strong>Alice (Riverside demo)</strong>
                  <span>student1@riverside.edu</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {CAN_CONFIGURE_SERVER && (
        <footer className="login-topbar" style={{ justifyContent: 'center' }}>
          <span className="muted-text" style={{ fontSize: 12 }}>
            Development server: <code>{backendUrl}</code>
          </span>
        </footer>
      )}
    </div>
  );
};
