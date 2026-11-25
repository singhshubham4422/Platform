// Wires the offline sync engine to the real Tauri store, Supabase and the broker.
import { OfflineSync, type SyncSupabase } from './offline-sync';
import { getSupabase } from './supabase-client';
import { callBroker } from './broker';
import * as store from './offline-store';
import { installPackFromBroker, listCatalog, packsList } from './packs';

let engine: OfflineSync | null = null;

export function getOfflineSync(): OfflineSync {
  if (engine) return engine;
  engine = new OfflineSync({
    sb: getSupabase() as unknown as SyncSupabase,
    broker: (name, body) => callBroker(name, body),
    fetchImpl: (...args) => fetch(...args),
    isOnline: () => navigator.onLine,
    store: {
      attemptsDue: store.attemptsDue,
      attemptsAck: store.attemptsAck,
      attemptsPark: store.attemptsPark,
      attemptsListParked: async () => (await store.attemptsList()).filter((a) => a.syncError),
      activitySealBatch: store.activitySealBatch,
      activityAckBatch: store.activityAckBatch,
      activityCounts: store.activityCounts,
      deviceInfo: store.deviceInfo,
      getCursor: store.getCursor,
      setCursor: store.setCursor,
    },
    packs: { list: packsList, catalog: listCatalog, install: installPackFromBroker },
  });
  return engine;
}
