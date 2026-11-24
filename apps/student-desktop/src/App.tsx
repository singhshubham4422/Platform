import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { User, Assignment, Question } from './types';
import { getStoredUser, clearAuthTokens } from './lib/api';
import { flushLocalWrites, flushOutbox, initOutbox, outboxCounts, startBackgroundSync } from './lib/outbox';
import { Sidebar, type AppSection } from './components/Sidebar';
import { Login } from './components/Login';
import { Dashboard, type StudentSection } from './components/Dashboard';
import { CoursesView, MyResultsView, NotificationsView, PracticeView, StudentSettings } from './workspace/StudentViews';
import { fetchNotifications } from './lib/coding-api';
import { PlatformHome } from './platform/PlatformHome';

interface OpenQuestion {
  questionId: string;
  assignmentId: string | null;
  courseId: string | null;
  returnTo: AppSection;
}

const DASHBOARD_SECTIONS: StudentSection[] = ['overview', 'classes', 'learning', 'assessments', 'assignments', 'progress', 'library', 'help'];
const ProgrammingWorkspace = lazy(() =>
  import('./workspace/ProgrammingWorkspace').then((module) => ({ default: module.ProgrammingWorkspace })),
);

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [section, setSection] = useState<AppSection>('overview');
  const [open, setOpen] = useState<OpenQuestion | null>(null);
  const [pending, setPending] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    // Local SQLite store first (drafts/outbox), then the stored session.
    initOutbox()
      .catch((e) => console.error('[app] local store unavailable', e))
      .then(() => getStoredUser())
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      setSection('overview');
      setOpen(null);
    };
    window.addEventListener('lp-auth-expired', handleExpired);
    return () => window.removeEventListener('lp-auth-expired', handleExpired);
  }, []);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // Outbox: drafts, code history, activity and queued submissions sync in the background.
  useEffect(() => {
    if (!user) return;
    const update = () => {
      const c = outboxCounts();
      setPending(c.events + c.snapshots + c.submissions + c.unsyncedDrafts);
    };
    update();
    window.addEventListener('lp-outbox-changed', update);
    const stop = startBackgroundSync();
    const refreshUnread = () =>
      fetchNotifications()
        .then((n) => setUnread(n.unread))
        .catch(() => undefined);
    void refreshUnread();
    const t = window.setInterval(refreshUnread, 60_000);
    return () => {
      stop();
      window.clearInterval(t);
      window.removeEventListener('lp-outbox-changed', update);
    };
  }, [user]);

  function goTo(next: AppSection) {
    setSection(next);
    setOpen(null);
  }

  function logout() {
    void flushLocalWrites()
      .then(() => flushOutbox())
      .catch(() => undefined)
      .finally(() => void clearAuthTokens());
    setUser(null);
    goTo('overview');
  }

  function openAssignmentQuestion(assignment: Assignment, question: Question) {
    setOpen({ questionId: question.id, assignmentId: assignment.id, courseId: null, returnTo: 'assignments' });
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="brand-mark">LP</span>
        <p>Opening Student Workspace…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onSuccess={(authenticatedUser) => {
          setUser(authenticatedUser);
          goTo('overview');
        }}
      />
    );
  }

  return (
    <div className="hr-app hr-app-sidebar">
      <Sidebar
        user={user}
        active={open ? 'workspace' : section}
        isOnline={isOnline}
        pendingSync={pending}
        unread={unread}
        onNavigate={goTo}
        onSync={() => flushOutbox().catch(() => undefined)}
        onLogout={logout}
      />
      <main className="hr-main">
        {open ? (
          <Suspense fallback={<div className="loading-screen"><span className="brand-mark">LP</span><p>Loading programming workspace…</p></div>}>
            <ProgrammingWorkspace
              key={`${open.questionId}-${open.assignmentId ?? ''}`}
              questionId={open.questionId}
              assignmentId={open.assignmentId}
              courseId={open.courseId}
              isOnline={isOnline}
              onBack={() => goTo(open.returnTo)}
            />
          </Suspense>
        ) : section === 'challenges' ? (
          <PracticeView onOpen={(questionId) => setOpen({ questionId, assignmentId: null, courseId: null, returnTo: 'challenges' })} />
        ) : section === 'courses' ? (
          <CoursesView isOnline={isOnline} />
        ) : section === 'notifications' ? (
          <NotificationsView />
        ) : section === 'results' ? (
          <MyResultsView user={user} />
        ) : section === 'settings' ? (
          <StudentSettings user={user} isOnline={isOnline} onLogout={logout} />
        ) : section === 'workspace' ? (
          <PracticeView onOpen={(questionId) => setOpen({ questionId, assignmentId: null, courseId: null, returnTo: 'workspace' })} />
        ) : section === 'platform' && import.meta.env.VITE_OFFLINE_FIRST === '1' ? (
          <PlatformHome />
        ) : (
          <Dashboard
            user={user}
            section={DASHBOARD_SECTIONS.includes(section as StudentSection) ? (section as StudentSection) : 'overview'}
            onNavigate={(s) => goTo(s)}
            onSelectAssignment={openAssignmentQuestion}
            isOnline={isOnline}
            onSync={() => flushOutbox().catch(() => undefined)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
