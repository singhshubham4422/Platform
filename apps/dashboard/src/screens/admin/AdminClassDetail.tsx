import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useDataSource } from '../../data/DataProvider';
import { useAsync } from '../../lib/use-async';
import { errorText } from '../../lib/errors';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  InlineSuccess,
  Loading,
  PageHeader,
  TableWrap,
} from '../../components/ui';

export function AdminClassDetail() {
  const { classId = '' } = useParams<{ classId: string }>();
  const { profile } = useAuth();
  const source = useDataSource();
  const classes = useAsync(() => source.adminClasses(), []);
  const members = useAsync(() => source.classMembers(classId), [classId]);
  const profiles = useAsync(() => source.orgProfiles(), []);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const klass = classes.data?.find((row) => row.id === classId);
  const memberIds = new Set((members.data ?? []).map((member) => member.user_id));
  const available = (profiles.data ?? []).filter(
    (candidate) => !memberIds.has(candidate.id) && (candidate.role === 'STUDENT' || candidate.role === 'TEACHER'),
  );

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await source.addClassMember(classId, newUserId, newRole);
      setNewUserId('');
      setNotice('Member added.');
      members.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    setError(null);
    try {
      await source.removeClassMember(classId, userId);
      setConfirmRemove(null);
      members.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!profile?.organization_id) throw new Error('Your profile has no organization');
      await source.inviteUser({
        email: inviteEmail.trim(),
        fullName: inviteName.trim(),
        role: inviteRole,
        organizationId: profile.organization_id,
        classIds: [classId],
      });
      setNotice('Invitation created. The user signs in with an email one-time code.');
      setInviteEmail('');
      setInviteName('');
      members.reload();
      profiles.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (classes.loading) return <Loading />;
  if (classes.error) return <ErrorState message={classes.error.message} onRetry={classes.reload} />;
  if (classes.data && !klass) return <ErrorState message="Class not found" />;

  return (
    <>
      <PageHeader
        eyebrow="College admin · class"
        title={klass?.name ?? 'Class'}
        description={`${klass?.code ?? ''}${klass?.academic_year ? ` · ${klass.academic_year}` : ''}`}
        actions={
          <Link className="btn btn-small" to="/admin/classes">
            All classes
          </Link>
        }
      />
      <div aria-live="polite" className="stack">
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      </div>
      <Card title="Members" description="Add existing active profiles or invite a new person by email.">
        {members.loading ? (
          <Loading />
        ) : members.error ? (
          <ErrorState message={members.error.message} onRetry={members.reload} />
        ) : !members.data?.length ? (
          <EmptyState title="No members" description="Add a teacher first so they can link courses." />
        ) : (
          <TableWrap label="Class members">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => (
                <tr key={member.user_id}>
                  <td>{member.profile?.full_name ?? 'Unknown profile'}</td>
                  <td>{member.profile?.email ?? '—'}</td>
                  <td>{member.role}</td>
                  <td>
                    <Badge tone={member.profile?.status === 'ACTIVE' ? 'green' : 'red'}>{member.profile?.status ?? 'MISSING'}</Badge>
                  </td>
                  <td>
                    {confirmRemove === member.user_id ? (
                      <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void removeMember(member.user_id)}>
                        Confirm remove
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirmRemove(member.user_id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <div className="grid-2">
        <Card title="Add an existing profile">
          <form className="form-stack" onSubmit={addMember}>
            <Field label="Profile" htmlFor="member-user">
              <select id="member-user" required value={newUserId} onChange={(event) => setNewUserId(event.target.value)}>
                <option value="">Choose a profile…</option>
                {available.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.full_name} ({candidate.email})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Class role" htmlFor="member-role">
              <select id="member-role" value={newRole} onChange={(event) => setNewRole(event.target.value as 'STUDENT' | 'TEACHER')}>
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
              </select>
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !newUserId}>
              Add member
            </button>
          </form>
        </Card>
        <Card title="Invite a user" description="Calls invite-user through the broker. No password is created.">
          <form className="form-stack" onSubmit={invite}>
            <Field label="Full name" htmlFor="invite-name">
              <input id="invite-name" type="text" required value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
            </Field>
            <Field label="Email" htmlFor="invite-email">
              <input id="invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            </Field>
            <Field label="Role" htmlFor="invite-role">
              <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'STUDENT' | 'TEACHER')}>
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
              </select>
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !inviteEmail.trim() || !inviteName.trim()}>
              {busy ? 'Inviting…' : 'Invite user'}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
