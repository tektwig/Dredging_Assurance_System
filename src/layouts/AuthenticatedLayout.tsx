import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { SignOutButton } from '../components/SignOutButton';
import { PortalNavigation } from '../components/PortalNavigation';
import { ROLE_LABELS, type PortalNavigationItem } from '../routing/roleRoutes';

type Navigation = { basePath: string; label: string; items: readonly PortalNavigationItem[] };
type AccountAction = { label: string; to: string };

export function AuthenticatedLayout({ navigation, accountAction }: { navigation?: Navigation; accountAction?: AccountAction }) {
  const { account } = useAuth();
  if (account.status !== 'active') return null;
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-brand">
        <img className="app-brand-mark" src="/trakflit-mark.png" alt="" aria-hidden="true" />
        <div><p className="brand">TRAKFLIT</p><p className="muted small">Total Fleet Visibility</p></div>
      </div>
      <div className="account-summary">
        <div><p className="user-name">{account.profile.display_name.trim() || 'Signed-in user'}</p>
          <p className="muted small">{account.profile.role && ROLE_LABELS[account.profile.role]}</p></div>
        <div className="account-actions">
          <SignOutButton />
          {accountAction && <Link className="button secondary" to={accountAction.to}>{accountAction.label}</Link>}
        </div>
      </div>
    </header>
    {navigation && <PortalNavigation {...navigation} />}
    <main className="portal-content"><Outlet /></main>
  </div>;
}
