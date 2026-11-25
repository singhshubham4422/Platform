// Offline-first sync engine (phase 05, with the phase 10 assessment route).
//
// Order per run: session → device registration → attempts → activity batches → pull
// (pack updates, released feedback). One run at a time; transient failures back off
// exponentially with jitter (30 s … 30 min); a missing/expired session pauses sync.
// Nothing local is deleted until the server (or Object Storage) confirmed it.
import type { AttemptRow, DeviceInfo, SealedBatch, ActivityCounts } from './offline-store';
import type { CatalogEntry } from './catalog';
import type { PackInfo } from './packs';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'paused-auth' | 'backoff';

export interface SyncStatus {
  state: SyncState;
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingSubmissions: number;
  pendingBatches: number;
  parked: Array<{ attemptId: string; error: string }>;
  updatesAvailable: CatalogEntry[];
}

export interface FeedbackItem {
  submissionId: string;
  questionId: string;
  packId: string;
  body: string;
  scoreOverride: number | null;
  createdAt: string;
}

interface PgResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
}

/** The small part of supabase-js the engine needs (easy to mock). */
export interface SyncSupabase {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> };
  from(table: string): {
    upsert(rows: unknown[], opts: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<PgResult>;
    select(cols: string): { eq(col: string, v: unknown): PromiseLike<PgResult<unknown[]>> };
  };
}

export interface SyncDeps {
  sb: SyncSupabase;
  broker: <T>(name: string, body: unknown) => Promise<T>;
  fetchImpl: typeof fetch;
  isOnline: () => boolean;
  store: {
    attemptsDue(limit: number): Promise<AttemptRow[]>;
    attemptsAck(ids: string[]): Promise<number>;
    attemptsPark(id: string, error: string): Promise<number>;
    attemptsListParked(): Promise<AttemptRow[]>;
    activitySealBatch(max: number): Promise<SealedBatch | null>;
    activityAckBatch(id: string): Promise<void>;
    activityCounts(): Promise<ActivityCounts>;
    deviceInfo(): Promise<DeviceInfo>;
    getCursor(stream: string): Promise<string | null>;
    setCursor(stream: string, value: string): Promise<void>;
  };
  packs: {
    list(): Promise<PackInfo[]>;
    catalog(): Promise<CatalogEntry[]>;
    install(packId: string): Promise<PackInfo>;
  };
}

export class SyncAuthError extends Error {}
class TransientError extends Error {}

const BATCH_EVENTS = 1000; // ≤ 4 KB per event, so a gzip batch stays far below the 5 MB broker limit
const MAX_BATCHES_PER_RUN = 10;
const AUTO_INSTALL_MAX_BYTES = 50 * 1024 * 1024;
export const FEEDBACK_CURSOR = 'feedback:v1';
const DEVICE_CURSOR = 'device-registered:v1';

const statusOf = (e: unknown): number => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : 0);
const codeOf = (e: unknown): string => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : 'ERROR');

function classify(e: unknown): never {
  const s = statusOf(e);
  if (s === 401) throw new SyncAuthError('NOT_SIGNED_IN');
  throw new TransientError(codeOf(e));
}

export function toSubmissionRow(a: AttemptRow, courseId: string) {
  return {
    id: a.attemptId,
    pack_id: a.packId,
    course_id: courseId,
    question_id: a.questionId,
    assessment_id: null,
    language: a.language,
    source: a.source,
    source_sha256: a.sourceSha256,
    verdict: a.verdict,
    passed: a.passed,
    total: a.total,
    total_time_ms: a.totalTimeMs,
    results_json: a.results,
    started_at: a.startedAt,
    finished_at: a.finishedAt,
    monotonic_seq: a.monotonicSeq,
    device_id: a.deviceId,
    signature: a.signature,
  };
}

