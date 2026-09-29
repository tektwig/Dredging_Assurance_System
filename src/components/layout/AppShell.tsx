import React from 'react';
import { useAppState } from '../../context/AppStateContext';
import {
  MapPin,
  LogOut,
  Shield,
} from 'lucide-react';
import { TektwigLogo } from '../common/TektwigLogo';

const ROLE_DISPLAY_NAMES: Record<string, { label: string; badgeBg: string; badgeColor: string; badgeBorder: string }> = {
  loading_officer: {
    label: 'Site Agent • Loading',
    badgeBg: '#EFF6FF',
    badgeColor: '#1D4ED8',
    badgeBorder: '#BFDBFE',
  },
  offloading_officer: {
    label: 'Site Agent • Offloading',
    badgeBg: '#ECFDF5',
    badgeColor: '#047857',
    badgeBorder: '#A7F3D0',
  },
  operations_manager: {
    label: 'Operations Manager',
    badgeBg: '#F5F3FF',
    badgeColor: '#6D28D9',
    badgeBorder: '#DDD6FE',
  },
  finance_officer: {
    label: 'Finance & Billing',
    badgeBg: '#FFFBEB',
    badgeColor: '#B45309',
    badgeBorder: '#FDE68A',
  },
  admin: {
    label: 'System Administrator',
    badgeBg: '#FEF2F2',
    badgeColor: '#B91C1C',
    badgeBorder: '#FECACA',
  },
  audit_reviewer: {
    label: 'Audit Reviewer',
    badgeBg: '#F8FAFC',
    badgeColor: '#475569',
    badgeBorder: '#E2E8F0',
  },
};

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeRole,
    authenticatedRole,
    activeSiteId,
    setActiveSiteId,
    sites,
    signOut,
    isOnline,
    isLiveMode,
    liveSyncError,
    draftTrips,
    syncOfflineDrafts,
  } = useAppState();

  const isLiveHealthy = isOnline && (!isLiveMode || !liveSyncError);
  const connectionLabel = !isOnline
    ? `Offline (${draftTrips.length})`
    : liveSyncError
      ? 'Live Sync Error'
      : isLiveMode
        ? 'Live Sync'
        : 'Online';

  const roleMeta = ROLE_DISPLAY_NAMES[authenticatedRole || activeRole] || {
    label: 'Staff User',
    badgeBg: '#F1F5F9',
    badgeColor: '#334155',
    badgeBorder: '#CBD5E1',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
      {/* Editorial Header Bar (Sixtus UI Aesthetic + Live Status) */}
      <header
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #DCE4E9',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '0.65rem',
            paddingBottom: '0.65rem',
            flexWrap: 'wrap',
            gap: '0.85rem',
          }}
        >
          {/* Brand Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <TektwigLogo height={38} />
            <div style={{ borderLeft: '1.5px solid #DCE4E9', paddingLeft: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h1
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    letterSpacing: '-0.025em',
                    color: '#172B3A',
                    lineHeight: 1.15,
                    margin: 0,
                  }}
                >
                  Dredging Assurance
                </h1>
              </div>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#60717E', fontWeight: 500 }}>
                Truck Revenue Tracking System
              </p>
            </div>
          </div>

          {/* Central & Right Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Site Picker (Clean pill style) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: '#F8FAFC',
                border: '1px solid #DCE4E9',
                borderRadius: '0.5rem',
                padding: '0.15rem 0.5rem',
              }}
            >
              <MapPin size={14} color="#125B59" />
              <select
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#172B3A',
                  cursor: 'pointer',
                  outline: 'none',
                  padding: '0.25rem 0.2rem',
                }}
                value={activeSiteId}
                onChange={(e) => setActiveSiteId(e.target.value)}
                aria-label="Active Site"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name} ({s.site_type === 'loading' ? 'Pit' : 'Depot'})
                  </option>
                ))}
              </select>
            </div>

            {/* Live Sync Status Pill */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.28rem 0.65rem',
                borderRadius: '2rem',
                fontSize: '0.74rem',
                fontWeight: 600,
                backgroundColor: isLiveHealthy ? '#ECFDF5' : '#FEF2F2',
                border: `1px solid ${isLiveHealthy ? '#A7F3D0' : '#FECACA'}`,
                color: isLiveHealthy ? '#065F46' : '#991B1B',
              }}
              title={liveSyncError || (isLiveMode ? 'Live automatic cross-device sync active' : 'Offline local mode')}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: isLiveHealthy ? '#10B981' : '#EF4444',
                  boxShadow: isLiveHealthy ? '0 0 6px rgba(16, 185, 129, 0.7)' : '0 0 6px rgba(239, 68, 68, 0.7)',
                }}
              />
              <span>{connectionLabel}</span>

              {draftTrips.length > 0 && isOnline && (
                <button
                  type="button"
                  onClick={syncOfflineDrafts}
                  style={{
                    marginLeft: '0.25rem',
                    border: 'none',
                    background: '#B45309',
                    color: '#FFFFFF',
                    borderRadius: '1rem',
                    padding: '0.1rem 0.45rem',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Sync ({draftTrips.length})
                </button>
              )}
            </div>

            {/* User Operational Role Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.65rem',
                borderRadius: '0.45rem',
                fontSize: '0.74rem',
                fontWeight: 700,
                backgroundColor: roleMeta.badgeBg,
                color: roleMeta.badgeColor,
                border: `1px solid ${roleMeta.badgeBorder}`,
              }}
            >
              <Shield size={13} />
              <span>{roleMeta.label}</span>
            </div>

            {/* Sign Out Button */}
            <button
              type="button"
              onClick={signOut}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: '#FFFFFF',
                border: '1px solid #DCE4E9',
                borderRadius: '0.45rem',
                padding: '0.32rem 0.65rem',
                fontSize: '0.76rem',
                fontWeight: 600,
                color: '#60717E',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#C7D1D8';
                e.currentTarget.style.color = '#172B3A';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#DCE4E9';
                e.currentTarget.style.color = '#60717E';
              }}
              title="Sign out and return to landing page"
            >
              <LogOut size={13} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport Content */}
      <main className="app-container" style={{ flex: 1, paddingTop: '1.25rem', paddingBottom: '2.5rem' }}>
        {children}
      </main>
    </div>
  );
};
