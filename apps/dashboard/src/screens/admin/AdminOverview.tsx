import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { OrgOverviewChart } from '../../components/charts';
import { Card, EmptyState, ErrorState, Loading, PageHeader, Stat } from '../../components/ui';
import { formatNumber } from '../../lib/format';

export function AdminOverview() {
  const source = useDataSource();
  const overview = useAsync(() => source.orgOverview(), []);
  const classes = useAsync(() => source.adminClasses(), []);
  const departments = useAsync(() => source.adminDepartments(), []);

  const loading = overview.loading || classes.loading || departments.loading;
  const error = overview.error ?? classes.error ?? departments.error;
  const latest = overview.data?.[overview.data.length - 1];

  return (
    <>
      <PageHeader eyebrow="College admin" title="Organization overview" description="Active students per day across every class in your organization." />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState
          message={error.message}
          onRetry={() => {
            overview.reload();
            classes.reload();
            departments.reload();
          }}
        />
      ) : (
        <>
          <div className="grid">
            <Stat label="Classes" value={formatNumber(classes.data?.length ?? 0)} />
            <Stat label="Departments" value={formatNumber(departments.data?.length ?? 0)} />
            <Stat label="Active students (latest day)" value={formatNumber(latest?.activeStudents ?? 0)} hint={latest?.day ?? 'No KPI rows yet'} />
            <Stat label="Avg active minutes (latest day)" value={formatNumber(latest?.avgActiveMinutes ?? 0, 1)} />
          </div>
          <Card title="Daily active students" description="Aggregated from kpi_class_daily across the organization.">
            {overview.data?.length ? (
              <OrgOverviewChart points={overview.data} />
            ) : (
              <EmptyState title="No KPI rows yet" description="The KPI pipeline publishes rows after activity sync is processed." />
            )}
          </Card>
        </>
      )}
    </>
  );
}
