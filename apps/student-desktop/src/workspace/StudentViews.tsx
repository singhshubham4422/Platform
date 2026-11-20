import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  CloudDownload,
  ExternalLink,
  FileText,
  Laptop,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { LANGUAGES } from '@lplatform/language-config';
import type { CatalogCourse, User } from '../types';
import { fetchCoursesCatalog } from '../lib/api';
import {
  fetchMyProfile,
  fetchNotifications,
  fetchPractice,
  fetchSessions,
  markAllNotificationsRead,
  markNotificationRead,
  revokeSession,
  type AppNotification,
  type DeviceSession,
  type PackageResource,
  type PracticeItem,
  type StudentProfile,
} from '../lib/coding-api';
import { downloadCoursePackage, listStoredManifests, openOfflineResource, packageStatus, removeCoursePackage, type PackageStatus } from '../lib/offline-library';
import { flushOutbox, outboxCounts } from '../lib/outbox';
import { useEditorPreferences } from './preferences';
import { verdictLabel } from './verdict-label';
import './views.css';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

function State({ loading, error, onRetry, empty, children }: { loading: boolean; error: string | null; onRetry?: () => void; empty?: string | false; children: React.ReactNode }) {
  if (loading) return <div className="sv-state"><Loader2 className="ws-spin" size={20} /> Loading…</div>;
  if (error)
    return (
      <div className="sv-state sv-error" role="alert">
        {error}
        {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
      </div>
    );
  if (empty) return <div className="sv-state">{empty}</div>;
  return <>{children}</>;
}

// ---------------- Challenges / practice ----------------
export const PracticeView: React.FC<{ onOpen: (questionId: string) => void }> = ({ onOpen }) => {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, difficulty, topic, language, status]);
  const q = useAsync(() => fetchPractice({ search: debounced, difficulty, topic, language, status, page: String(page) }), [debounced, difficulty, topic, language, status, page]);
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1>Challenges</h1>
          <p className="sv-sub">Practice problems from your college and the platform bank. Runs use the college judge.</p>
        </div>
      </div>
      <div className="sv-filters">
        <label className="sv-search">
          <Search size={15} />
          <input aria-label="Search challenges" placeholder="Search by title or topic" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">All difficulties</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
        <select aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">All topics</option>
          {(q.data?.topics ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">Any language</option>
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="NEW">Not attempted</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="SOLVED">Solved</option>
        </select>
      </div>
      <State loading={q.loading} error={q.error} onRetry={q.reload} empty={q.data?.items.length === 0 && 'No challenges match these filters.'}>
        <div className="sv-table" role="table" aria-label="Challenges">
          <div className="sv-row sv-row-head" role="row">
            <span role="columnheader">Status</span>
            <span role="columnheader">Title</span>
            <span role="columnheader">Topic</span>
            <span role="columnheader">Difficulty</span>
            <span role="columnheader">Languages</span>
          </div>
          {(q.data?.items ?? []).map((item: PracticeItem) => (
            <button key={item.id} className="sv-row" role="row" onClick={() => onOpen(item.id)}>
              <span role="cell" title={item.solved ? 'Solved' : item.attempts ? 'In progress' : 'Not attempted'}>
                {item.solved ? <CheckCircle2 size={16} className="ws-ok" /> : item.attempts ? <CircleDashed size={16} className="sv-amber" /> : <CircleDashed size={16} className="sv-faint" />}
              </span>
              <span role="cell" className="sv-strong">
                {item.title}
                {item.review_status === 'IMPORTED_UNREVIEWED' && <em className="sv-chip" title="Imported practice question, not reviewed by your faculty">practice bank</em>}
              </span>
              <span role="cell" className="sv-muted">{item.topic}</span>
              <span role="cell"><span className={`ws-diff ws-diff-${item.difficulty.toLowerCase()}`}>{item.difficulty.toLowerCase()}</span></span>
              <span role="cell" className="sv-muted">{item.supported_languages.map((l) => LANGUAGES.find((x) => x.id === l)?.label.split(' ')[0] ?? l).join(', ')}</span>
            </button>
          ))}
        </div>
        <div className="sv-pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {q.data?.total ?? 0} challenges</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </State>
    </div>
  );
};

