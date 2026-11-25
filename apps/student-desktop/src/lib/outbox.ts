// Durable client-side outbox for the Programming Workspace.
//
// Storage: native SQLite through Tauri (see ./local-store.ts and src-tauri/src/store.rs); a
// localStorage fallback with identical semantics is used only outside Tauri.
//
// The public functions stay synchronous for the editor: they update an in-memory cache
// immediately and persist through a single ordered write queue. Every operation carries a
// client-generated UUID so the server de-duplicates replays (activity events, code snapshots,
// submissions via clientOperationId). Drafts carry a revision and timestamp; the server refuses
// an older draft, so offline state never overwrites newer server data.
import type { LanguageId } from '@lplatform/language-config';
import { ApiRequestError } from './api';
import { postEvents, postSnapshots, pushDraft, submitCode } from './coding-api';
import { OFFLINE_FIRST } from './offline-config';
import { queueActivity } from './activity-queue';
import { getLocalStore, migrateLegacyBrowserData, type OperationType, type StoreCounts, type StoredDraft } from './local-store';

export interface ActivityEvent {
  id: string;
  eventType: string;
  clientTs: string;
  questionId?: string | null;
  assignmentId?: string | null;
  courseId?: string | null;
  /** ADDED BY PHASE 04: identifies activity from an offline course pack. */
  packId?: string | null;
  assessmentId?: string | null; // ADDED BY PHASE 05
  language?: string | null; // ADDED BY PHASE 05
  attemptId?: string | null;
  deviceSessionId?: string | null;
  schemaVersion: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface Snapshot {
  id: string;
  questionId: string;
  assignmentId?: string | null;
  language: LanguageId;
  kind: 'CHECKPOINT' | 'EDIT' | 'PASTE' | 'RUN' | 'SUBMIT' | 'RESET';
  content: string;
  clientTs: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface QueuedSubmission {
  clientOperationId: string;
  questionId: string;
  assignmentId: string;
  language: LanguageId;
  code: string;
  queuedAt: string;
}

export interface LocalDraft {
  questionId: string;
  assignmentId: string | null;
  language: LanguageId;
  content: string;
  updatedAt: string;
  synced: boolean;
}

export type OutboxCounts = Omit<StoreCounts, 'failed'> & { failed: number };

export const uuid = (): string => crypto.randomUUID();

// ---------- in-memory cache + ordered write queue ----------
const drafts = new Map<string, LocalDraft & { revision: number }>();
const lastSnapshot = new Map<string, string>();
let counts: OutboxCounts = { events: 0, snapshots: 0, submissions: 0, unsyncedDrafts: 0, failed: 0 };
let writeChain: Promise<unknown> = Promise.resolve();
let initialized = false;
let deviceSession: string | null = null;

const draftKey = (d: { questionId: string; assignmentId: string | null; language: string }) => `${d.questionId}|${d.assignmentId ?? ''}|${d.language}`;
const deviceSessionId = () => (deviceSession ??= uuid());

function emitChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lp-outbox-changed'));
}

async function refreshCounts(): Promise<void> {
  counts = await getLocalStore().counts();
  emitChanged();
}

/** Serialises writes so they reach storage in the order the student made them. */
function persist(op: () => Promise<unknown>): Promise<void> {
  const next = writeChain.then(op).then(refreshCounts);
  writeChain = next.catch((e) => console.error('[outbox] local write failed', e));
  return next.then(() => undefined);
}

/** Wait for every pending local write (call before sign-out or in tests). */
export function flushLocalWrites(): Promise<void> {
  return writeChain.then(() => undefined);
}

/** Load drafts and counts from storage; migrates v0.4 localStorage data into SQLite once. */
export async function initOutbox(): Promise<{ storage: 'sqlite' | 'browser'; migrated: { drafts: number; operations: number } | null }> {
  const migrated = await migrateLegacyBrowserData().catch((e) => {
    console.error('[outbox] legacy migration failed; old data kept for retry', e);
    return null;
  });
  const store = getLocalStore();
  drafts.clear();
  for (const d of await store.listDrafts()) drafts.set(draftKey(d), { ...(d as StoredDraft & { language: LanguageId }) });
  await refreshCounts();
  initialized = true;
  return { storage: store.kind, migrated };
}

export const isOutboxReady = () => initialized;

export function recordEvent(eventType: string, ctx: Partial<ActivityEvent> = {}, metadata: ActivityEvent['metadata'] = {}): void {
  if (OFFLINE_FIRST) {
    // Offline-first (phase 05): events go to local SQLite via Rust and upload as C10 batches.
    queueActivity(eventType, { questionId: ctx.questionId, packId: ctx.packId, assessmentId: ctx.assessmentId, attemptId: ctx.attemptId, language: ctx.language }, metadata);
    return;
  }
  const event: ActivityEvent = { id: uuid(), eventType, clientTs: new Date().toISOString(), schemaVersion: 1, deviceSessionId: deviceSessionId(), ...ctx, metadata };
  void persist(() => getLocalStore().enqueue(event.id, 'EVENT', event.questionId ?? null, event));
}

export function recordSnapshot(s: Omit<Snapshot, 'id' | 'clientTs'>): void {
  const k = `${s.questionId}|${s.language}`;
  if (s.kind === 'EDIT' && lastSnapshot.get(k) === s.content) return; // nothing changed
  lastSnapshot.set(k, s.content);
  const snap: Snapshot = { ...s, id: uuid(), clientTs: new Date().toISOString() };
  void persist(() => getLocalStore().enqueue(snap.id, 'SNAPSHOT', snap.questionId, snap));
}

/** Queue a submission made offline. It is "waiting to upload", never "submitted", until the server confirms. */
export function queueSubmission(sub: Omit<QueuedSubmission, 'clientOperationId' | 'queuedAt'>): QueuedSubmission {
  const item: QueuedSubmission = { ...sub, clientOperationId: uuid(), queuedAt: new Date().toISOString() };
  void persist(() => getLocalStore().enqueue(item.clientOperationId, 'SUBMISSION', item.questionId, item));
  return item;
}

export function saveLocalDraft(d: Omit<LocalDraft, 'updatedAt' | 'synced'>): LocalDraft {
  const prev = drafts.get(draftKey(d));
  const draft = { ...d, updatedAt: new Date().toISOString(), synced: false, revision: (prev?.revision ?? 0) + 1 };
  drafts.set(draftKey(d), draft);
  void persist(async () => {
    const stored = await getLocalStore().saveDraft(d.questionId, d.assignmentId, d.language, d.content);
    const cur = drafts.get(draftKey(d));
    if (cur && cur.content === stored.content) drafts.set(draftKey(d), { ...cur, revision: stored.revision, updatedAt: stored.updatedAt });
  });
  return draft;
}

export const readDrafts = (): LocalDraft[] => [...drafts.values()];

export function getLocalDraft(questionId: string, assignmentId: string | null, language: LanguageId): LocalDraft | null {
  return drafts.get(draftKey({ questionId, assignmentId, language })) ?? null;
}

export function outboxCounts(): OutboxCounts {
  return counts;
}

// ---------- sync ----------
/** 4xx (except auth/timeout/rate-limit) means the server will never accept the payload. */
const isPermanent = (e: unknown) => e instanceof ApiRequestError && e.status >= 400 && e.status < 500 && ![401, 408, 409, 429].includes(e.status);
const isAuthFailure = (e: unknown) => e instanceof ApiRequestError && e.status === 401;
const codeOf = (e: unknown) => (e instanceof ApiRequestError ? `HTTP_${e.status}` : 'NETWORK');

let flushing: Promise<void> | null = null;

/**
 * Push everything that is due. Safe to call repeatedly. Items are removed only after the server
 * acknowledged them; transient failures back off (with jitter), permanent ones are parked and
 * shown in Settings, and an expired session pauses sync until the student signs in again.
 */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    await flushLocalWrites();
    const store = getLocalStore();

