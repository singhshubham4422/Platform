import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { EmptyState, ErrorState, Loading, PageHeader, TableWrap, VerdictBadge } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function StudentSubmissions() {
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const submissions = useAsync(() => source.studentSubmissions(userId), [userId]);

  return (
    <>
      <PageHeader eyebrow="Student" title="Submissions" description="Every graded submission from your desktop app." />
      {submissions.loading ? (
        <Loading />
      ) : submissions.error ? (
        <ErrorState message={submissions.error.message} onRetry={submissions.reload} />
      ) : !submissions.data?.length ? (
        <EmptyState title="No submissions yet" description="Submit a solution from the desktop app while offline; it appears once synced." />
      ) : (
        <TableWrap label="Submissions">
          <thead>
            <tr>
              <th>Verdict</th>
              <th>Language</th>
              <th>Tests</th>
              <th>Assessment</th>
              <th>Finished</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.data.map((submission) => (
              <tr key={submission.id}>
                <td>
                  <VerdictBadge verdict={submission.verdict} />
                </td>
                <td>{submission.language}</td>
                <td className="num">
                  {submission.passed}/{submission.total}
                </td>
                <td>{submission.assessment_id ? 'Assessment' : 'Practice'}</td>
                <td>{formatDateTime(submission.finished_at)}</td>
                <td>
                  <Link className="btn btn-small" to={`/student/submissions/${submission.id}`}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
