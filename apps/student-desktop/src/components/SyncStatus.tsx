import React, { useEffect, useState } from 'react';
import type { OfflineSync, SyncStatus as Status } from '../lib/offline-sync';

const STATE_LABEL: Record<Status['state'], string> = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline — work is saved on this computer',
  'paused-auth': 'Sign in to sync',
  backoff: 'Sync failed — will retry',
};

/** Pending uploads, parked errors, last sync time and a Sync now button. */
export const SyncStatus: React.FC<{ engine: OfflineSync }> = ({ engine }) => {
  const [s, setS] = useState<Status>(engine.status);
  useEffect(() => engine.subscribe(setS), [engine]);
  return (
    <section className="sync-status" aria-label="Sync status" style={{ padding: 12, borderTop: '1px solid var(--border, #e5e7eb)', fontSize: 13 }}>
      <p style={{ margin: 0, fontWeight: 600 }} role="status">
        {STATE_LABEL[s.state]}
      </p>
      <p style={{ margin: '4px 0' }}>
        {s.pendingSubmissions} submission{s.pendingSubmissions === 1 ? '' : 's'} waiting to upload · {s.pendingBatches} activity batch{s.pendingBatches === 1 ? '' : 'es'}
      </p>
      {s.lastSuccessAt && <p style={{ margin: '4px 0' }}>Last synced {new Date(s.lastSuccessAt).toLocaleString()}</p>}
      {s.lastError && s.state !== 'idle' && (
        <p style={{ margin: '4px 0' }} className="muted-text">
          {s.lastError}
        </p>
      )}
      {s.parked.length > 0 && (
        <details>
          <summary>{s.parked.length} submission(s) refused by the server</summary>
          <ul>
            {s.parked.map((p) => (
              <li key={p.attemptId}>
                {p.attemptId.slice(0, 8)} — {p.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.updatesAvailable.length > 0 && <p style={{ margin: '4px 0' }}>{s.updatesAvailable.length} large course update(s) available in Platform.</p>}
      <button className="btn btn-secondary btn-sm" disabled={s.state === 'syncing'} onClick={() => void engine.syncNow()}>
        Sync now
      </button>
    </section>
  );
};
