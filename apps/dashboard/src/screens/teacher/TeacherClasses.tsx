import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader } from '../../components/ui';

export function TeacherClasses() {
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const classes = useAsync(() => source.teacherClasses(userId), [userId]);

  return (
    <>
      <PageHeader eyebrow="Teacher" title="Classes" description="Classes where you are a teacher. Student KPIs are scoped to your class." />
      {classes.loading ? (
        <Loading />
      ) : classes.error ? (
        <ErrorState message={classes.error.message} onRetry={classes.reload} />
      ) : !classes.data?.length ? (
        <EmptyState title="No classes yet" description="A college admin adds you as a teacher of a class." />
      ) : (
        <div className="grid-2">
          {classes.data.map((klass) => (
            <Card key={klass.id} title={klass.name} description={`${klass.code}${klass.academic_year ? ` · ${klass.academic_year}` : ''}`}>
              <div className="inline">
                <Badge>{klass.semester ? `Semester ${klass.semester}` : 'No semester'}</Badge>
                <Link className="btn btn-small" to={`/teacher/classes/${klass.id}`}>
                  Open class
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
