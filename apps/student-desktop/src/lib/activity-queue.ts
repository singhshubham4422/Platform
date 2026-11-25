// Offline-first activity capture (C10). Events get the signed-in identity here and are handed to
// Rust (`activity_append`) in small batches; Rust assigns `seq` and `deviceId`.
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface ActivityIdentity {
  userId: string;
  organizationId: string | null;
}

export interface ActivityContext {
  questionId?: string | null;
  packId?: string | null;
  assessmentId?: string | null;
  attemptId?: string | null;
  language?: string | null;
}

type Metadata = Record<string, string | number | boolean | null>;

let identity: ActivityIdentity | null = null;
let buffer: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sink: (events: Record<string, unknown>[]) => Promise<unknown> = (events) =>
  isTauri() ? invoke<number>('activity_append', { events }) : Promise.resolve(0);

const FLUSH_MS = 2000;
const FLUSH_COUNT = 50;

export function setActivityIdentity(next: ActivityIdentity | null): void {
  identity = next;
}

/** For tests only. */
export function setActivitySinkForTests(fn: typeof sink): void {
  sink = fn;
}

export function queueActivity(eventType: string, ctx: ActivityContext = {}, metadata: Metadata = {}): void {
  if (!identity) return; // not signed in: nothing is attributed to anyone
  buffer.push({
    eventId: crypto.randomUUID(),
    eventType,
    clientTs: new Date().toISOString(),
    userId: identity.userId,
    organizationId: identity.organizationId,
    packId: ctx.packId ?? null,
    questionId: ctx.questionId ?? null,
    assessmentId: ctx.assessmentId ?? null,
    attemptId: ctx.attemptId ?? null,
    language: ctx.language ?? null,
    schemaVersion: 2,
    metadata,
  });
  if (buffer.length >= FLUSH_COUNT) void flushActivity();
  else if (!timer) timer = setTimeout(() => void flushActivity(), FLUSH_MS);
}

/** Hands buffered events to local storage. On failure they are put back for the next try. */
export async function flushActivity(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  try {
    await sink(batch);
  } catch (e) {
    buffer = [...batch, ...buffer];
    console.error('[activity] local append failed; will retry', e);
  }
}
