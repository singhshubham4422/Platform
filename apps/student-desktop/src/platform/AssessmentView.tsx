import { useEffect, useMemo, useState } from 'react';
import type { LanguageId } from '@lplatform/language-config';
import {
  assessmentStatus,
  assessmentStoreKey,
  installPackFromBroker,
  packsGetQuestion,
  packsList,
  packsListQuestions,
  type AssessmentStatus,
  type PackInfo,
  type QuestionSummary,
  type QuestionView,
} from '../lib/packs';
import { callBroker } from '../lib/broker';
import { attemptsList, deviceInfo, getCursor, setCursor } from '../lib/offline-store';
import { getSupabase } from '../lib/supabase-client';
import { runtimesList } from '../lib/runtimes';
import { RuntimeManager } from '../components/RuntimeManager';
import { LanguagePicker } from './LanguagePicker';
import { OfflineQuestionWorkspace } from './OfflineQuestionWorkspace';
import './platform.css';

const ASSESSMENTS_CURSOR = 'assessments:v1';

export interface AssessmentItem {
  id: string;
  title: string;
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  attemptsAllowed: number;
  highStakes: boolean;
  status: string;
  latestPackId: string | null;
  latestVersion: number | null;
}

interface AssessmentRow {
  id: string;
  title: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempts_allowed: number;
  high_stakes: boolean;
  status: string;
  course_pack_versions: Array<{ pack_id: string; version: number }> | null;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Time expired';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

async function fetchAssessments(): Promise<AssessmentItem[]> {
  if (navigator.onLine) {
    const { data, error } = await getSupabase()
      .from('assessments')
      .select('id,title,opens_at,closes_at,duration_minutes,attempts_allowed,high_stakes,status,course_pack_versions(pack_id,version)')
      .neq('status', 'DRAFT')
      .order('opens_at', { ascending: true });
    if (error) throw new Error(error.message);
    const items: AssessmentItem[] = ((data ?? []) as unknown as AssessmentRow[]).map((r) => {
      const latest = [...(r.course_pack_versions ?? [])].sort((a, b) => b.version - a.version)[0];
      return {
        id: r.id,
        title: r.title,
        opensAt: r.opens_at,
        closesAt: r.closes_at,
        durationMinutes: r.duration_minutes,
        attemptsAllowed: r.attempts_allowed,
        highStakes: r.high_stakes,
        status: r.status,
        latestPackId: latest?.pack_id ?? null,
        latestVersion: latest?.version ?? null,
      };
    });
    await setCursor(ASSESSMENTS_CURSOR, JSON.stringify(items)).catch(() => undefined);
    return items;
  }
  const cached = await getCursor(ASSESSMENTS_CURSOR).catch(() => null);
  return cached ? (JSON.parse(cached) as AssessmentItem[]) : [];
}

export function AssessmentView() {
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AssessmentStatus>>({});
  const [active, setActive] = useState<{ item: AssessmentItem; pack: PackInfo } | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [selected, setSelected] = useState<QuestionView | null>(null);
  const [language, setLanguage] = useState<LanguageId>('PYTHON');
  const [installedRuntimes, setInstalledRuntimes] = useState<string[]>([]);
  const [attemptsByQ, setAttemptsByQ] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [localPacks, remote] = await Promise.all([packsList(), fetchAssessments().catch(() => [])]);
      const assessmentPacks = localPacks.filter((p) => p.kind === 'ASSESSMENT');
      setPacks(assessmentPacks);
      const byId = new Map(remote.map((a) => [a.id, a]));
      for (const p of assessmentPacks) {
        if (p.assessmentId && !byId.has(p.assessmentId)) {
          byId.set(p.assessmentId, {
            id: p.assessmentId,
            title: p.title,
            opensAt: '',
            closesAt: '',
            durationMinutes: 0,
            attemptsAllowed: 0,
            highStakes: false,
            status: 'SCHEDULED',
            latestPackId: p.packId,
            latestVersion: p.version,
          });
        }
      }
      setAssessments([...byId.values()]);
      const stEntries = await Promise.all(
        assessmentPacks.map(async (p) => [p.packId, await assessmentStatus(p.packId).catch(() => ({ hasKey: false, startedAtMs: null, endsAtMs: null }))] as const),
      );
      setStatuses(Object.fromEntries(stEntries));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  const loadActiveDetails = async (pack: PackInfo) => {
    const [qs, rts, rows] = await Promise.all([
      packsListQuestions(pack.packId),
      runtimesList().catch(() => []),
      attemptsList(pack.packId).catch(() => []),
    ]);
    setQuestions(qs);
    setInstalledRuntimes(rts.map((r) => r.language));
    setLanguage((localStorage.getItem(`lp_platform_lang_${pack.packId}`) || pack.languages[0] || 'PYTHON') as LanguageId);
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.mode === 'SUBMIT') counts[r.questionId] = (counts[r.questionId] ?? 0) + 1;
    }
    setAttemptsByQ(counts);
  };

  const packByAssessment = useMemo(() => {
    const m = new Map<string, PackInfo>();
    for (const p of packs) {
      if (p.assessmentId) m.set(p.assessmentId, p);
    }
    return m;
  }, [packs]);

  const download = async (item: AssessmentItem) => {
    if (!item.latestPackId) return;
    setBusyId(item.id);
    setError('');
    try {
      await installPackFromBroker(item.latestPackId);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const startAssessment = async (item: AssessmentItem, pack: PackInfo) => {
    setError('');
    if (!navigator.onLine) {
      setError('Connect once at the start time to unlock');
      return;
    }
    setBusyId(item.id);
    try {
      const dev = await deviceInfo();
      const key = await callBroker<{ keyId: string; keyB64: string; closesAt: string }>('assessment-key', {
        assessmentId: item.id,
        deviceId: dev.deviceId,
      });
      await assessmentStoreKey(item.id, key.keyId, key.keyB64);
      const st = await assessmentStatus(pack.packId);
      setStatuses((prev) => ({ ...prev, [pack.packId]: st }));
      setActive({ item, pack });
      await loadActiveDetails(pack);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openAssessment = async (item: AssessmentItem, pack: PackInfo) => {
    setError('');
    setActive({ item, pack });
    await loadActiveDetails(pack);
  };

  if (active && selected) {
    const used = attemptsByQ[selected.id] ?? 0;
    const left = Math.max(0, active.item.attemptsAllowed - used);
    const st = statuses[active.pack.packId];
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid #dce0e8', fontSize: 13 }}>
          {st?.endsAtMs && (
            <strong role="timer" aria-label="Time remaining">
              Time remaining: {formatRemaining(st.endsAtMs - now)}
            </strong>
          )}
          {active.item.attemptsAllowed > 0 && <span>Attempts left: {left} of {active.item.attemptsAllowed}</span>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <OfflineQuestionWorkspace
            packId={active.pack.packId}
            assessmentId={active.item.id}
            question={selected}
            language={language}
            onBack={() => {
              setSelected(null);
              void loadActiveDetails(active.pack);
            }}
          />
        </div>
      </div>
    );
  }

  if (active) {
    const st = statuses[active.pack.packId];
    return (
      <section className="platform-page">
        <header className="platform-head">
          <button className="btn" onClick={() => setActive(null)}>
            ← Assessments
          </button>
          <div>
            <h1>{active.item.title}</h1>
            <p>
              {st?.endsAtMs ? (
                <strong role="timer">Time remaining: {formatRemaining(st.endsAtMs - now)}</strong>
              ) : (
                `${active.item.durationMinutes} min`
              )}
              {active.item.highStakes ? ' · High-stakes (re-checked)' : ''}
            </p>
          </div>
        </header>
        {error && (
          <p className="platform-error" role="alert">
            {error}
          </p>
        )}
        <LanguagePicker
          packId={active.pack.packId}
          languages={active.pack.languages}
          value={language}
          onChange={(v) => {
            setLanguage(v);
            localStorage.setItem(`lp_platform_lang_${active.pack.packId}`, v);
          }}
        />
        {!installedRuntimes.includes(language) && (
          <div className="platform-runtime">
            <p>{language} runtime is not installed. Install it to run code offline.</p>
            <RuntimeManager />
          </div>
        )}
        <div className="platform-question-list">
          {questions.map((q) => {
            const used = attemptsByQ[q.id] ?? 0;
            const left = active.item.attemptsAllowed > 0 ? Math.max(0, active.item.attemptsAllowed - used) : null;
            return (
              <button
                className="platform-question"
                key={q.id}
                onClick={() =>
                  void packsGetQuestion(active.pack.packId, q.id)
                    .then(setSelected)
                    .catch((e) => setError(String(e)))
                }
              >
                <strong>
                  {q.order}. {q.title}
                </strong>
                <span>
                  {q.difficulty} · {q.points} points
                </span>
                {left !== null && <small>Attempts left: {left}</small>}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="platform-page">
      <header className="platform-head">
        <div>
          <p className="platform-eyebrow">TIMED EXAMS</p>
          <h1>Assessments</h1>
          <p>Download your assessment pack in advance, then connect once at the start time to unlock it.</p>
        </div>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </header>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading assessments…</p>
      ) : assessments.length === 0 ? (
        <div className="platform-empty">
          <h2>No assessments scheduled</h2>
          <p>Assessments assigned to your classes will appear here.</p>
        </div>
      ) : (
        <div className="platform-question-list">
          {assessments.map((a) => {
            const pack = packByAssessment.get(a.id);
            const st = pack ? statuses[pack.packId] : undefined;
            const needsUpdate = pack && a.latestVersion !== null && pack.version < a.latestVersion;
            return (
              <div className="platform-question" key={a.id} style={{ cursor: 'default' }}>
                <strong>{a.title}</strong>
                <span>
                  {a.durationMinutes ? `${a.durationMinutes} min` : 'Installed'}
                  {a.attemptsAllowed ? ` · ${a.attemptsAllowed} attempts` : ''}
                  {a.highStakes ? ' · High-stakes' : ''}
                </span>
                {a.opensAt && <small>Window: {new Date(a.opensAt).toLocaleString()} – {new Date(a.closesAt).toLocaleString()}</small>}
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {a.latestPackId && (!pack || needsUpdate) && (
                    <button className="btn btn-sm" disabled={busyId !== null} onClick={() => void download(a)}>
                      {busyId === a.id ? 'Downloading…' : needsUpdate ? `Update to v${a.latestVersion}` : 'Download'}
                    </button>
                  )}
                  {pack && !st?.hasKey && (
                    <button className="btn btn-primary btn-sm" disabled={busyId !== null} onClick={() => void startAssessment(a, pack)}>
                      {busyId === a.id ? 'Unlocking…' : 'Start'}
                    </button>
                  )}
                  {pack && st?.hasKey && (
                    <button className="btn btn-primary btn-sm" onClick={() => void openAssessment(a, pack)}>
                      Open
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
