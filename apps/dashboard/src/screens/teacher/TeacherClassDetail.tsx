import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { ClassDailyChart } from '../../components/charts';
import {
  Card,
  EmptyState,
  ErrorState,
  FlagBadge,
  Loading,
  PageHeader,
  TableWrap,
} from '../../components/ui';
import { formatNumber, formatPercent, label } from '../../lib/format';

type SortKey = 'name' | 'activeMinutes' | 'solved' | 'pasteRatio';

export function TeacherClassDetail() {
  const { classId = '' } = useParams<{ classId: string }>();
  const { profile } = useAuth();
  const source = useDataSource();
  const userId = profile?.id ?? '';
  const classes = useAsync(() => source.teacherClasses(userId), [userId]);
  const daily = useAsync(() => source.classDaily(classId), [classId]);
  const students = useAsync(() => source.classStudents(classId), [classId]);
  const [sort, setSort] = useState<SortKey>('activeMinutes');
  const [ascending, setAscending] = useState(false);
  const [filter, setFilter] = useState('');

  const klass = classes.data?.find((row) => row.id === classId);
  const rows = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const filtered = (students.data ?? []).filter(
      (student) => !text || student.fullName.toLowerCase().includes(text) || student.email.toLowerCase().includes(text),
    );
    return [...filtered].sort((a, b) => {
      const factor = ascending ? 1 : -1;
      if (sort === 'name') return a.fullName.localeCompare(b.fullName) * factor;
      if (sort === 'pasteRatio') return ((a.pasteRatio ?? -1) - (b.pasteRatio ?? -1)) * factor;
      return ((a[sort] as number) - (b[sort] as number)) * factor;
    });
  }, [students.data, filter, sort, ascending]);

  const changeSort = (key: SortKey) => {
    if (sort === key) setAscending((value) => !value);
    else {
      setSort(key);
      setAscending(key === 'name');
    }
  };

  if (classes.loading) return <Loading />;
  if (classes.error) return <ErrorState message={classes.error.message} onRetry={classes.reload} />;
  if (classes.data && !klass) return <ErrorState message="Class not found or not visible to you" />;

  return (
    <>
      <PageHeader eyebrow="Teacher · class" title={klass?.name ?? 'Class'} description="Class KPIs and student activity for the last 30 days." />
      <Card title="Class activity" description="Active students and average active minutes per day.">
        {daily.loading ? (
          <Loading />
        ) : daily.error ? (
          <ErrorState message={daily.error.message} onRetry={daily.reload} />
        ) : !daily.data?.length ? (
          <EmptyState title="No class KPI rows yet" description="Rows appear after the KPI pipeline processes synced activity." />
        ) : (
          <ClassDailyChart daily={daily.data} />
        )}
      </Card>
      <Card
        title="Students"
        description="Sort a column or filter by name and email."
        actions={
          <input
            type="search"
            aria-label="Filter students"
            placeholder="Filter students"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            style={{ minWidth: 200 }}
          />
        }
      >
        {students.loading ? (
          <Loading />
        ) : students.error ? (
          <ErrorState message={students.error.message} onRetry={students.reload} />
        ) : rows.length === 0 ? (
          <EmptyState title={filter ? 'No matching students' : 'No students in this class'} description={filter ? 'Clear the filter to see everyone.' : 'A college admin adds students to the class.'} />
        ) : (
          <TableWrap label="Class students">
            <thead>
              <tr>
                <th>
                  <button type="button" className="btn btn-small" onClick={() => changeSort('name')}>
                    Student {sort === 'name' ? (ascending ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="btn btn-small" onClick={() => changeSort('activeMinutes')}>
                    Active min {sort === 'activeMinutes' ? (ascending ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="btn btn-small" onClick={() => changeSort('solved')}>
                    Solved {sort === 'solved' ? (ascending ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="btn btn-small" onClick={() => changeSort('pasteRatio')}>
                    Paste ratio {sort === 'pasteRatio' ? (ascending ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th>Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((student) => (
                <tr key={student.userId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{student.fullName}</div>
                    <div className="muted small">{student.email}</div>
                  </td>
                  <td className="num">{formatNumber(student.activeMinutes, 1)}</td>
                  <td className="num">
                    {student.solved}/{student.attempted}
                  </td>
                  <td className="num">{formatPercent(student.pasteRatio)}</td>
                  <td>
                    <div className="inline">
                      {student.flags.length ? student.flags.map((flag) => <FlagBadge key={flag} flag={flag} />) : <span className="muted small">None</span>}
                    </div>
                  </td>
                  <td>
                    <Link className="btn btn-small" to={`/teacher/classes/${classId}/students/${student.userId}`}>
                      Drill down
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      {rows.some((student) => student.flags.length) ? (
        <p className="muted small">
          Flags: {Array.from(new Set(rows.flatMap((student) => student.flags))).map(label).join(' · ')}
        </p>
      ) : null}
    </>
  );
}
