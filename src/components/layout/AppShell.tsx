import React from 'react';
import { useAppState } from '../../context/AppStateContext';
import {
  MapPin,
  LogOut,
} from 'lucide-react';
import { TektwigLogo } from '../common/TektwigLogo';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
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
          {/* Brand Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TektwigLogo height={42} />
            <div style={{ borderLeft: '1.5px solid var(--border-subtle)', paddingLeft: '0.65rem' }}>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>
                DredgeOps
              </h1>
            </div>
          </div>

          {/* Right Header Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* PWA / Network Status Pill */}
            <div
              title={liveSyncError || (isLiveMode ? 'Trips update automatically across signed-in devices.' : 'Local mode')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 600 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: isLiveHealthy ? '#10B981' : '#EF4444',
                  boxShadow: isLiveHealthy ? '0 0 6px rgba(16, 185, 129, 0.6)' : '0 0 6px rgba(239, 68, 68, 0.6)',
                }}
              />
              <span style={{ color: isLiveHealthy ? '#059669' : '#DC2626' }}>
                {connectionLabel}
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