export function toAssessmentAttempt(a: AttemptRow) {
  return {
    attemptId: a.attemptId,
    packId: a.packId,
    questionId: a.questionId,
    assessmentId: a.assessmentId,
    language: a.language,
    mode: a.mode,
    source: a.source,
    sourceSha256: a.sourceSha256,
    verdict: a.verdict,
    passed: a.passed,
    total: a.total,
    totalTimeMs: a.totalTimeMs,
    resultsJson: a.results,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    monotonicSeq: a.monotonicSeq,
    deviceId: a.deviceId,
    signature: a.signature,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class OfflineSync {
  private running: Promise<SyncStatus> | null = null;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = {
    state: 'idle',
    lastSuccessAt: null,
    lastError: null,
    pendingSubmissions: 0,
    pendingBatches: 0,
    parked: [],
    updatesAvailable: [],
  };

  constructor(private deps: SyncDeps) {}

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  /** Runs one sync now (or joins the one in progress). */
  syncNow(): Promise<SyncStatus> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(intervalMs = 5 * 60_000): () => void {
    const tick = () => void this.syncNow();
    this.interval = setInterval(tick, intervalMs);
    if (typeof window !== 'undefined') window.addEventListener('online', tick);
    tick();
    return () => {
      if (this.interval) clearInterval(this.interval);
      if (this.timer) clearTimeout(this.timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', tick);
    };
  }

  private scheduleBackoff() {
    this.failures += 1;
    const base = Math.min(30 * 60_000, 30_000 * 2 ** (this.failures - 1));
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), delay);
  }

  private async refreshCounts() {
    const [due, counts, parked] = await Promise.all([
      this.deps.store.attemptsDue(200),
      this.deps.store.activityCounts(),
      this.deps.store.attemptsListParked(),
    ]);
    this.set({
      pendingSubmissions: due.length,
      pendingBatches: counts.pendingBatches + (counts.pendingEvents > 0 ? 1 : 0),
      parked: parked.map((a) => ({ attemptId: a.attemptId, error: a.syncError ?? 'ERROR' })),
    });
  }

  private async run(): Promise<SyncStatus> {
    if (!this.deps.isOnline()) {
      this.set({ state: 'offline' });
      await this.refreshCounts().catch(() => undefined);
      return this.status;
    }
    this.set({ state: 'syncing', lastError: null });
    try {
      const { data } = await this.deps.sb.auth.getSession();
      if (!data.session) throw new SyncAuthError('NOT_SIGNED_IN');
      await this.registerDevice();
      await this.pushAttempts();
      await this.pushActivity();
      await this.pull();
      this.failures = 0;
      this.set({ state: 'idle', lastSuccessAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof SyncAuthError) this.set({ state: 'paused-auth', lastError: 'Sign in to sync' });
      else {
        this.set({ state: 'backoff', lastError: e instanceof Error ? e.message : String(e) });
        this.scheduleBackoff();
      }
    }
    await this.refreshCounts().catch(() => undefined);
    return this.status;
  }

  private async registerDevice() {
    const dev = await this.deps.store.deviceInfo();
    if (!dev.publicKey) return; // no secure storage: practice still syncs unsigned
    const marker = `${dev.deviceId}:${dev.publicKey}`;
    if ((await this.deps.store.getCursor(DEVICE_CURSOR)) === marker) return;
    try {
      await this.deps.broker('register-device', { deviceId: dev.deviceId, publicKey: dev.publicKey });
      await this.deps.store.setCursor(DEVICE_CURSOR, marker);
    } catch (e) {
      if (statusOf(e) === 409) {
        this.set({ lastError: 'This device key does not match the registered one; assessments cannot be uploaded from it.' });
        return;
      }
      classify(e);
    }
  }

  private async pushAttempts() {
    const packs = new Map((await this.deps.packs.list()).map((p) => [p.packId, p]));
    for (let round = 0; round < 20; round++) {
      const due = await this.deps.store.attemptsDue(50);
      if (!due.length) return;
      const practice = due.filter((a) => !a.assessmentId);
      const assessment = due.filter((a) => a.assessmentId);
      if (practice.length) await this.pushPractice(practice, packs);
      for (let i = 0; i < assessment.length; i += 20) await this.pushAssessment(assessment.slice(i, i + 20));
    }
  }

  private async pushPractice(rows: AttemptRow[], packs: Map<string, PackInfo>) {
    const courseOf = (a: AttemptRow) => packs.get(a.packId)?.courseId ?? a.packId.split('@')[0]!;
    const table = this.deps.sb.from('submissions');
    const opts = { onConflict: 'id', ignoreDuplicates: true };
    const res = await table.upsert(rows.map((a) => toSubmissionRow(a, courseOf(a))), opts);
    if (!res.error) {
      await this.deps.store.attemptsAck(rows.map((a) => a.attemptId));
      return;
    }
    if (res.status === 401) throw new SyncAuthError('NOT_SIGNED_IN');
    if (res.status < 400 || res.status >= 500) throw new TransientError(res.error.message);
    // A 4xx for the batch: find and park the bad rows one by one so they never block the rest.
    for (const a of rows) {
      const one = await table.upsert([toSubmissionRow(a, courseOf(a))], opts);
      if (!one.error) await this.deps.store.attemptsAck([a.attemptId]);
      else if (one.status === 401) throw new SyncAuthError('NOT_SIGNED_IN');
      else if (one.status >= 400 && one.status < 500) await this.deps.store.attemptsPark(a.attemptId, one.error.code ?? `HTTP_${one.status}`);
      else throw new TransientError(one.error.message);
    }
  }

  private async pushAssessment(rows: AttemptRow[]) {
    type Res = { accepted: string[]; duplicates: string[]; rejected: Array<{ id: string; error: string }> };
    let res: Res;
    try {
      res = await this.deps.broker<Res>('submit-assessment-attempts', { attempts: rows.map(toAssessmentAttempt) });
    } catch (e) {
      const s = statusOf(e);
      if (s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429) {
        for (const a of rows) await this.deps.store.attemptsPark(a.attemptId, codeOf(e));
        return;
      }
      classify(e);
    }
    const done = [...res.accepted, ...res.duplicates];
    if (done.length) await this.deps.store.attemptsAck(done);
    for (const r of res.rejected) await this.deps.store.attemptsPark(r.id, r.error);
  }

  private async pushActivity() {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const batch = await this.deps.store.activitySealBatch(BATCH_EVENTS);
      if (!batch) return;
      let target: { uploadUrl: string };
      try {
        target = await this.deps.broker('activity-upload-url', { batchId: batch.batchId, sizeBytes: batch.sizeBytes, sha256: batch.sha256 });
      } catch (e) {
        classify(e);
      }
      let put: Response;
      try {
        put = await this.deps.fetchImpl(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/gzip' },
          body: base64ToBytes(batch.gzBase64) as unknown as BodyInit,
        });
      } catch (e) {
        throw new TransientError(`NETWORK: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!put.ok) throw new TransientError(`UPLOAD_FAILED: HTTP ${put.status}`);
      await this.deps.store.activityAckBatch(batch.batchId);
    }
  }

  private async pull() {
    // Pack updates: small ones install automatically, large ones are offered to the student.
    const catalog = await this.deps.packs.catalog();
    const large: CatalogEntry[] = [];
    for (const c of catalog.filter((x) => x.state === 'UPDATE_AVAILABLE')) {
      if (c.size <= AUTO_INSTALL_MAX_BYTES) await this.deps.packs.install(c.packId);
      else large.push(c);
    }
    this.set({ updatesAvailable: large });
    // Released feedback on the student's own submissions (RLS limits rows to them).
    const fb = await this.deps.sb
      .from('feedback')
      .select('submission_id,body,score_override,created_at,submissions!inner(question_id,pack_id)')
      .eq('released', true);
    if (fb.error) {
      if (fb.status === 401) throw new SyncAuthError('NOT_SIGNED_IN');
      throw new TransientError(fb.error.message);
    }
    type Row = { submission_id: string; body: string; score_override: number | null; created_at: string; submissions: { question_id: string; pack_id: string } };
    const items: FeedbackItem[] = ((fb.data ?? []) as Row[]).map((r) => ({
      submissionId: r.submission_id,
      questionId: r.submissions.question_id,
      packId: r.submissions.pack_id,
      body: r.body,
      scoreOverride: r.score_override,
      createdAt: r.created_at,
    }));
    await this.deps.store.setCursor(FEEDBACK_CURSOR, JSON.stringify(items));
  }
}

/** Released feedback cached by the last successful pull (stored in the local sync_cursors table). */
export async function cachedFeedback(getCursor: (s: string) => Promise<string | null>, questionId: string): Promise<FeedbackItem[]> {
  try {
    const all = JSON.parse((await getCursor(FEEDBACK_CURSOR)) ?? '[]') as FeedbackItem[];
    return all.filter((f) => f.questionId === questionId);
  } catch {
    return [];
  }
}
