// Persistence backend for drafts and the sync outbox.
//
// In the desktop app this is the native SQLite database (src-tauri/src/store.rs) behind Tauri
// commands. When the frontend runs outside Tauri (Vite dev server in a browser, unit tests) a
// localStorage implementation with the same semantics is used. Auth secrets never go here.
import { invoke, isTauri } from '@tauri-apps/api/core';

export type OperationType = 'EVENT' | 'SNAPSHOT' | 'SUBMISSION';

export interface StoredDraft {
  questionId: string;
  assignmentId: string | null;
  language: string;
  content: string;
  updatedAt: string;
  synced: boolean;
  revision: number;
}

export interface OutboxItem {
  operationId: string;
  operationType: OperationType;
  payloadJson: string;
  attemptCount: number;
}

export interface StoreCounts {
  events: number;
  snapshots: number;
  submissions: number;
  unsyncedDrafts: number;
  failed: number;
}

export interface LocalStore {
  readonly kind: 'sqlite' | 'browser';
  saveDraft(questionId: string, assignmentId: string | null, language: string, content: string): Promise<StoredDraft>;
  listDrafts(): Promise<StoredDraft[]>;
  markDraftSynced(questionId: string, assignmentId: string | null, language: string, revision: number): Promise<void>;
  enqueue(operationId: string, type: OperationType, entityId: string | null, payload: unknown): Promise<boolean>;
  due(type: OperationType, limit: number): Promise<OutboxItem[]>;
  ack(operationIds: string[]): Promise<void>;
  fail(operationId: string, errorCode: string, permanent: boolean): Promise<void>;
  counts(): Promise<StoreCounts>;
}

const jitter = () => Math.round(Math.random() * 40 - 20);

class SqliteStore implements LocalStore {
  readonly kind = 'sqlite' as const;
  saveDraft(questionId: string, assignmentId: string | null, language: string, content: string) {
    return invoke<StoredDraft>('store_save_draft', { questionId, assignmentId, language, content });
  }
  listDrafts() {
    return invoke<StoredDraft[]>('store_list_drafts');
  }
  async markDraftSynced(questionId: string, assignmentId: string | null, language: string, revision: number) {
    await invoke('store_mark_draft_synced', { questionId, assignmentId, language, revision });
  }
  enqueue(operationId: string, operationType: OperationType, entityId: string | null, payload: unknown) {
    return invoke<boolean>('store_enqueue', { operationId, operationType, entityId, payloadJson: JSON.stringify(payload) });
  }
  due(operationType: OperationType, limit: number) {
    return invoke<OutboxItem[]>('store_due', { operationType, limit });
  }
  async ack(operationIds: string[]) {
    await invoke('store_ack', { operationIds });
  }
  async fail(operationId: string, errorCode: string, permanent: boolean) {
    await invoke('store_fail', { operationId, errorCode, permanent, jitterPct: jitter() });
  }
  counts() {
    return invoke<StoreCounts>('store_counts');
  }
}

interface BrowserOp extends OutboxItem {
  createdAt: number;
  nextAttemptAt: number;
  state: 'PENDING' | 'FAILED_PERMANENT';
}

