import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { Card, EmptyState, ErrorState, Field, InlineError, InlineSuccess, Loading, PageHeader, TableWrap } from '../../components/ui';

export function AdminClasses() {
  const { profile } = useAuth();
  const source = useDataSource();
  const classes = useAsync(() => source.adminClasses(), []);
  const departments = useAsync(() => source.adminDepartments(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [semester, setSemester] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reset = () => {
    setEditing(null);
    setName('');
    setCode('');
    setDepartmentId('');
    setAcademicYear('');
    setSemester('');
  };

  const startEdit = (id: string) => {
    const klass = classes.data?.find((row) => row.id === id);
    if (!klass) return;
    setEditing(id);
    setName(klass.name);
    setCode(klass.code);
    setDepartmentId(klass.department_id ?? '');
    setAcademicYear(klass.academic_year ?? '');
    setSemester(klass.semester === null ? '' : String(klass.semester));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!profile?.organization_id) throw new Error('Your profile has no organization');
      await source.saveClass({
        id: editing ?? undefined,
        organizationId: profile.organization_id,
        departmentId: departmentId || null,
        name: name.trim(),
        code: code.trim(),
        academicYear: academicYear.trim() || null,
        semester: semester === '' ? null : Number(semester),
      });
      setNotice(editing ? 'Class updated.' : 'Class created.');
      reset();
      classes.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await source.deleteClass(id);
      setConfirmDelete(null);
      classes.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="College admin" title="Classes" description="Classes link students, teachers, courses and assessments." />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Classes">
          {classes.loading ? (
            <Loading />
          ) : classes.error ? (
            <ErrorState message={classes.error.message} onRetry={classes.reload} />
          ) : !classes.data?.length ? (
            <EmptyState title="No classes" description="Create a class, then add members." />
          ) : (
            <TableWrap label="Classes">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Department</th>
                  <th>Year</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {classes.data.map((klass) => (
                  <tr key={klass.id}>
                    <td>{klass.name}</td>
                    <td>{klass.code}</td>
                    <td>{departments.data?.find((d) => d.id === klass.department_id)?.name ?? '—'}</td>
                    <td>{klass.academic_year ?? '—'}</td>
                    <td>
                      <div className="btn-row">
                        <Link className="btn btn-small" to={`/admin/classes/${klass.id}`}>
                          Members
                        </Link>
                        <button type="button" className="btn btn-small" onClick={() => startEdit(klass.id)}>
                          Edit
                        </button>
                        {confirmDelete === klass.id ? (
                          <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void remove(klass.id)}>
                            Confirm delete
                          </button>
                        ) : (
                          <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirmDelete(klass.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title={editing ? 'Edit class' : 'Create class'}>
          <form className="form-stack" onSubmit={onSubmit}>
            {error ? <InlineError>{error}</InlineError> : null}
            {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
            <Field label="Name" htmlFor="class-name">
              <input id="class-name" type="text" required value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Code" htmlFor="class-code">
              <input id="class-code" type="text" required value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Field label="Department" htmlFor="class-department">
              <select id="class-department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                <option value="">No department</option>
                {(departments.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Academic year" htmlFor="class-year">
              <input id="class-year" type="text" placeholder="2026-2027" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} />
            </Field>
            <Field label="Semester" htmlFor="class-semester">
              <input id="class-semester" type="number" min={1} max={12} value={semester} onChange={(event) => setSemester(event.target.value)} />
            </Field>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !code.trim()}>
                {busy ? 'Saving…' : editing ? 'Save class' : 'Create class'}
              </button>
              {editing ? (
                <button type="button" className="btn" onClick={reset}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