// ---------------- My courses with offline packages ----------------
function bytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const CourseCard: React.FC<{ course: CatalogCourse; isOnline: boolean }> = ({ course, isOnline }) => {
  const [status, setStatus] = useState<PackageStatus | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resources, setResources] = useState<PackageResource[]>([]);
  const refresh = useCallback(async () => {
    const local = (await listStoredManifests()).find((m) => m.courseId === course.id);
    setResources(local?.resources ?? []);
    if (isOnline) setStatus(await packageStatus(course.id).catch(() => null));
    else setStatus(local ? { available: true, serverVersion: null, localVersion: local.version, updateAvailable: false, resourceCount: local.resources.length, totalBytes: local.resources.reduce((a, r) => a + r.sizeBytes, 0) } : null);
  }, [course.id, isOnline]);
  useEffect(() => void refresh(), [refresh]);

  const download = async () => {
    setErr(null);
    try {
      await downloadCoursePackage(course.id, (d, t) => setProgress(`${d}/${t}`));
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  const open = async (r: PackageResource) => {
    try {
      const url = await openOfflineResource(r);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <article className="sv-card">
      <header>
        <div>
          <p className="sv-eyebrow">{course.subjectCode ?? course.category}{course.semesterNumber ? ` · Semester ${course.semesterNumber}` : ''}</p>
          <h3>{course.title}</h3>
        </div>
        <span className="ws-tag">{course.language}</span>
      </header>
      <p className="sv-muted sv-clamp">{course.description || 'No description yet.'}</p>
      <div className="sv-download">
        {status?.localVersion ? (
          <span className="sv-ok-text"><CheckCircle2 size={14} /> Offline v{status.localVersion} · {resources.length} files</span>
        ) : status?.available ? (
          <span className="sv-muted">{status.resourceCount} files · {bytes(status.totalBytes)} available</span>
        ) : (
          <span className="sv-muted">No downloadable package yet</span>
        )}
        {status?.updateAvailable && status.localVersion && <span className="sv-chip">Update v{status.serverVersion}</span>}
        <div className="sv-actions">
          {status?.available && (status.updateAvailable || !status.localVersion) && (
            <button className="btn btn-primary" disabled={!isOnline || Boolean(progress)} onClick={() => void download()}>
              {progress ? <><Loader2 className="ws-spin" size={14} /> {progress}</> : <><CloudDownload size={14} /> {status.localVersion ? 'Update' : 'Download'}</>}
            </button>
          )}
          {status?.localVersion && (
            <button className="ws-icon-btn" aria-label={`Remove ${course.title} from this computer`} onClick={() => void removeCoursePackage(course.id).then(refresh)}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {resources.length > 0 && (
        <ul className="sv-files">
          {resources.map((r) => (
            <li key={r.fileId}>
              <button onClick={() => void open(r)}>
                <FileText size={14} /> {r.name} <span className="sv-muted">{bytes(r.sizeBytes)}</span> <ExternalLink size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="sv-error-text" role="alert">{err}</p>}
    </article>
  );
};

export const CoursesView: React.FC<{ isOnline: boolean }> = ({ isOnline }) => {
  const q = useAsync(() => fetchCoursesCatalog(), []);
  const groups = useMemo(() => {
    const allowed = (q.data ?? []).filter((c) => c.accessEnabled);
    const map = new Map<string, CatalogCourse[]>();
    for (const c of allowed) {
      const key = c.semesterNumber ? `Semester ${c.semesterNumber}` : c.isPlatformCourse ? 'Platform courses' : 'Other courses';
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [q.data]);
  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1>My courses</h1>
          <p className="sv-sub">Courses allocated to your sections. Download a course to read its materials offline; files are verified with SHA-256.</p>
        </div>
        <button className="btn" onClick={q.reload}><RefreshCw size={14} /> Refresh</button>
      </div>
      <State loading={q.loading} error={q.error} onRetry={q.reload} empty={groups.length === 0 && 'No courses are allocated to you yet. Your college allocates courses to your section.'}>
        {groups.map(([label, courses]) => (
          <section key={label} className="sv-group">
            <h2>{label}</h2>
            <div className="sv-grid">{courses.map((c) => <CourseCard key={c.id} course={c} isOnline={isOnline} />)}</div>
          </section>
        ))}
      </State>
    </div>
  );
};

// ---------------- Notifications ----------------
export const NotificationsView: React.FC = () => {
  const q = useAsync(() => fetchNotifications(), []);
  const read = async (n: AppNotification) => {
    if (!n.readAt) await markNotificationRead(n.id).catch(() => undefined);
    q.reload();
  };
  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1>Notifications</h1>
          <p className="sv-sub">{q.data ? `${q.data.unread} unread` : ' '}</p>
        </div>
        <button className="btn" disabled={!q.data?.unread} onClick={() => void markAllNotificationsRead().then(q.reload)}>Mark all read</button>
      </div>
      <State loading={q.loading} error={q.error} onRetry={q.reload} empty={q.data?.items.length === 0 && 'You are all caught up.'}>
        <ul className="sv-list">
          {(q.data?.items ?? []).map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'sv-unread'}>
              <button onClick={() => void read(n)}>
                <Bell size={15} />
                <div>
                  <strong>{n.title}</strong>
                  {n.body && <p className="sv-muted">{n.body}</p>}
                </div>
                <time className="sv-muted">{new Date(n.createdAt).toLocaleString()}</time>
              </button>
            </li>
          ))}
        </ul>
      </State>
    </div>
  );
};

// ---------------- Results & profile ----------------
export const MyResultsView: React.FC<{ user: User }> = ({ user }) => {
  const q = useAsync<StudentProfile>(() => fetchMyProfile(user.id), [user.id]);
  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1>Results</h1>
          <p className="sv-sub">Marks appear once your faculty releases them. Skills need at least two graded pieces of evidence.</p>
        </div>
      </div>
      <State loading={q.loading} error={q.error} onRetry={q.reload}>
        {q.data && (
          <>
            <div className="sv-table" role="table" aria-label="Submissions">
              <div className="sv-row sv-row-head sv-row-results" role="row">
                <span>Assignment</span><span>Language</span><span>Verdict</span><span>Tests</span><span>Marks</span><span>Feedback</span>
              </div>
              {q.data.results.length === 0 && <div className="sv-state">No submissions yet.</div>}
              {q.data.results.map((r) => (
                <div key={r.id} className="sv-row sv-row-results" role="row">
                  <span className="sv-strong">{r.assignmentTitle}<small className="sv-muted"> · {r.questionTitle}</small></span>
                  <span>{r.language}</span>
                  <span>{verdictLabel(r.verdict)}</span>
                  <span className="sv-muted">{r.totalTestCases ? `${r.passedTestCases}/${r.totalTestCases}` : '—'}</span>
                  <span>{r.score === null ? <span className="sv-muted">Not released</span> : `${r.score}/${r.maxMarks}`}</span>
                  <span className="sv-muted">{r.teacherFeedback ?? '—'}</span>
                </div>
              ))}
            </div>
            <section className="sv-group">
              <h2>Skills</h2>
              <div className="sv-skills">
                {q.data.skills.map((s) => (
                  <div key={s.skill} className="sv-skill">
                    <span>{s.skill}</span>
                    {s.status === 'MEASURED' ? (
                      <div className="sv-meter" aria-label={`${s.skill} ${s.score}%`}><div style={{ width: `${s.score}%` }} /></div>
                    ) : (
                      <em className="sv-muted">Insufficient evidence ({s.evidenceCount})</em>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="sv-group">
              <h2>Academic history</h2>
              <div className="sv-grid">
                {q.data.enrollments.map((e) => (
                  <div key={e.sectionId} className="sv-card sv-card-compact">
                    <strong>{e.semesterName ?? 'Section'} · {e.className} {e.sectionName}</strong>
                    <span className="sv-muted">{[e.departmentName, e.programName, e.batchName].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </State>
    </div>
  );
};

// ---------------- Settings ----------------
export const StudentSettings: React.FC<{ user: User; isOnline: boolean; onLogout: () => void }> = ({ user, isOnline, onLogout }) => {
  const { prefs, setPrefs } = useEditorPreferences();
  const sessions = useAsync(() => fetchSessions(), []);
  const [counts, setCounts] = useState(outboxCounts());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [offlineCourses, setOfflineCourses] = useState(0);
  useEffect(() => {
    const upd = () => setCounts(outboxCounts());
    window.addEventListener('lp-outbox-changed', upd);
    void listStoredManifests().then((m) => setOfflineCourses(m.length));
    return () => window.removeEventListener('lp-outbox-changed', upd);
  }, []);
  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await flushOutbox();
      if (outboxCounts().failed > 0) setSyncError('Some items were rejected by the server and will not be retried. Contact your faculty if a submission is affected.');
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
      setCounts(outboxCounts());
    }
  };
  const pending = counts.events + counts.snapshots + counts.submissions + counts.unsyncedDrafts;

  return (
    <div className="sv-page sv-settings">
      <h1>Settings</h1>
      <section className="sv-card">
        <h2>Account</h2>
        <p>{user.name} · {user.email}</p>
        <button className="btn" onClick={onLogout}>Sign out of this device</button>
      </section>
      <section className="sv-card">
        <h2>Appearance and editor</h2>
        <div className="sv-form">
          <label>Theme
            <select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as 'light' | 'dark' })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>Editor font size
            <input type="number" min={11} max={24} value={prefs.fontSize} onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })} />
          </label>
          <label>Default language
            <select value={prefs.defaultLanguage ?? ''} onChange={(e) => setPrefs({ defaultLanguage: (e.target.value || null) as typeof prefs.defaultLanguage })}>
              <option value="">Question default</option>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          {([
            ['autoSave', 'Auto-save drafts while typing'],
            ['formatOnSave', 'Tidy whitespace on save'],
            ['minimap', 'Show minimap'],
            ['wordWrap', 'Wrap long lines'],
          ] as const).map(([k, label]) => (
            <label key={k} className="sv-check">
              <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} /> {label}
            </label>
          ))}
        </div>
      </section>
      <section className="sv-card">
        <h2>Sync and offline data</h2>
        <p className="sv-muted">{isOnline ? 'Online' : 'Offline'} · {pending} item(s) waiting to sync · {offlineCourses} course package(s) stored on this computer</p>
        <ul className="sv-kv">
          <li><span>Queued submissions (not graded until sent)</span><strong>{counts.submissions}</strong></li>
          <li><span>Unsynced drafts</span><strong>{counts.unsyncedDrafts}</strong></li>
          <li><span>Code history snapshots</span><strong>{counts.snapshots}</strong></li>
          <li><span>Activity events</span><strong>{counts.events}</strong></li>
          <li><span>Rejected by the server (will not retry)</span><strong>{counts.failed}</strong></li>
        </ul>
        <button className="btn" disabled={!isOnline || syncing} onClick={() => void sync()}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        {syncError && <p className="sv-error-text">{syncError}</p>}
      </section>
      <section className="sv-card">
        <h2><Laptop size={16} /> Signed-in devices</h2>
        <State loading={sessions.loading} error={sessions.error} onRetry={sessions.reload}>
          <ul className="sv-list sv-list-plain">
            {(sessions.data?.sessions ?? []).map((s: DeviceSession) => (
              <li key={s.id}>
                <div>
                  <strong>{s.device_name ?? (s.client_type === 'DESKTOP' ? 'Desktop app' : 'Web browser')}</strong>
                  <p className="sv-muted">Signed in {new Date(s.created_at).toLocaleString()} · expires {new Date(s.expires_at).toLocaleDateString()}</p>
                </div>
                <button className="btn" onClick={() => void revokeSession(s.id).then(sessions.reload)}>Revoke</button>
              </li>
            ))}
          </ul>
        </State>
      </section>
      <section className="sv-card">
        <h2><ShieldCheck size={16} /> Privacy and activity transparency</h2>
        <p>While you work on a question in this app, L_Platform records: when you open a question, edits to your code (saved revisions), pastes into the editor (size only, and whether it came from inside the editor), runs, submissions and results, and when this app window loses or regains focus for more than three seconds.</p>
        <p className="sv-muted">It does not read your clipboard, record keystrokes outside the editor, take screenshots, or observe other applications. Your faculty can review this history for your coursework; it is treated as context, not as proof of misconduct.</p>
      </section>
      <section className="sv-card">
        <h2><BookOpen size={16} /> About</h2>
        <p className="sv-muted">L_Platform Student · version {__APP_VERSION__} · Languages: {LANGUAGES.map((l) => `${l.label} (${l.standard})`).join(', ')}. Code runs on the college judge, never on this computer.</p>
      </section>
    </div>
  );
};

declare const __APP_VERSION__: string;
