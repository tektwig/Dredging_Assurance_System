import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ROLE_LABELS } from '../../../routing/roleRoutes';
import { CredentialCreationError, createOperationalCredential, credentialErrorMessage,
  loadCredentialSites, type CreatedCredentialUser, type CredentialRole, type CredentialSite } from './credentialService';
import './credentials.css';

type SiteState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; sites: CredentialSite[] };

export function CreateCredentialsPage({ onCreated }: { onCreated?: () => void }) {
  const [sitesState, setSitesState] = useState<SiteState>({ status: 'loading' });
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CredentialRole | ''>('');
  const [siteId, setSiteId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CreatedCredentialUser | null>(null);

  async function loadSites() {
    setSitesState({ status: 'loading' });
    try { setSitesState({ status: 'ready', sites: await loadCredentialSites() }); }
    catch { setSitesState({ status: 'error' }); }
  }
  useEffect(() => { void loadSites(); }, []);

  const expectedSiteType = role === 'loading_officer' ? 'loading' : role === 'offloading_officer' ? 'offloading' : null;
  const selectableSites = useMemo(() => sitesState.status === 'ready'
    ? sitesState.sites.filter(site => site.site_type === expectedSiteType) : [], [sitesState, expectedSiteType]);
  const passwordValid = password.length >= 12 && password.length <= 128;
  const canSubmit = !!fullName.trim() && !!email.trim() && !!role && !!siteId
    && passwordValid && password === confirmPassword && sitesState.status === 'ready' && !submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !role || !selectableSites.some(site => site.id === siteId)) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createOperationalCredential({ fullName: fullName.trim(), email: email.trim(),
        role, password, siteId });
      setCreatedUser(result);
      onCreated?.();
      setPassword('');
      setConfirmPassword('');
    } catch (failure) {
      const code = failure instanceof CredentialCreationError ? failure.code : 'ACCOUNT_CREATION_FAILED';
      setError(credentialErrorMessage(code));
    } finally { setSubmitting(false); }
  }

  function createAnother() {
    setCreatedUser(null);
    setFullName('');
    setEmail('');
    setRole('');
    setSiteId('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  if (createdUser) return <section className="credential-card" aria-labelledby="credential-success-title">
    <p className="eyebrow">Credentials created</p>
    <h1 id="credential-success-title">Operational account ready</h1>
    <dl className="credential-summary">
      <div><dt>Full Name</dt><dd>{createdUser.fullName}</dd></div>
      <div><dt>Email</dt><dd>{createdUser.email}</dd></div>
      <div><dt>Role</dt><dd>{ROLE_LABELS[createdUser.role]}</dd></div>
      <div><dt>Assigned Site</dt><dd>{createdUser.siteName}</dd></div>
    </dl>
    <button className="button" type="button" onClick={createAnother}>Create Another User</button>
  </section>;

  return <section className="credential-card" aria-labelledby="create-credentials-title">
    <p className="eyebrow">Operations · User access</p>
    <h2 id="create-credentials-title">Create User</h2>
    <p>Create an operational account and assign it to an active site.</p>
    {sitesState.status === 'error' && <div className="message error-message" role="alert">
      <p>Active sites could not be loaded.</p><button className="button secondary" type="button" onClick={() => void loadSites()}>Retry</button>
    </div>}
    <form className="credential-form" onSubmit={event => void submit(event)} aria-busy={submitting}>
      <div className="field"><label htmlFor="credential-full-name">Full Name</label>
        <input id="credential-full-name" name="fullName" autoComplete="name" maxLength={200} required
          value={fullName} onChange={event => setFullName(event.target.value)} /></div>
      <div className="field"><label htmlFor="credential-email">Email</label>
        <input id="credential-email" name="email" type="email" autoComplete="email" maxLength={254} required
          value={email} onChange={event => setEmail(event.target.value)} /></div>
      <div className="field"><label htmlFor="credential-role">Role</label>
        <select id="credential-role" name="role" required value={role}
          onChange={event => { setRole(event.target.value as CredentialRole | ''); setSiteId(''); }}>
          <option value="">Select a role</option>
          <option value="loading_officer">{ROLE_LABELS.loading_officer}</option>
          <option value="offloading_officer">{ROLE_LABELS.offloading_officer}</option>
        </select></div>
      {role && <div className="field"><label htmlFor="credential-site">Assigned Site</label>
        <select id="credential-site" name="siteId" required value={siteId} disabled={sitesState.status !== 'ready'}
          onChange={event => setSiteId(event.target.value)}>
          <option value="">{sitesState.status === 'loading' ? 'Loading active sites…' : 'Select an active site'}</option>
          {selectableSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
        {sitesState.status === 'ready' && selectableSites.length === 0 && <p role="status">No active site is available for this role.</p>}
      </div>}
      <div className="field"><label htmlFor="credential-password">Password</label>
        <div className="credential-secret"><input id="credential-password" name="password"
          type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required
          value={password} onChange={event => setPassword(event.target.value)} />
          <button className="button secondary" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div>
        <small>Use 12–128 characters.</small></div>
      <div className="field"><label htmlFor="credential-confirm-password">Confirm Password</label>
        <div className="credential-secret"><input id="credential-confirm-password" name="confirmPassword"
          type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required
          value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
          <button className="button secondary" type="button" aria-label={showConfirmPassword ? 'Hide confirmation' : 'Show confirmation'}
            onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? 'Hide' : 'Show'}</button></div>
        {confirmPassword && password !== confirmPassword && <p role="alert">Passwords do not match.</p>}</div>
      {error && <p className="message error-message" role="alert">{error}</p>}
      <button className="button" type="submit" disabled={!canSubmit}>
        {submitting ? 'Creating account…' : 'Create Credentials'}
      </button>
    </form>
  </section>;
}
