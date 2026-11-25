import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import { Card, EmptyState, ErrorState, Field, InlineError, InlineSuccess, Loading, PageHeader, TableWrap } from '../../components/ui';

export function AdminDepartments() {
  const { profile } = useAuth();
  const source = useDataSource();
  const departments = useAsync(() => source.adminDepartments(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reset = () => {
    setEditing(null);
    setName('');
    setCode('');
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!profile?.organization_id) throw new Error('Your profile has no organization');
      await source.saveDepartment({ id: editing ?? undefined, organizationId: profile.organization_id, name: name.trim(), code: code.trim() });
      setNotice(editing ? 'Department updated.' : 'Department created.');
      reset();
      departments.reload();
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
      await source.deleteDepartment(id);
      setConfirmDelete(null);
      departments.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="College admin" title="Departments" description="Departments group classes and can be assigned to profiles." />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Departments">
          {departments.loading ? (
            <Loading />
          ) : departments.error ? (
            <ErrorState message={departments.error.message} onRetry={departments.reload} />
          ) : !departments.data?.length ? (
            <EmptyState title="No departments" description="Create the first department." />
          ) : (
            <TableWrap label="Departments">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {departments.data.map((department) => (
                  <tr key={department.id}>
                    <td>{department.name}</td>
                    <td>{department.code}</td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => {
                            setEditing(department.id);
                            setName(department.name);
                            setCode(department.code);
                          }}
                        >
                          Edit
                        </button>
                        {confirmDelete === department.id ? (
                          <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void remove(department.id)}>
                            Confirm delete
                          </button>
                        ) : (
                          <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirmDelete(department.id)}>
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
        <Card title={editing ? 'Edit department' : 'Create department'}>
          <form className="form-stack" onSubmit={onSubmit}>
            {error ? <InlineError>{error}</InlineError> : null}
            {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
            <Field label="Name" htmlFor="department-name">
              <input id="department-name" type="text" required value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Code" htmlFor="department-code">
              <input id="department-code" type="text" required value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !code.trim()}>
                {busy ? 'Saving…' : editing ? 'Save department' : 'Create department'}
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
