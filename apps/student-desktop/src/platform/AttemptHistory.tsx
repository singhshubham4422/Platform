import { useEffect, useState } from 'react';
import { attemptsList, getCursor, type AttemptRow } from '../lib/offline-store';
import { cachedFeedback, type FeedbackItem } from '../lib/offline-sync';
import { verdictLabel } from '../lib/runner';

/** Local Submit history for one question (with upload state) and released teacher feedback. */
export function AttemptHistory({ packId, questionId, refreshKey }: { packId: string; questionId: string; refreshKey: unknown }) {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  useEffect(() => {
    void attemptsList(packId, questionId)
      .then((r) => setRows(r.filter((a) => a.mode === 'SUBMIT')))
      .catch(() => setRows([]));
    void cachedFeedback(getCursor, questionId)
      .then(setFeedback)
      .catch(() => setFeedback([]));
  }, [packId, questionId, refreshKey]);
  if (!rows.length && !feedback.length) return null;
  return (
    <div className="offline-history">
      {feedback.length > 0 && (
        <section aria-label="Teacher feedback">
          <h3>Teacher feedback</h3>
          {feedback.map((f) => (
            <blockquote key={f.submissionId + f.createdAt}>
              {f.body}
              {f.scoreOverride !== null && <small> · Score: {f.scoreOverride}</small>}
            </blockquote>
          ))}
        </section>
      )}
      {rows.length > 0 && (
        <section aria-label="Your submissions">
          <h3>Your submissions</h3>
          <ul>
            {rows.map((a) => (
              <li key={a.attemptId}>
                {new Date(a.finishedAt).toLocaleString()} · {a.language} · {verdictLabel(a.verdict)} ({a.passed}/{a.total}) ·{' '}
                {a.syncError ? `Refused: ${a.syncError}` : a.syncedAt ? 'Uploaded' : 'Saved on this computer — will upload when online'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
