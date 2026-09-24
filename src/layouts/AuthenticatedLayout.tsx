import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { SignOutButton } from '../components/SignOutButton';
import { ROLE_LABELS } from '../routing/roleRoutes';

export function AuthenticatedLayout() {
  const { account } = useAuth();
  if (account.status !== 'active') return null;
  return <div className="app-shell">
    <header className="app-header">
      <div><p className="brand">Dredging Assurance</p><p className="muted small">Truck Revenue Tracking System</p></div>
      <div className="account-summary">
        <div><p className="user-name">{account.profile.display_name.trim() || 'Signed-in user'}</p>
          <p className="muted small">{account.profile.role && ROLE_LABELS[account.profile.role]}</p></div>
        <SignOutButton />
      </div>
    </header>
    <main className="portal-content"><Outlet /></main>
  </div>;
}