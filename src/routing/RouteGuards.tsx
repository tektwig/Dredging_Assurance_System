import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { StatusPage } from '../components/StatusPage';
import { SignOutButton } from '../components/SignOutButton';
import { destinationForRole, type PortalRole } from './roleRoutes';

// UX guards only. Database RLS and RPC authorization remain authoritative.
export function AccountGate() {
  const { account, retry } = useAuth();
  if (account.status === 'restoring' || account.status === 'loading-profile') {
    return <StatusPage title={account.status === 'restoring' ? 'Restoring your session' : 'Checking your account'} busy>
      <p>Please wait a moment.</p>
    </StatusPage>;
  }
  if (account.status === 'session-error') return <StatusPage title="Unable to restore your session">
    <p>Check your connection and try again.</p>
    <div className="actions"><button className="button" onClick={retry}>Try again</button><SignOutButton /></div>
  </StatusPage>;
  return <Outlet />;
}

export function LoginOnly() {
  const { account } = useAuth();
  if (account.status === 'unauthenticated') return <Outlet />;
  return <Navigate to={account.status === 'active' ? destinationForRole(account.profile.role) : '/access-denied'} replace />;
}

export function RequireSession() {
  const { account } = useAuth();
  return account.status === 'unauthenticated' ? <Navigate to="/login" replace /> : <Outlet />;
}

export function RequireRole({ role }: { role: PortalRole }) {
  const { account } = useAuth();
  if (account.status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (account.status !== 'active' || account.profile.role !== role) {
    return <Navigate to="/access-denied" replace />;
  }
  return <Outlet />;
}

export function HomeRedirect() {
  const { account } = useAuth();
  const destination = account.status === 'unauthenticated' ? '/login'
    : account.status === 'active' ? destinationForRole(account.profile.role) : '/access-denied';
  return <Navigate to={destination} replace />;
}