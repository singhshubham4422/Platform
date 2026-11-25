import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import {
  Card,
  ErrorState,
  LateBadge,
  Loading,
  PageHeader,
  RecheckBadge,
  SourceView,
  TableWrap,
  VerdictBadge,
} from '../../components/ui';
import { formatDateTime, label } from '../../lib/format';

export function StudentSubmissionDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const detail = useAsync(() => source.studentSubmission(userId, id), [userId, id]);

  if (detail.loading) return <Loading text="Loading submission…" />;
  if (detail.error) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const { submission, feedback, results } = detail.data;
  // Defence in depth: the student view never renders hidden test data even if it arrives.
  const visibleResults = results.filter((result) => result.hidden === false);

  return (
    <>
      <PageHeader
        eyebrow="Student · submission"
        title={`${submission.language} submission`}
        description={`Finished ${formatDateTime(submission.finished_at)}`}
        actions={
          <Link className="btn btn-small" to="/student/submissions">
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
        {submission.recheck_status !== 'NOT_REQUIRED' ? <RecheckBadge status={submission.recheck_status} /> : null}
      </div>
      <Card title="Source" description="Read-only copy of the code you submitted.">
        <SourceView source={submission.source} label="Your submitted source code" />
      </Card>
      <Card title="Results" description="Visible test results only. Hidden test data never reaches this page.">
        {visibleResults.length === 0 ? (
          <p className="muted">No visible test results are available for this submission.</p>
        ) : (
          <TableWrap label="Visible test results">
            <thead>
              <tr>
                <th>Test</th>
                <th>Verdict</th>
                <th className="num">Time</th>
                <th className="num">Memory</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((result) => (
                <tr key={result.testId}>
                  <td>{result.testId}</td>
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
      <Card title="Feedback" description="Feedback released by your teacher.">
        {feedback.length === 0 ? (
          <p className="muted">No released feedback yet.</p>
        ) : (
          <div className="stack">
            {feedback.map((entry) => (
              <div key={entry.id}>
                <p>{entry.body}</p>
                <p className="muted small">
                  {formatDateTime(entry.created_at)}
                  {entry.score_override !== null ? ` · score override ${entry.score_override}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
      {submission.recheck_status === 'DONE' && submission.recheck_verdict ? (
        <p className="muted small">Re-check verdict: {label(submission.recheck_verdict)}</p>
      ) : null}
    </>
  );
}
