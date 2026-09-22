import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { RoleSwitcher } from './components/RoleSwitcher';
import { LoadingCapture } from './components/LoadingCapture';
import { OffloadingVerification } from './components/OffloadingVerification';
import { OperationsDashboard } from './components/OperationsDashboard';
import { ExceptionPortal } from './components/ExceptionPortal';
import { FinancePortal } from './components/FinancePortal';
import { AuditLogViewer } from './components/AuditLogViewer';
import { MasterDataPortal } from './components/MasterDataPortal';
import { LandingPage } from './components/landing/LandingPage';
import { SiteAgentTerminal } from './components/field/SiteAgentTerminal';
import { AdminAuditView } from './components/admin/AdminAuditView';
import { useAppStore } from './services/store';
import { AppStateProvider } from './context/AppStateContext';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('operations_manager');
  const { currentRole } = useAppStore();

  if (activeTab === 'landing') {
    return <LandingPage onSignIn={(role) => setActiveTab(role)} />;
  }

  const renderCurrentView = () => {
    switch (activeTab) {
      case 'loading_officer':
        return <LoadingCapture />;
      case 'offloading_officer':
        return <OffloadingVerification />;
      case 'operations_manager':
        return <OperationsDashboard />;
      case 'exception_manager':
        return <ExceptionPortal />;
      case 'finance_officer':
        return <FinancePortal />;
      case 'audit_reviewer':
        return <AuditLogViewer />;
      case 'master_data':
        return <MasterDataPortal />;
      case 'site_terminal':
        return <SiteAgentTerminal />;
      case 'admin_audit':
        return <AdminAuditView />;
      default:
        return <OperationsDashboard />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <Navbar onOpenLanding={() => setActiveTab('landing')} />

      {/* Role and Screen Switcher Navigation */}
      <RoleSwitcher activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main style={{ flex: 1, paddingBottom: '3rem' }}>
        {renderCurrentView()}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          background: 'rgba(9, 13, 22, 0.95)',
          padding: '1.25rem 1.5rem',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            maxWidth: '1400px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
              Adams Project — Dredging Assurance System
            </span>{' '}
            • Real-time Field Verification & Financial Reconciliation
          </div>

          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Active Role: <strong style={{ color: 'var(--accent-gold)' }}>{currentRole}</strong></span>
            <span>Ledger: <strong style={{ color: '#34D399' }}>Immutable Append-Only</strong></span>
            <span>Paystack: <strong style={{ color: '#38BDF8' }}>Transfers Ready</strong></span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}
