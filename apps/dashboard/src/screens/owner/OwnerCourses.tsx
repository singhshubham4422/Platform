import { useState } from 'react';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { Badge, Card, EmptyState, ErrorState, InlineError, InlineSuccess, Loading, PageHeader, TableWrap } from '../../components/ui';
import { formatDate } from '../../lib/format';

export function OwnerCourses() {
  const source = useDataSource();
  const courses = useAsync(() => source.ownerCourses(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publish = async (courseId: string) => {
    setBusy(courseId);
    setError(null);
    setNotice(null);
    try {
      const result = await source.publishCourse(courseId);
      setNotice(`Published ${result.packId} (version ${result.version}).`);
      courses.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform owner"
        title="Platform-wide practice courses"
        description="Courses with no organization are available to every signed-in student."
      />
      <div aria-live="polite" className="stack">
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      </div>
      <Card>
        {courses.loading ? (
          <Loading />
        ) : courses.error ? (
          <ErrorState message={courses.error.message} onRetry={courses.reload} />
        ) : !courses.data?.length ? (
          <EmptyState title="No platform courses" description="A course with organization_id NULL appears here." />
        ) : (
          <TableWrap label="Platform courses">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Content</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {courses.data.map((course) => (
                <tr key={course.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{course.title}</div>
                    <div className="muted small">{course.languages.join(', ')}</div>
                  </td>
                  <td>
                    <Badge tone={course.status === 'PUBLISHED' ? 'green' : 'amber'}>{course.status}</Badge>
                  </td>
                  <td>
                    {course.content_status === 'IMPORTED_UNREVIEWED' ? <Badge tone="amber">Imported, unreviewed</Badge> : <Badge tone="green">Reviewed</Badge>}
                  </td>
                  <td>{formatDate(course.updated_at)}</td>
                  <td>
                    <button type="button" className="btn btn-small btn-primary" disabled={busy === course.id} onClick={() => void publish(course.id)}>
                      {busy === course.id ? 'Publishing…' : 'Publish'}
                    </button>
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
