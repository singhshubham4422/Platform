import { useState, type FormEvent } from 'react';
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
import { formatDate } from '../../lib/format';

export function OwnerOrganizations() {
  const source = useDataSource();
  const organizations = useAsync(() => source.ownerOrganizations(), []);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [inviteOrg, setInviteOrg] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await source.createOrganization({ name: name.trim(), slug: slug.trim() });
      setNotice('Organization created.');
      setName('');
      setSlug('');
      organizations.reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const inviteAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await source.inviteUser({
        email: inviteEmail.trim(),
        fullName: inviteName.trim(),
        role: 'COLLEGE_ADMIN',
        organizationId: inviteOrg,
      });
      setNotice('College admin invited. They sign in with an email one-time code.');
      setInviteEmail('');
      setInviteName('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Platform owner" title="Organizations" description="Every college on the platform, and invitations for their first admin." />
      <div aria-live="polite" className="stack">
        {error ? <InlineError>{error}</InlineError> : null}
        {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      </div>
      <Card title="Organizations">
        {organizations.loading ? (
          <Loading />
        ) : organizations.error ? (
          <ErrorState message={organizations.error.message} onRetry={organizations.reload} />
        ) : !organizations.data?.length ? (
          <EmptyState title="No organizations" description="Create the first organization." />
        ) : (
          <TableWrap label="Organizations">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {organizations.data.map((organization) => (
                <tr key={organization.id}>
                  <td>{organization.name}</td>
                  <td>{organization.slug}</td>
                  <td>
                    <Badge tone={organization.status === 'ACTIVE' ? 'green' : 'red'}>{organization.status}</Badge>
                  </td>
                  <td>{formatDate(organization.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <div className="grid-2">
        <Card title="Create organization">
          <form className="form-stack" onSubmit={createOrganization}>
            <Field label="Name" htmlFor="org-name">
              <input id="org-name" type="text" required value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Slug" htmlFor="org-slug" hint="Lowercase letters, numbers and hyphens, 3–64 characters.">
              <input id="org-slug" type="text" required pattern="[a-z0-9-]{3,64}" value={slug} onChange={(event) => setSlug(event.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !slug.trim()}>
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </form>
        </Card>
        <Card title="Invite a college admin">
          <form className="form-stack" onSubmit={inviteAdmin}>
            <Field label="Organization" htmlFor="invite-org">
              <select id="invite-org" required value={inviteOrg} onChange={(event) => setInviteOrg(event.target.value)}>
                <option value="">Choose an organization…</option>
                {(organizations.data ?? []).map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Full name" htmlFor="invite-admin-name">
              <input id="invite-admin-name" type="text" required value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
            </Field>
            <Field label="Email" htmlFor="invite-admin-email">
              <input id="invite-admin-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !inviteOrg || !inviteName.trim() || !inviteEmail.trim()}>
              {busy ? 'Inviting…' : 'Invite college admin'}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