/** Same semantics as the SQLite store, persisted in localStorage (non-Tauri contexts only). */
export class BrowserStore implements LocalStore {
  readonly kind = 'browser' as const;
  private read<T>(key: string): T[] {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
    } catch {
      return [];
    }
  }
  private write(key: string, v: unknown) {
    localStorage.setItem(key, JSON.stringify(v));
  }
  private key = (d: { questionId: string; assignmentId: string | null; language: string }) => `${d.questionId}|${d.assignmentId ?? ''}|${d.language}`;

  async saveDraft(questionId: string, assignmentId: string | null, language: string, content: string) {
    const all = this.read<StoredDraft>('lp_store_drafts');
    const prev = all.find((d) => this.key(d) === this.key({ questionId, assignmentId, language }));
    const draft: StoredDraft = { questionId, assignmentId, language, content, updatedAt: new Date().toISOString(), synced: false, revision: (prev?.revision ?? 0) + 1 };
    this.write('lp_store_drafts', [...all.filter((d) => d !== prev), draft]);
    return draft;
  }
  async listDrafts() {
    return this.read<StoredDraft>('lp_store_drafts');
  }
  async markDraftSynced(questionId: string, assignmentId: string | null, language: string, revision: number) {
    const k = this.key({ questionId, assignmentId, language });
    this.write('lp_store_drafts', this.read<StoredDraft>('lp_store_drafts').map((d) => (this.key(d) === k && d.revision === revision ? { ...d, synced: true } : d)));
  }
  async enqueue(operationId: string, operationType: OperationType, _entityId: string | null, payload: unknown) {
    const ops = this.read<BrowserOp>('lp_store_outbox');
    if (ops.some((o) => o.operationId === operationId)) return false;
    ops.push({ operationId, operationType, payloadJson: JSON.stringify(payload), attemptCount: 0, createdAt: Date.now(), nextAttemptAt: 0, state: 'PENDING' });
    this.write('lp_store_outbox', ops);
    return true;
  }
  async due(type: OperationType, limit: number) {
    const now = Date.now();
    return this.read<BrowserOp>('lp_store_outbox')
      .filter((o) => o.operationType === type && o.state === 'PENDING' && o.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }
  async ack(ids: string[]) {
    const set = new Set(ids);
    this.write('lp_store_outbox', this.read<BrowserOp>('lp_store_outbox').filter((o) => !set.has(o.operationId)));
  }
  async fail(operationId: string, errorCode: string, permanent: boolean) {
    this.write(
      'lp_store_outbox',
      this.read<BrowserOp>('lp_store_outbox').map((o) =>
        o.operationId !== operationId
          ? o
          : {
              ...o,
              attemptCount: o.attemptCount + 1,
              state: permanent ? 'FAILED_PERMANENT' : 'PENDING',
              nextAttemptAt: permanent ? o.nextAttemptAt : Date.now() + Math.min(3_600_000, 5000 * 2 ** Math.min(o.attemptCount, 10)) * (1 + jitter() / 100),
              lastErrorCode: errorCode,
            },
      ),
    );
  }
  async counts() {
    const ops = this.read<BrowserOp>('lp_store_outbox');
    const pending = (t: OperationType) => ops.filter((o) => o.operationType === t && o.state === 'PENDING').length;
    return {
      events: pending('EVENT'),
      snapshots: pending('SNAPSHOT'),
      submissions: pending('SUBMISSION'),
      unsyncedDrafts: this.read<StoredDraft>('lp_store_drafts').filter((d) => !d.synced).length,
      failed: ops.filter((o) => o.state === 'FAILED_PERMANENT').length,
    };
  }
}

let store: LocalStore | null = null;
export function getLocalStore(): LocalStore {
  store ??= isTauri() ? new SqliteStore() : new BrowserStore();
  return store;
}

/** For tests. */
export function setLocalStore(s: LocalStore): void {
  store = s;
}

/**
 * One-time migration of data kept by v0.4 in webview localStorage (`lp_ws_*`) into SQLite.
 * The old keys are removed only after the native import committed.
 */
export async function migrateLegacyBrowserData(): Promise<{ drafts: number; operations: number } | null> {
  if (!isTauri()) return null;
  const read = (k: string) => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[];
    } catch {
      return [];
    }
  };
  const keys = ['lp_ws_drafts', 'lp_ws_outbox_events', 'lp_ws_outbox_snapshots', 'lp_ws_outbox_submissions'];
  if (!keys.some((k) => localStorage.getItem(k))) return null;
  const exportData = {
    drafts: read('lp_ws_drafts'),
    events: read('lp_ws_outbox_events'),
    snapshots: read('lp_ws_outbox_snapshots'),
    submissions: read('lp_ws_outbox_submissions'),
  };
  // Keep a recoverable copy until the import succeeded.
  localStorage.setItem('lp_legacy_export_backup', JSON.stringify(exportData));
  const [drafts, operations] = await invoke<[number, number]>('store_import_legacy', { export: exportData });
  for (const k of keys) localStorage.removeItem(k);
  localStorage.removeItem('lp_legacy_export_backup');
  return { drafts, operations };
}
