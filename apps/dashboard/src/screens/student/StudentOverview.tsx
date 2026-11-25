import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { ActiveMinutesChart } from '../../components/charts';
import { Card, EmptyState, ErrorState, Loading, PageHeader, Stat, VerdictBadge } from '../../components/ui';
import { formatDate, formatNumber } from '../../lib/format';

export function StudentOverview() {
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const overview = useAsync(() => source.studentOverview(userId), [userId]);
  const recent = useAsync(() => source.studentSubmissions(userId), [userId]);

  if (overview.loading || recent.loading) return <Loading text="Loading your progress…" />;
  if (overview.error) return <ErrorState message={overview.error.message} onRetry={overview.reload} />;
  if (recent.error) return <ErrorState message={recent.error.message} onRetry={recent.reload} />;

  const data = overview.data;
  const minutes = data?.daily.reduce((sum, day) => sum + Number(day.active_minutes), 0) ?? 0;
  const submissions = recent.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Student"
        title={`Welcome, ${profile?.full_name ?? 'student'}`}
        description="Your last 30 days of verified activity and submissions."
      />
      <div className="grid">
        <Stat label="Active minutes (30 days)" value={formatNumber(minutes, 1)} />
        <Stat label="Questions solved" value={formatNumber(data?.solved ?? 0)} hint={`${formatNumber(data?.attempted ?? 0)} attempted`} />
        <Stat label="Current streak" value={`${formatNumber(data?.streak ?? 0)} days`} hint="Consecutive days with activity" />
        <Stat label="Submissions" value={formatNumber(submissions.length)} />
      </div>

      <Card title="Active minutes" description="Daily active minutes recorded from your desktop activity.">
        {data && data.daily.length > 0 ? (
          <ActiveMinutesChart daily={data.daily} />
        ) : (
          <EmptyState title="No activity recorded yet" description="Use the desktop app offline or online; your sealed activity batches appear here after sync." />
        )}
      </Card>

      <Card
        title="Recent submissions"
        description="Your newest graded attempts."
        actions={<Link className="btn btn-small" to="/student/submissions">All submissions</Link>}
      >
        {submissions.length === 0 ? (
          <EmptyState title="No submissions yet" description="Submit a solution from the desktop app to see the verdict here." />
        ) : (
          <div className="stack">
            {submissions.slice(0, 5).map((submission) => (
              <div className="row-between" key={submission.id}>
                <div>
                  <Link to={`/student/submissions/${submission.id}`} style={{ fontWeight: 600 }}>
                    {submission.language} · {submission.passed}/{submission.total} tests
                  </Link>
                  <div className="muted small">{formatDate(submission.finished_at)}</div>
                </div>
                <VerdictBadge verdict={submission.verdict} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
