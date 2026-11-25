import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import {
  Card,
  ErrorState,
  Field,
  InlineError,
  InlineSuccess,
  LateBadge,
  Loading,
  PageHeader,
  RecheckBadge,
  SourceView,
  TableWrap,
  VerdictBadge,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function TeacherReview() {
  const { submissionId = '' } = useParams<{ submissionId: string }>();
  const source = useDataSource();
  const detail = useAsync(() => source.reviewSubmission(submissionId), [submissionId]);
  const [body, setBody] = useState('');
  const [scoreOverride, setScoreOverride] = useState('');
  const [released, setReleased] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.loading) return <Loading text="Loading submission…" />;
  if (detail.error) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const { submission, results, feedback } = detail.data;

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const override = scoreOverride.trim() === '' ? null : Number(scoreOverride);
      if (override !== null && (!Number.isFinite(override) || override < 0)) throw new Error('Score override must be a non-negative number');
      await source.saveFeedback({ submissionId, body: body.trim(), scoreOverride: override, released });
      setBody('');
      setScoreOverride('');
      setReleased(false);
      setSaved(true);
      detail.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Teacher · code review"
        title="Review submission"
        description={`${submission.language} · finished ${formatDateTime(submission.finished_at)}`}
        actions={
          <Link className="btn btn-small" to="/teacher">
            Back
          </Link>
        }
      />
      <div className="inline">
        <VerdictBadge verdict={submission.verdict} />
        <span className="muted small">
          {submission.passed}/{submission.total} tests · {submission.total_time_ms} ms
        </span>
        {submission.late_status ? <LateBadge status={submission.late_status} /> : null}
        <RecheckBadge status={submission.recheck_status} />
        {submission.recheck_status === 'DONE' && submission.recheck_verdict ? (
          <span className="muted small">
            Re-check: {submission.recheck_verdict} ({submission.recheck_passed}/{submission.recheck_total})
          </span>
        ) : null}
      </div>
      <Card title="Source" description="Submitted code, read-only. The source is never executed in this browser.">
        <SourceView source={submission.source} label="Submitted source code" />
      </Card>
      <Card title="Test results" description="Teachers can see hidden test results for their classes.">
        {results.length === 0 ? (
          <p className="muted">No stored results.</p>
        ) : (
          <TableWrap label="Test results">
            <thead>
              <tr>
                <th>Test</th>
                <th>Hidden</th>
                <th>Verdict</th>
                <th className="num">Time</th>
                <th className="num">Memory</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.testId}>
                  <td>{result.testId}</td>
                  <td>{result.hidden ? 'Hidden' : 'Visible'}</td>
                  <td>
                    <VerdictBadge verdict={result.verdict} />
                  </td>
                  <td className="num">{result.timeMs} ms</td>
                  <td className="num">{result.memoryKb} KB</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <Card title="Feedback" description="Saved feedback is visible to the student only when released.">
        {feedback.length ? (
          <div className="stack" style={{ marginBottom: 14 }}>
            {feedback.map((entry) => (
              <div key={entry.id}>
                <p>{entry.body}</p>
                <p className="muted small">
                  {formatDateTime(entry.created_at)} · {entry.released ? 'Released' : 'Draft'} · score override{' '}
                  {entry.score_override ?? 'none'}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        <form className="form-stack" onSubmit={onSave}>
          {error ? <InlineError>{error}</InlineError> : null}
          {saved ? <InlineSuccess>Feedback saved.</InlineSuccess> : null}
          <Field label="Feedback" htmlFor="feedback-body">
            <textarea id="feedback-body" value={body} onChange={(event) => setBody(event.target.value)} required />
          </Field>
          <Field label="Score override (optional)" htmlFor="feedback-score" hint="Replaces the assessment points for this submission.">
            <input
              id="feedback-score"
              type="number"
              min={0}
              step="0.5"
              value={scoreOverride}
              onChange={(event) => setScoreOverride(event.target.value)}
            />
          </Field>
          <div className="checkbox-row">
            <label>
              <input type="checkbox" checked={released} onChange={(event) => setReleased(event.target.checked)} />
              Release to student
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving || !body.trim()}>
            {saving ? 'Saving…' : 'Save feedback'}
          </button>
        </form>
      </Card>
    </>
  );
}
