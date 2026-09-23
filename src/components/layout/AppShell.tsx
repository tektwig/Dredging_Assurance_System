import React from 'react';
import { useAppState } from '../../context/AppStateContext';
import { UserRole } from '../../types';
import {
  Truck,
  Activity,
  CreditCard,
  ShieldAlert,
  MapPin,
  LogOut,
  Lock,
} from 'lucide-react';
import { TektwigLogo } from '../common/TektwigLogo';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeRole,
    activeSiteId,
    setActiveSiteId,
    sites,
    signOut,
    isOnline,
    draftTrips,
    syncOfflineDrafts,
  } = useAppState();

  const roleMeta: Partial<Record<
    UserRole,
    { label: string; badge: string; color: string; bgTint: string; borderColor: string; icon: React.ReactNode }
  >> = {
    loading_officer: {
      label: 'Site Agent',
      badge: 'SITE AGENT TERMINAL',
      color: '#B45309',
      bgTint: '#FEF3C7',
      borderColor: '#FCD34D',
      icon: <Truck size={14} />,
    },
    offloading_officer: {
      label: 'Site Agent',
      badge: 'SITE AGENT TERMINAL',
      color: '#B45309',
      bgTint: '#FEF3C7',
      borderColor: '#FCD34D',
      icon: <Truck size={14} />,
    },
    operations_manager: {
      label: 'Operations Manager',
      badge: 'OPERATIONS CONTROL ROOM',
      color: '#0369A1',
      bgTint: '#E0F2FE',
      borderColor: '#BAE6FD',
      icon: <Activity size={14} />,
    },
    finance_officer: {
      label: 'Finance Officer',
      badge: 'FINANCE & COMMERCIAL INVOICING',
      color: '#6D28D9',
      bgTint: '#F5F3FF',
      borderColor: '#DDD6FE',
      icon: <CreditCard size={14} />,
    },
    admin: {
      label: 'System Administrator',
      badge: 'SYSTEM AUDIT & GOVERNANCE',
      color: '#475569',
      bgTint: '#F1F5F9',
      borderColor: '#CBD5E1',
      icon: <ShieldAlert size={14} />,
    },
  };

  const currentRole = (roleMeta[activeRole] || roleMeta.loading_officer)!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#FFFFFF' }}>
      {/* Top Header Bar */}
      <header
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '0.45rem',
            paddingBottom: '0.45rem',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          {/* Brand Logo & Role Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TektwigLogo height={42} />
            <div style={{ borderLeft: '1.5px solid var(--border-subtle)', paddingLeft: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>
                DredgeOps
              </h1>

              {/* Authorized Terminal Badge (Locked to Signed-In Session) */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  minHeight: '28px',
                  padding: '0.2rem 0.65rem',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  backgroundColor: currentRole.bgTint,
                  color: currentRole.color,
                  border: `1px solid ${currentRole.borderColor}`,
                  borderRadius: 'var(--radius-sm)',
                  letterSpacing: '-0.01em',
                  userSelect: 'none',
                }}
                title={`Authorized Session: ${currentRole.label} Terminal (Locked). Sign out to switch terminals.`}
              >
                {currentRole.icon}
                <span>{currentRole.label} Terminal</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.1rem 0.4rem',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '4px',
                    border: `1px solid ${currentRole.borderColor}`,
                    color: currentRole.color,
                    marginLeft: '0.25rem',
                  }}
                >
                  <Lock size={10} />
                  <span>Authorized</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* PWA / Network Status Pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 600 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: isOnline ? '#10B981' : '#EF4444',
                  boxShadow: isOnline ? '0 0 6px rgba(16, 185, 129, 0.6)' : '0 0 6px rgba(239, 68, 68, 0.6)',
                }}
              />
              <span style={{ color: isOnline ? '#059669' : '#DC2626' }}>
                {isOnline ? 'Online' : `Offline (${draftTrips.length})`}
              </span>

              {draftTrips.length > 0 && isOnline && (
                <button
                  type="button"
                  onClick={syncOfflineDrafts}
                  className="btn btn-secondary"
                  style={{ minHeight: '24px', padding: '0.1rem 0.4rem', fontSize: '0.68rem', color: '#B45309' }}
                >
                  Sync ({draftTrips.length})
                </button>
              )}
            </div>

            {/* Site Picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <MapPin size={14} color="var(--brand-primary)" />
              <select
                className="form-select"
                style={{
                  minHeight: '34px',
                  padding: '0.2rem 0.65rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  width: 'auto',
                }}
                value={activeSiteId}
                onChange={(e) => setActiveSiteId(e.target.value)}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name} ({s.site_type === 'loading' ? 'Pit' : 'Depot'})
                  </option>
                ))}
              </select>
            </div>

            {/* Exit / Sign Out Button */}
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                minHeight: '34px',
                padding: '0.25rem 0.75rem',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
              onClick={signOut}
              title="Sign out of current terminal and return to landing page"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-container" style={{ flex: 1, paddingTop: '0.85rem', paddingBottom: '2rem' }}>
        {children}
      </main>
    </div>
  );
};
