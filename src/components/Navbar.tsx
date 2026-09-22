import React from 'react';
import { useAppStore } from '../services/store';
import { usePWA } from '../services/usePWA';
import {
  Anchor,
  Wifi,
  WifiOff,
  RefreshCw,
  MapPin,
  ShieldCheck,
  Download,
} from 'lucide-react';

interface NavbarProps {
  onOpenLanding?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenLanding }) => {
  const {
    currentRole,
    sites,
    currentSiteId,
    setCurrentSiteId,
    isOnline,
    setIsOnline,
    draftTrips,
    syncOfflineDrafts,
  } = useAppStore();

  const { isInstallable, installApp } = usePWA();

  const getRoleBadge = () => {
    switch (currentRole) {
      case 'loading_officer':
        return { label: 'Loading Gate Officer', color: '#38BDF8' };
      case 'offloading_officer':
        return { label: 'Offload Depot Officer', color: '#34D399' };
      case 'operations_manager':
        return { label: 'Operations Manager', color: '#F59E0B' };
      case 'finance_officer':
        return { label: 'Finance & Paystack Lead', color: '#A78BFA' };
      case 'audit_reviewer':
        return { label: 'Immutable Audit Reviewer', color: '#F43F5E' };
      default:
        return { label: 'System Administrator', color: '#94A3B8' };
    }
  };

  const roleInfo = getRoleBadge();

  return (
    <header
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(11, 15, 23, 0.85)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        {/* Brand & Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
            }}
          >
            <Anchor size={22} color="#090D16" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em', color: '#fff' }}>
                Adams DredgeOps
              </span>
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '0.15rem 0.4rem',
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: 'var(--accent-gold)',
                  borderRadius: '4px',
                  fontWeight: 700,
                }}
              >
                PROD-READY
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Truck Movement Waybill & Revenue Assurance
            </p>
          </div>
        </div>

        {/* Site Selector & Network controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Site indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <MapPin size={16} color="var(--accent-gold)" />
            <select
              value={currentSiteId}
              onChange={(e) => setCurrentSiteId(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id} style={{ background: '#111827', color: '#fff' }}>
                  {s.site_code} — {s.name} ({s.site_type})
                </option>
              ))}
            </select>
          </div>

          {/* Network Simulator Toggle */}
          <button
            onClick={() => setIsOnline(!isOnline)}
            title={isOnline ? 'Online (Click to simulate offline)' : 'Offline (Click to go online)'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.15)',
              border: `1px solid ${isOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
              color: isOnline ? '#34D399' : '#FB7185',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </button>

          {/* Offline Draft queue sync button */}
          {draftTrips.length > 0 && (
            <button
              onClick={syncOfflineDrafts}
              disabled={!isOnline}
              className="btn btn-primary btn-sm"
              style={{
                fontSize: '0.75rem',
                opacity: isOnline ? 1 : 0.5,
              }}
            >
              <RefreshCw size={12} className={isOnline ? 'spin' : ''} />
              Sync Drafts ({draftTrips.length})
            </button>
          )}

          {/* PWA Install Button */}
          {isInstallable && (
            <button
              onClick={installApp}
              className="btn btn-secondary btn-sm"
              style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: 'var(--accent-gold)',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
              title="Install DredgeOps App for Offline Gate Usage"
              id="btn-pwa-install"
            >
              <Download size={13} />
              Install App
            </button>
          )}

          {/* Role badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${roleInfo.color}40`,
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <ShieldCheck size={14} color={roleInfo.color} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: roleInfo.color }}>
              {roleInfo.label}
            </span>
          </div>

          {/* Public Portal / Landing Page Switcher */}
          {onOpenLanding && (
            <button
              type="button"
              onClick={onOpenLanding}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
              title="View Public Landing Page & Role Sign-In"
            >
              Public Portal
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
