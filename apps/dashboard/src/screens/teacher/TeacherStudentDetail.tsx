import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { ActiveMinutesChart, MasteryBar } from '../../components/charts';
import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  TableWrap,
  VerdictBadge,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function TeacherStudentDetail() {
  const { classId = '', studentId = '' } = useParams<{ classId: string; studentId: string }>();
  const source = useDataSource();
  const drilldown = useAsync(() => source.studentDrilldown(studentId), [studentId]);

  if (drilldown.loading) return <Loading text="Loading student…" />;
  if (drilldown.error) return <ErrorState message={drilldown.error.message} onRetry={drilldown.reload} />;
  if (!drilldown.data) return null;
  const { daily, topics, submissions, profile } = drilldown.data;

  return (
    <>
      <PageHeader
        eyebrow="Teacher · student"
        title={profile?.full_name ?? 'Student'}
        description={profile?.email ?? 'Daily KPIs, topic mastery and submissions.'}
        actions={
          <Link className="btn btn-small" to={`/teacher/classes/${classId}`}>
            Back to class
          </Link>
        }
      />
      <Card title="Daily activity" description="Active minutes over the last 30 days.">
        {daily.length ? <ActiveMinutesChart daily={daily} /> : <EmptyState title="No daily KPI rows" description="The student has no synced activity in this window." />}
      </Card>
      <Card title="Topic mastery">
        {topics.length ? (
          <div className="stack" style={{ gap: 14 }}>
            {topics.map((topic) => (
              <div key={topic.topic}>
                <MasteryBar value={topic.mastery} label={topic.topic} />
                <div className="muted small">
                  {topic.solved} solved · {topic.attempted} attempted
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No topic rows" />
        )}
      </Card>
      <Card title="Submissions">
        {submissions.length === 0 ? (
          <EmptyState title="No submissions" />
        ) : (
          <TableWrap label="Student submissions">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Language</th>
                <th>Tests</th>
                <th>Finished</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    <VerdictBadge verdict={submission.verdict} />
                  </td>
                  <td>{submission.language}</td>
                  <td className="num">
                    {submission.passed}/{submission.total}
                  </td>
                  <td>{formatDateTime(submission.finished_at)}</td>
                  <td>
                    <Link className="btn btn-small" to={`/teacher/review/${submission.id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
