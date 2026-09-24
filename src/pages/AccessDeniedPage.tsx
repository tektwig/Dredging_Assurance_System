import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { DISABLED_ACCOUNT } from '../auth/authState';
import { StatusPage } from '../components/StatusPage';
import { SignOutButton } from '../components/SignOutButton';
import { destinationForRole, ROLE_LABELS } from '../routing/roleRoutes';

export function AccessDeniedPage() {
  const { account, retry } = useAuth();
  let title = 'Access denied';
  let message = 'This account does not have access to this portal.';
  let destination: string | null = null;
  let canRetry = false;
  if (account.status === 'inactive') {
    title = 'Account Disabled';
    message = DISABLED_ACCOUNT;
    canRetry = true;
  } else if (account.status === 'missing-profile') {
    title = 'Account profile missing';
    message = 'Your account profile is not available. Please contact your administrator.';
    canRetry = true;
  } else if (account.status === 'profile-error') {
    title = 'Unable to verify your account';
    message = 'We could not load your account details. Please try again. If the problem continues, contact your administrator.';
    canRetry = true;
  } else if (account.status === 'active') {
    const permitted = destinationForRole(account.profile.role);
    if (permitted === '/access-denied') {
      title = 'Portal not available for your role';
      const role = account.profile.role ? ROLE_LABELS[account.profile.role] : 'Unassigned';
      message = `Your role is ${role}. A dedicated portal is not available yet. Please contact your administrator if you need assistance.`;
    } else {
      destination = permitted;
      message = 'This portal is assigned to a different role. You can return to your permitted portal.';
    }
  }
  return <StatusPage title={title}>
    <p role="alert">{message}</p>
    <div className="actions">
      {destination && <Link className="button" to={destination}>Go to my portal</Link>}
      {canRetry && <button className="button" type="button" onClick={retry}>Check account again</button>}
      <SignOutButton />
    </div>
  </StatusPage>;
}