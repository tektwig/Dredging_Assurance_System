import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { INVALID_CREDENTIALS } from '../auth/authState';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    const success = await signIn(email.trim(), password);
    setPassword('');
    if (!success) setError(INVALID_CREDENTIALS);
    pending.current = false;
    setSubmitting(false);
  }

  return <main className="login-page">
    <section className="login-intro" aria-label="Dredging Assurance">
      <div className="brand-mark" aria-hidden="true">DA</div>
      <p className="eyebrow">Truck Revenue Tracking System</p>
      <h1>Every movement.<br />Accounted for.</h1>
      <p className="intro-copy">A shared foundation for clear records and accountable operations.</p>
      <p className="intro-footer">Dredging Assurance</p>
    </section>
    <section className="login-panel">
      <div className="login-form-container">
        <p className="eyebrow">Staff access</p>
        <h2>Sign in to your account</h2>
        <p className="muted">Use the account provided by your administrator.</p>
        <form onSubmit={event => void submit(event)} aria-busy={submitting}>
          <div className="field"><label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
              required value={email} onChange={event => setEmail(event.target.value)} disabled={submitting} /></div>
          <div className="field"><label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password"
              required value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} /></div>
          {error && <p className="message error-message" role="alert">{error}</p>}
          <button className="button full-width" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
          {submitting && <p className="small muted" role="status">Verifying your login details…</p>}
        </form>
        <p className="login-help">Need access? Contact your administrator.</p>
      </div>
    </section>
  </main>;
}