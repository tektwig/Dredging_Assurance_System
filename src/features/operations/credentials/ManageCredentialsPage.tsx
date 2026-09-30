import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '../../../routing/roleRoutes';
import { CredentialCreationError, credentialErrorMessage, getCredentialUser, listCredentialUsers,
  loadCredentialSites, resetCredentialPassword, setCredentialActive, updateCredentialProfile,
  type CredentialRole, type CredentialRoleFilter, type CredentialSite, type CredentialUserPage,
  type ManagedCredentialUser } from './credentialService';
import { CreateCredentialsPage } from './CreateCredentialsPage';
import './credentials.css';

type Tab = 'users' | 'create';
const manageable = (user: ManagedCredentialUser) => user.role === 'loading_officer' || user.role === 'offloading_officer';

export function ManageCredentialsPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [search, setSearch] = useState('');
  const [querySearch, setQuerySearch] = useState('');
  const [role, setRole] = useState<CredentialRoleFilter | ''>('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CredentialUserPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ManagedCredentialUser | null>(null);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [view, setView] = useState<ManagedCredentialUser | null>(null);
  const [sites, setSites] = useState<CredentialSite[]>([]);
  const [fullName, setFullName] = useState('');
  const [editRole, setEditRole] = useState<CredentialRole>('loading_officer');
  const [siteId, setSiteId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmAction, setConfirmAction] = useState<'deactivate' | 'reactivate' | null>(null);
  const [busy, setBusy] = useState(false);
  const listRevision = useRef(0);

  async function refresh(nextPage = page) {
    const revision = ++listRevision.current;
    setState('loading'); setOperationError(null);
    try {
      const response = await listCredentialUsers({ search: querySearch, role, active: active === '' ? null : active === 'true', page: nextPage, pageSize: 25 });
      if (revision === listRevision.current) { setResult(response); setState('ready'); }
    } catch { if (revision === listRevision.current) setState('error'); }
  }
  useEffect(() => { if (tab === 'users') void refresh(page); }, [querySearch, role, active, page, tab]);

  async function showUser(user: ManagedCredentialUser) {
    setOperationError(null);
    try { setView(await getCredentialUser(user.id)); }
    catch (error) { setOperationError(credentialErrorMessage(error instanceof CredentialCreationError ? error.code : 'READ_FAILED')); }
  }
  async function beginEdit(user: ManagedCredentialUser) {
    if (!manageable(user)) return;
    setBusy(true); setOperationError(null);
    try {
      const [detail, choices] = await Promise.all([getCredentialUser(user.id), loadCredentialSites()]);
      if (detail.role !== 'loading_officer' && detail.role !== 'offloading_officer') throw new Error('TARGET_NOT_MANAGEABLE');
      setSelected(detail); setFullName(detail.full_name); setEditRole(detail.role); setSiteId(detail.site_id ?? ''); setSites(choices);
      setActionMode('edit');
    } catch (error) { setOperationError(credentialErrorMessage(error instanceof CredentialCreationError ? error.code : 'READ_FAILED')); }
    finally { setBusy(false); }
  }
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || busy || !siteId || !fullName.trim()) return;
    setBusy(true); setOperationError(null);
    try { await updateCredentialProfile({ userId: selected.id, fullName: fullName.trim(), role: editRole, siteId });
      setSelected(null); await refresh(); }
    catch (error) { setOperationError(credentialErrorMessage(error instanceof CredentialCreationError ? error.code : 'UPDATE_FAILED')); }
    finally { setBusy(false); }
  }
  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || busy || password.length < 12 || password.length > 128 || password !== confirmPassword) return;
    setBusy(true); setOperationError(null);
    try { await resetCredentialPassword(selected.id, password); setPassword(''); setConfirmPassword(''); setSelected(null); setOperationError('Password reset completed. The new password is not displayed.'); }
    catch (error) { setOperationError(credentialErrorMessage(error instanceof CredentialCreationError ? error.code : 'PASSWORD_RESET_FAILED')); }
    finally { setBusy(false); }
  }
  async function applyStatusChange() {
    if (!selected || !confirmAction || busy) return;
    setBusy(true); setOperationError(null);
    try { await setCredentialActive(selected.id, confirmAction === 'reactivate'); setSelected(null); setConfirmAction(null); await refresh(); }
    catch (error) { setOperationError(credentialErrorMessage(error instanceof CredentialCreationError ? error.code : 'ACCOUNT_STATUS_UPDATE_FAILED')); }
    finally { setBusy(false); }
  }
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 25));

  return <section className="credential-card credential-management" aria-labelledby="manage-credentials-title">
    <p className="eyebrow">Operations · User access</p>
    <h1 id="manage-credentials-title">Manage Credentials</h1>
    <div className="credential-tabs" role="tablist" aria-label="Credential management">
      <button type="button" role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>Users</button>
      <button type="button" role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')}>Create User</button>
    </div>
    {operationError && <p className="message" role="status">{operationError}</p>}
    {tab === 'create' ? <CreateCredentialsPage onCreated={() => void refresh(1)} /> : <>
      <form className="credential-filters" onSubmit={event => { event.preventDefault(); setPage(1); setQuerySearch(search.trim()); }}>
        <div className="field"><label htmlFor="credential-search">Search</label><input id="credential-search" value={search} maxLength={100}
          placeholder="Name or email" onChange={event => setSearch(event.target.value)} /></div>
        <div className="field"><label htmlFor="credential-role-filter">Role</label><select id="credential-role-filter" value={role}
          onChange={event => { setPage(1); setRole(event.target.value as CredentialRoleFilter | ''); }}>
          <option value="">All roles</option>{Object.entries(ROLE_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></div>
        <div className="field"><label htmlFor="credential-status-filter">Status</label><select id="credential-status-filter" value={active}
          onChange={event => { setPage(1); setActive(event.target.value as '' | 'true' | 'false'); }}>
          <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
        </select></div><button className="button secondary" type="submit">Search</button>
      </form>
      {state === 'loading' && <p role="status">Loading users…</p>}
      {state === 'error' && <div className="message error-message" role="alert"><p>Users could not be loaded.</p><button className="button secondary" type="button" onClick={() => void refresh()}>Retry</button></div>}
      {state === 'ready' && result && result.users.length === 0 && <p className="empty-state">No users match these filters.</p>}
      {state === 'ready' && result && result.users.length > 0 && <>
        <div className="credential-table-scroll"><table className="credential-table"><thead><tr><th>Full Name</th><th>Email</th><th>Role</th><th>Assigned Site</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{result.users.map(user => <tr key={user.id}><td>{user.full_name}</td><td>{user.email}</td>
            <td>{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}</td><td>{user.site_name ?? '—'}</td>
            <td>{user.is_active ? 'Active' : 'Inactive'}</td><td className="credential-row-actions">
              <button type="button" onClick={() => void showUser(user)}>View</button>
              {manageable(user) && <><button type="button" disabled={busy} onClick={() => void beginEdit(user)}>Edit</button>
                <button type="button" disabled={busy} onClick={() => { setSelected(user); setActionMode('password'); setPassword(''); setConfirmPassword(''); setOperationError(null); }}>Reset Password</button>
                {user.is_active ? <button type="button" disabled={busy} onClick={() => { setSelected(user); setConfirmAction('deactivate'); }}>Deactivate</button>
                  : <button type="button" disabled={busy} onClick={() => { setSelected(user); setConfirmAction('reactivate'); }}>Reactivate</button>}</>}
            </td></tr>)}</tbody></table></div>
        <div className="credential-pagination"><span>{result.total} users</span><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </>}
    </>}

    {view && <div className="credential-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setView(null); }}>
      <section className="credential-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-view-title">
        <h2 id="credential-view-title">User Details</h2><dl className="credential-summary"><div><dt>Full Name</dt><dd>{view.full_name}</dd></div>
          <div><dt>Email</dt><dd>{view.email}</dd></div><div><dt>Role</dt><dd>{ROLE_LABELS[view.role as keyof typeof ROLE_LABELS] ?? view.role}</dd></div>
          <div><dt>Assigned Site</dt><dd>{view.site_name ?? '—'}</dd></div><div><dt>Status</dt><dd>{view.is_active ? 'Active' : 'Inactive'}</dd></div>
          {view.created_at && <div><dt>Created</dt><dd>{new Date(view.created_at).toLocaleString()}</dd></div>}</dl>
        <button type="button" className="button secondary" onClick={() => setView(null)}>Close</button>
      </section></div>}
    {selected && !confirmAction && <div className="credential-overlay"><section className="credential-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-action-title">
      <h2 id="credential-action-title">{actionMode === 'password' ? 'Reset Password' : 'Edit User'}</h2>
      {actionMode === 'password' ? <form className="credential-form" onSubmit={event => void savePassword(event)}>
        <p>Password cannot be retrieved. Set a new password below.</p><label htmlFor="managed-new-password">New Password</label>
        <input id="managed-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required />
        <label htmlFor="managed-confirm-password">Confirm Password</label><input id="managed-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required />
        {confirmPassword && password !== confirmPassword && <p role="alert">Passwords do not match.</p>}
        <button className="button" disabled={busy || password.length < 12 || password.length > 128 || password !== confirmPassword}>Set Password</button></form>
        : <form className="credential-form" onSubmit={event => void saveProfile(event)}><label htmlFor="managed-full-name">Full Name</label>
          <input id="managed-full-name" value={fullName} maxLength={200} onChange={event => setFullName(event.target.value)} required />
          <label htmlFor="managed-email">Email</label><input id="managed-email" value={selected.email} readOnly aria-readonly="true" />
          <label htmlFor="managed-role">Role</label><select id="managed-role" value={editRole} onChange={event => { setEditRole(event.target.value as CredentialRole); setSiteId(''); }}>
            <option value="loading_officer">Loading Officer</option><option value="offloading_officer">Offloading Officer</option></select>
          <label htmlFor="managed-site">Assigned Site</label><select id="managed-site" value={siteId} onChange={event => setSiteId(event.target.value)} required>
            <option value="">Select active site</option>{sites.filter(site => site.site_type === (editRole === 'loading_officer' ? 'loading' : 'offloading')).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
          <button className="button" disabled={busy || !siteId || !fullName.trim()}>Save Changes</button></form>}
      <button type="button" className="button secondary" onClick={() => { setSelected(null); setPassword(''); setConfirmPassword(''); }}>Close</button>
    </section></div>}
    {selected && confirmAction && <div className="credential-overlay"><section className="credential-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-confirm-title">
      <h2 id="credential-confirm-title">{confirmAction === 'deactivate' ? 'Deactivate account?' : 'Reactivate account?'}</h2>
      <p>{confirmAction === 'deactivate' ? 'This user will lose application access. Historical records remain unchanged.' : 'This user will regain application access.'}</p>
      <button type="button" className="button" disabled={busy} onClick={() => void applyStatusChange()}>{confirmAction === 'deactivate' ? 'Confirm Deactivation' : 'Confirm Reactivation'}</button>
      <button type="button" className="button secondary" onClick={() => { setConfirmAction(null); setSelected(null); }}>Cancel</button>
    </section></div>}
  </section>;
}
