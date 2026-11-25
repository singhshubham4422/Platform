import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { formatDateTime, formatNumber, label } from '../../lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  InlineSuccess,
  Loading,
  PageHeader,
  TableWrap,
} from '../../components/ui';
import type { AssessmentResultRow } from '../../data/types';

function recheckText(row: AssessmentResultRow): string {
  if (row.recheck_status === 'DONE') return 'Checked';
  if (row.recheck_status === 'FAILED') return 'Failed';
  if (row.recheck_status === 'QUEUED' || row.recheck_status === 'RUNNING') return 'Pending';
  return 'Not required';
}

function OverrideForm({ row, onSaved }: { row: AssessmentResultRow; onSaved: () => void }) {
  const source = useDataSource();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get('override') ?? '').trim();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await source.saveFeedback({
        submissionId: row.best_attempt_id,
        body: 'Score override',
        scoreOverride: raw === '' ? null : Number(raw),
        released: form.get('released') === 'on',
      });
      setNotice('Override saved.');
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="inline" onSubmit={(event) => void submit(event)} aria-label={`Override score for question ${row.question_id}`}>
      <Field label="Override" htmlFor={`override-${row.best_attempt_id}`}>
        <input
          id={`override-${row.best_attempt_id}`}
          name="override"
          type="number"
          min={0}
          max={row.question_points}
          step="0.5"
          defaultValue={row.score_override ?? ''}
          style={{ width: 90 }}
        />
      </Field>
      <label className="small">
        <input type="checkbox" name="released" defaultChecked /> Release
      </label>
      <button type="submit" className="btn btn-small" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {error ? <InlineError>{error}</InlineError> : null}
      {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
    </form>
  );
}

export function TeacherAssessmentResults() {
  const { assessmentId = '' } = useParams<{ assessmentId: string }>();
  const source = useDataSource();
  const detail = useAsync(() => source.getAssessment(assessmentId), [assessmentId]);
  const results = useAsync(() => source.teacherAssessmentResults(assessmentId), [assessmentId]);

  if (detail.loading || results.loading) return <Loading text="Loading results…" />;
  if (detail.error) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  if (results.error) return <ErrorState message={results.error.message} onRetry={results.reload} />;
  if (!detail.data || !results.data) return null;
  const { assessment, questions } = detail.data;
  const { rows, totals, kpi, profiles } = results.data;
  const questionTitle = (id: string) => questions.find((question) => question.id === id)?.title ?? id;
  const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.full_name ?? id;

  return (
    <>
      <PageHeader
        eyebrow="Teacher · results"
        title={`${assessment.title} results`}
        description={`${assessment.status} · closes ${formatDateTime(assessment.closes_at)}`}
        actions={
          <Link className="btn btn-small" to={`/teacher/assessments/${assessment.id}`}>
            Assessment settings
          </Link>
        }
      />
      {!rows.length ? (
        <EmptyState title="No attempts yet" description="Signed assessment attempts will appear here after students submit." />
      ) : (
        <>
          <Card title="Student totals" description="Score counts accepted final verdicts; late attempts score 0 unless a teacher overrides.">
            <TableWrap label="Student assessment totals">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Score</th>
                  <th>Solved</th>
                  <th>Questions</th>
                  <th>Pending re-checks</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((total) => {
                  const flags = kpi.find((row) => row.assessment_id === assessment.id && row.user_id === total.user_id)?.flags ?? [];
                  return (
                    <tr key={total.user_id}>
                      <td>{profileName(total.user_id)}</td>
                      <td>{formatNumber(Number(total.score), 1)}</td>
                      <td>{total.solved}/{total.questions}</td>
                      <td>{total.questions}</td>
                      <td>{total.pending_rechecks}</td>
                      <td>
                        <div className="inline">
                          {flags.length ? flags.map((flag) => <Badge key={flag} tone="amber">{label(flag)}</Badge>) : <span className="muted">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
          <Card title="Question results" description="Final verdict, lateness, central re-check and points earned.">
            <TableWrap label="Assessment question results">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Question</th>
                  <th>Final verdict</th>
                  <th>Late</th>
                  <th>Re-check</th>
                  <th>Attempts</th>
                  <th>Points</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.user_id}-${row.question_id}`}>
                    <td>{profileName(row.user_id)}</td>
                    <td>{questionTitle(row.question_id)}</td>
                    <td>
                      <Badge tone={row.final_verdict === 'ACCEPTED' ? 'green' : 'neutral'}>{label(row.final_verdict)}</Badge>
                    </td>
                    <td>{label(row.late_status)}</td>
                    <td>
                      <Badge tone={row.recheck_status === 'DONE' ? 'green' : row.recheck_status === 'FAILED' ? 'red' : row.recheck_status === 'NOT_REQUIRED' ? 'neutral' : 'amber'}>
                        {recheckText(row)}
                      </Badge>
                    </td>
                    <td>{row.attempts_used}</td>
                    <td>
                      {formatNumber(Number(row.points_earned), 1)} / {formatNumber(row.question_points, 1)}
                    </td>
                    <td>
                      <OverrideForm row={row} onSaved={results.reload} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}
