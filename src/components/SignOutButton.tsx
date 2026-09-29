import { useAuth } from '../auth/AuthProvider';

export function SignOutButton() {
  const { signOut, signingOut, signOutError } = useAuth();
  return <div className="signout">
    <button className="button secondary" type="button" disabled={signingOut} onClick={() => void signOut()}>
      {signingOut ? 'Signing out…' : 'Sign Out'}
    </button>
    {signOutError && <p className="error-text" role="alert">{signOutError}</p>}
  </div>;
}