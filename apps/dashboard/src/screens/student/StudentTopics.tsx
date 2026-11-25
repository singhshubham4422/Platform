import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { MasteryBar } from '../../components/charts';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../../components/ui';

export function StudentTopics() {
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const topics = useAsync(() => source.studentTopics(userId), [userId]);

  return (
    <>
      <PageHeader eyebrow="Student" title="Topics" description="All-time mastery by topic, calculated from your sealed activity and submissions." />
      <Card>
        {topics.loading ? (
          <Loading />
        ) : topics.error ? (
          <ErrorState message={topics.error.message} onRetry={topics.reload} />
        ) : !topics.data?.length ? (
          <EmptyState title="No topic mastery yet" description="Solve questions from a course pack; topics come from the published question bank." />
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {topics.data.map((topic) => (
              <div key={topic.topic}>
                <MasteryBar value={topic.mastery} label={topic.topic} />
                <div className="muted small">
                  {topic.solved} solved · {topic.attempted} attempted
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
