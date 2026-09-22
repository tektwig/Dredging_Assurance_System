import React from 'react';
import { AppStateProvider, useAppState } from './context/AppStateContext';
import { AppShell } from './components/layout/AppShell';
import { LandingPage } from './components/landing/LandingPage';
import { SiteAgentTerminal } from './components/field/SiteAgentTerminal';
import { OperationsDashboard } from './components/operations/OperationsDashboard';
import { FinanceView } from './components/finance/FinanceView';
import { AdminAuditView } from './components/admin/AdminAuditView';

const MainContent: React.FC = () => {
  const { activeRole } = useAppState();

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
