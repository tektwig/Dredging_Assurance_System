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
} from 'lucide-react';
import { TektwigLogo } from '../common/TektwigLogo';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeRole,
    activeSiteId,
    setActiveSiteId,
    sites,
    signOut,
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
      badge: 'FINANCE & PAYSTACK',
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
      {/* Top Header Bar — Airtight, No Cross-Terminal Access */}
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
          {/* Brand Logo & Active Terminal Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TektwigLogo height={42} />
            <div style={{ borderLeft: '1.5px solid var(--border-subtle)', paddingLeft: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>
                DredgeOps
              </h1>
              <span
                style={{
                  backgroundColor: currentRole.bgTint,
                  color: currentRole.color,
                  border: `1px solid ${currentRole.borderColor}`,
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                {currentRole.icon}
                {currentRole.badge}
              </span>
            </div>
          </div>

          {/* Right Header Controls (Airtight: Station + Sign Out Only) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Site Picker (For Site Agent / Operations station context) */}
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

      {/* System Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: '#FFFFFF',
          padding: '1rem 0',
          fontSize: '0.8125rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span>
            Tektwig DredgeOps — Sand Haulage Waybill & Revenue Assurance System • Frontend v1.0.0
          </span>
          <span>
            Active Role: <strong>{activeRole.replace('_', ' ').toUpperCase()}</strong> • Branch: <strong className="mono">faith</strong>
          </span>
        </div>
      </footer>
    </div>
  );
};
