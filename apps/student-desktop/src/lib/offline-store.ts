// Typed wrappers for the phase 05 Tauri commands (C6).
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { TestResult } from './runner';

export interface AttemptRow {
  attemptId: string;
  packId: string;
  questionId: string;
  assessmentId: string | null;
  language: string;
  mode: 'RUN' | 'SUBMIT';
  source: string;
  sourceSha256: string;
  verdict: string;
  passed: number;
  total: number;
  totalTimeMs: number;
  results: TestResult[];
  startedAt: string;
  finishedAt: string;
  monotonicSeq: number;
  signature: string | null;
  deviceId: string;
  syncedAt: string | null;
  syncError: string | null;
}

export interface SealedBatch {
  batchId: string;
  gzBase64: string;
  sha256: string;
  sizeBytes: number;
  eventCount: number;
}

export interface DeviceInfo {
  deviceId: string;
  publicKey: string;
  monotonicSeq: number;
}

export interface ActivityCounts {
  pendingEvents: number;
  pendingBatches: number;
}

const desktop = () => {
  if (!isTauri()) throw new Error('DESKTOP_ONLY');
};

export const attemptsList = (packId?: string, questionId?: string) => (desktop(), invoke<AttemptRow[]>('attempts_list', { packId: packId ?? null, questionId: questionId ?? null }));
export const attemptsDue = (limit: number) => (desktop(), invoke<AttemptRow[]>('attempts_due', { limit }));
export const attemptsAck = (attemptIds: string[]) => (desktop(), invoke<number>('attempts_ack', { attemptIds }));
export const attemptsPark = (attemptId: string, error: string) => (desktop(), invoke<number>('attempts_park', { attemptId, error }));
export const activitySealBatch = (maxEvents = 2000) => (desktop(), invoke<SealedBatch | null>('activity_seal_batch', { maxEvents }));
export const activityAckBatch = (batchId: string) => (desktop(), invoke<void>('activity_ack_batch', { batchId }));
export const activityCounts = () => (desktop(), invoke<ActivityCounts>('activity_counts'));
export const deviceInfo = () => (desktop(), invoke<DeviceInfo>('device_info'));
export const getCursor = (stream: string) => (desktop(), invoke<string | null>('store_get_cursor', { stream }));
export const setCursor = (stream: string, value: string) => (desktop(), invoke<void>('store_set_cursor', { stream, value }));
