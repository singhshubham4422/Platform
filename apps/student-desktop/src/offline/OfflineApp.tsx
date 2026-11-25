import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ClipboardCheck, LogOut } from 'lucide-react';
import { SupabaseLogin } from '../components/SupabaseLogin';
import { SyncStatus } from '../components/SyncStatus';
import { AssessmentView } from '../platform/AssessmentView';
import { PlatformHome } from '../platform/PlatformHome';
import { getSupabase, loadProfile, type StudentProfile } from '../lib/supabase-client';
import { flushActivity, queueActivity, setActivityIdentity } from '../lib/activity-queue';
import { getOfflineSync } from '../lib/offline-runtime';
import { offlineConfig } from '../lib/offline-config';
import { getCursor, setCursor } from '../lib/offline-store';

const PROFILE_CURSOR = 'profile:v1';

type Section = 'platform' | 'assessments';

const APP_VERSION = '0.5.0';

/** Offline-first shell (VITE_OFFLINE_FIRST=1): Supabase sign-in, Platform, and the sync engine. */
export const OfflineApp: React.FC = () => {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [section, setSection] = useState<Section>('platform');
  const sessionStart = useRef(0);

  useEffect(() => {
    try {
      offlineConfig();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      return;
    }
    // A stored session works offline: loadProfile needs the network, so when offline the
    // profile cached locally at the last online sign-in is used (display only; the server
    // still decides every permission when syncing).
    void (async () => {
      try {
        const p = navigator.onLine ? await loadProfile() : null;
        if (p && p.status === 'ACTIVE' && p.role === 'STUDENT') {
          setProfile(p);
          await setCursor(PROFILE_CURSOR, JSON.stringify(p)).catch(() => undefined);
        } else if (!navigator.onLine) {
          const { data } = await getSupabase().auth.getSession();
          const u = data.session?.user;
          const cached = JSON.parse((await getCursor(PROFILE_CURSOR).catch(() => null)) ?? 'null') as StudentProfile | null;
          if (u && cached?.id === u.id) setProfile(cached);
        }
      } catch {
        /* signed out */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    setActivityIdentity({ userId: profile.id, organizationId: profile.organizationId });
    sessionStart.current = Date.now();
    queueActivity('session_started', {}, { appVersion: APP_VERSION });
    const stop = getOfflineSync().start();
    const end = () => {
      queueActivity('session_ended', {}, { durationMs: Date.now() - sessionStart.current });
      void flushActivity();
    };
    window.addEventListener('beforeunload', end);
    return () => {
      window.removeEventListener('beforeunload', end);
      stop();
    };
  }, [profile]);

  async function logout() {
    queueActivity('session_ended', {}, { durationMs: Date.now() - sessionStart.current });
    await flushActivity();
    await getOfflineSync()
      .syncNow()
      .catch(() => undefined);
    setActivityIdentity(null);
    await setCursor(PROFILE_CURSOR, 'null').catch(() => undefined);
    await getSupabase()
      .auth.signOut()
      .catch(() => undefined);
    setProfile(null);
  }

  if (configError) {
    return (
      <div className="loading-screen">
        <span className="brand-mark">LP</span>
        <p role="alert">This build is not configured for online sync. {configError}</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="loading-screen">
        <span className="brand-mark">LP</span>
        <p>Opening Student Workspace…</p>
      </div>
    );
  }
  if (!profile) {
    return (
      <SupabaseLogin
        onSuccess={(p) => {
          // Keep a local copy of the profile so the app opens offline next time.
          void setCursor(PROFILE_CURSOR, JSON.stringify(p)).catch(() => undefined);
          setProfile(p);
        }}
      />
    );
  }

  return (
    <div className="hr-app hr-app-sidebar">
      <aside className="hr-sidebar" aria-label="Main navigation" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16 }}>
          <span className="brand-mark">LP</span>
          <p style={{ margin: '8px 0 0', fontWeight: 600 }}>{profile.fullName}</p>
          <p className="muted-text" style={{ margin: 0, fontSize: 12 }}>
            {profile.email}
          </p>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px' }}>
          <button className={`btn ${section === 'platform' ? 'btn-primary' : ''}`} aria-current={section === 'platform' ? 'page' : undefined} onClick={() => setSection('platform')}>
            <BookOpen size={15} /> Platform
          </button>
          <button className={`btn ${section === 'assessments' ? 'btn-primary' : ''}`} aria-current={section === 'assessments' ? 'page' : undefined} onClick={() => setSection('assessments')}>
            <ClipboardCheck size={15} /> Assessments
          </button>
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <SyncStatus engine={getOfflineSync()} />
          <button className="btn" style={{ margin: 12 }} onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="hr-main">
        {section === 'platform' && <PlatformHome />}
        {section === 'assessments' && <AssessmentView />}
      </main>
    </div>
  );
};
