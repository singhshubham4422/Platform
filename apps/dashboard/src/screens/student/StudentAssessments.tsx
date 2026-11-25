import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { Badge, Card, EmptyState, ErrorState, FlagBadge, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatNumber } from '../../lib/format';

export function StudentAssessments() {
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const assessments = useAsync(() => source.studentAssessments(userId), [userId]);

  return (
    <>
      <PageHeader eyebrow="Student" title="Assessments" description="Scheduled assessments and your released results." />
      {assessments.loading ? (
        <Loading />
      ) : assessments.error ? (
        <ErrorState message={assessments.error.message} onRetry={assessments.reload} />
      ) : !assessments.data?.length ? (
        <EmptyState title="No assessments" description="Scheduled assessments for your classes will appear here." />
      ) : (
        <div className="grid-2">
          {assessments.data.map(({ assessment, result, feedback }) => (
            <Card key={assessment.id} title={assessment.title} description={`Opens ${formatDateTime(assessment.opens_at)} · closes ${formatDateTime(assessment.closes_at)}`}>
              <div className="inline">
                <Badge tone={assessment.high_stakes ? 'amber' : 'blue'}>{assessment.high_stakes ? 'High stakes' : 'Practice'}</Badge>
                {assessment.status === 'CLOSED' ? <Badge>Closed</Badge> : <Badge tone="green">Scheduled</Badge>}
              </div>
              {result ? (
                <>
                  <div className="grid" style={{ marginTop: 12 }}>
                    <div>
                      <div className="stat-label">Score</div>
                      <div className="stat-value">{formatNumber(result.score, 1)}</div>
                    </div>
                    <div>
                      <div className="stat-label">Solved</div>
                      <div className="stat-value">
                        {result.solved}/{result.total_questions}
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">Time</div>
                      <div className="stat-value">{formatNumber(result.time_minutes, 1)} min</div>
                    </div>
                  </div>
                  {result.flags.length ? (
                    <div className="inline" style={{ marginTop: 8 }}>
                      {result.flags.map((flag) => (
                        <FlagBadge key={flag} flag={flag} />
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="muted small" style={{ marginTop: 10 }}>
                  Results are published after the assessment closes.
                </p>
              )}
              {feedback.length ? (
                <div className="stack" style={{ marginTop: 10 }}>
                  {feedback.map((entry) => (
                    <p key={entry.id} className="small">
                      {entry.body}
                    </p>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