    // 1. Submissions, one at a time (server de-duplicates by clientOperationId).
    for (const item of await store.due('SUBMISSION', 20)) {
      const sub = JSON.parse(item.payloadJson) as QueuedSubmission;
      try {
        await submitCode(sub);
        await store.ack([item.operationId]);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lp-submission-synced', { detail: sub }));
      } catch (e) {
        if (isAuthFailure(e)) return;
        await store.fail(item.operationId, codeOf(e), isPermanent(e));
        if (!isPermanent(e)) return; // network/server trouble: retry later
      }
    }

    // 2. Drafts: mark synced only for the exact revision that was uploaded.
    for (const d of [...drafts.values()].filter((x) => !x.synced)) {
      try {
        await pushDraft({ questionId: d.questionId, assignmentId: d.assignmentId, language: d.language, content: d.content, clientUpdatedAt: d.updatedAt });
        await store.markDraftSynced(d.questionId, d.assignmentId, d.language, d.revision);
        const cur = drafts.get(draftKey(d));
        if (cur && cur.revision === d.revision) drafts.set(draftKey(d), { ...cur, synced: true });
      } catch (e) {
        if (isAuthFailure(e) || !isPermanent(e)) return;
      }
    }

    // 3. Code history and activity in bounded batches.
    for (const [type, send, size] of [
      ['SNAPSHOT', postSnapshots, 100],
      ['EVENT', postEvents, 250],
    ] as Array<[OperationType, (b: unknown[]) => Promise<unknown>, number]>) {
      for (;;) {
        const batch = await store.due(type, size);
        if (!batch.length) break;
        try {
          await send(batch.map((b) => JSON.parse(b.payloadJson)));
          await store.ack(batch.map((b) => b.operationId));
        } catch (e) {
          if (isAuthFailure(e)) return;
          for (const b of batch) await store.fail(b.operationId, codeOf(e), isPermanent(e));
          if (!isPermanent(e)) return;
        }
      }
    }
  })().finally(async () => {
    flushing = null;
    await refreshCounts().catch(() => undefined);
  });
  return flushing;
}

export function startBackgroundSync(intervalMs = 15_000): () => void {
  const tick = () => void flushOutbox().catch(() => undefined);
  const id = window.setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
  tick();
  return () => {
    window.clearInterval(id);
    window.removeEventListener('online', tick);
  };
}
