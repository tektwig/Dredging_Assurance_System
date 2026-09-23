import React from 'react';
import { AppStateProvider, useAppState } from './context/AppStateContext';
import { AppShell } from './components/layout/AppShell';
import { LandingPage } from './components/landing/LandingPage';
import { SiteAgentTerminal } from './components/field/SiteAgentTerminal';
import { OperationsDashboard } from './components/operations/OperationsDashboard';
import { FinanceView } from './components/finance/FinanceView';
import { AdminAuditView } from './components/admin/AdminAuditView';

import { ShieldAlert } from 'lucide-react';

const MainContent: React.FC = () => {
  const { activeRole, authenticatedRole, signOut } = useAppState();

  // Strict RBAC Guard: Verify that the current active role matches the authenticated role
  const isSiteAgent =
    (authenticatedRole === 'loading_officer' || authenticatedRole === 'offloading_officer') &&
    (activeRole === 'loading_officer' || activeRole === 'offloading_officer');
  const isAuthorized = authenticatedRole && (activeRole === authenticatedRole || isSiteAgent);

  if (!isAuthorized) {
    return (
      <div
        className="card"
        style={{
          maxWidth: '520px',
          margin: '3rem auto',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          border: '1.5px solid #FECACA',
          borderRadius: 'var(--radius-xl)',
          backgroundColor: '#FEF2F2',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: '#FEE2E2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto',
            border: '2px solid #FCA5A5',
          }}
        >
          <ShieldAlert size={28} color="#DC2626" />
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991B1B', marginBottom: '0.5rem' }}>
          Terminal Access Restricted
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#7F1D1D', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          Your current authenticated credentials do not grant access to this terminal. Each session is strictly isolated to its authorized operational domain.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={signOut}
          style={{ width: '100%', justifyContent: 'center', minHeight: '40px' }}
        >
          Sign Out & Return to Portal Login
        </button>
      </div>
    );
  }

  switch (activeRole) {
    case 'loading_officer':
    case 'offloading_officer':
      return <SiteAgentTerminal />;
    case 'operations_manager':
      return <OperationsDashboard />;
    case 'finance_officer':
      return <FinanceView />;
    case 'admin':
      return <AdminAuditView />;
    default:
      return <SiteAgentTerminal />;
  }
};

const RootView: React.FC = () => {
  const { isAuthenticated, signIn } = useAppState();

  if (!isAuthenticated) {
    return <LandingPage onSignIn={signIn} />;
  }

  return (
    <AppShell>
      <MainContent />
    </AppShell>
  );
};

export default function App() {
  return (
    <AppStateProvider>
      <RootView />
    </AppStateProvider>
  );
}
