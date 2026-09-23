import React, { useState, useRef, useEffect } from 'react';
import { UserRole } from '../../types';
import { TektwigLogo } from '../common/TektwigLogo';
import { SignInModal } from './SignInModal';
import {
  Truck,
  Activity,
  CreditCard,
  ShieldCheck,
  ArrowRight,
  LogIn,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface LandingPageProps {
  onSignIn: (role: UserRole) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn }) => {
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('loading_officer');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleOpenModal = (role: UserRole = 'loading_officer') => {
    setSelectedRole(role);
    setIsSignInModalOpen(true);
    setIsDropdownOpen(false);
  };

  const portalOptions: {
    role: UserRole;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    bgTint: string;
    borderColor: string;
  }[] = [
    {
      role: 'loading_officer',
      title: 'Site Agent',
      subtitle: 'Gate 1 Dredge Pit & Gate 2 Weighbridge',
      description: 'Camera plate scanning, dispatch waybills & weighbridge verification.',
      icon: <Truck size={22} />,
      color: '#B45309',
      bgTint: '#FEF3C7',
      borderColor: '#FCD34D',
    },
    {
      role: 'operations_manager',
      title: 'Operations Manager',
      subtitle: 'Central Control Room',
      description: 'Real-time movement monitoring, tonnage totals & exception triage.',
      icon: <Activity size={22} />,
      color: '#0369A1',
      bgTint: '#E0F2FE',
      borderColor: '#BAE6FD',
    },
    {
      role: 'finance_officer',
      title: 'Finance & Commercial Invoicing',
      subtitle: 'Commercial Invoicing & Paystack Payouts',
      description: 'Client invoicing, VAT reconciliation, driver bank disbursements & KYC verification.',
      icon: <CreditCard size={22} />,
      color: '#6D28D9',
      bgTint: '#F5F3FF',
      borderColor: '#DDD6FE',
    },
    {
      role: 'admin',
      title: 'System Administrator',
      subtitle: 'System Governance',
      description: 'Fleet master, drivers, dredging sites & immutable audit logs.',
      icon: <ShieldCheck size={22} />,
      color: '#475569',
      bgTint: '#F1F5F9',
      borderColor: '#CBD5E1',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', width: '100%', overflowX: 'hidden' }}>
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: '#FFFFFF',
          padding: '0.45rem 0',
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
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <TektwigLogo height={44} />
          </div>

          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 1.15rem',
                fontSize: '0.875rem',
                fontWeight: 700,
                borderRadius: 'var(--radius-md)',
                minHeight: '38px',
                backgroundColor: 'var(--brand-primary)',
                color: '#FFFFFF',
              }}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
            >
              <LogIn size={15} />
              <span>Sign In</span>
              {isDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Dropdown Menu Showing the Three Options */}
            {isDropdownOpen && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: 'min(310px, 90vw)',
                  backgroundColor: '#FFFFFF',
                  border: '1.5px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)',
                  padding: '0.5rem',
                  zIndex: 1000,
                  animation: 'fadeIn 0.15s ease',
                }}
              >
                <div
                  style={{
                    padding: '0.4rem 0.65rem 0.5rem 0.65rem',
                    borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: '0.35rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Select Role to Sign In
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {portalOptions.map((opt) => (
                    <button
                      key={opt.role}
                      type="button"
                      onClick={() => handleOpenModal(opt.role)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.65rem',
                        padding: '0.55rem 0.65rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid transparent',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        transition: 'all 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = opt.bgTint;
                        e.currentTarget.style.borderColor = opt.borderColor;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.borderColor = 'transparent';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: opt.bgTint,
                            color: opt.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `1px solid ${opt.borderColor}`,
                            flexShrink: 0,
                          }}
                        >
                          {opt.icon}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.85rem',
                              fontWeight: 800,
                              color: '#0F172A',
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {opt.title}
                          </div>
                          {opt.subtitle ? (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: opt.color,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {opt.subtitle}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <ArrowRight size={14} color={opt.color} style={{ flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area — Simple, Plain, Straight to the Point */}
      <main style={{ flex: 1, padding: '1.25rem 0 2rem 0' }}>
        <div className="app-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Basic Site Description */}
          <div style={{ textAlign: 'center', maxWidth: '820px', margin: '0 auto', width: '100%' }}>
            <h1
              style={{
                fontSize: 'clamp(1.6rem, 4vw, 2.3rem)',
                fontWeight: 800,
                lineHeight: 1.2,
                color: '#0F172A',
                letterSpacing: '-0.025em',
                marginBottom: '0.75rem',
              }}
            >
              Operational Assurance for Sand Dredging & Truck Haulage
            </h1>

            <p
              style={{
                fontSize: 'clamp(0.875rem, 2vw, 1.05rem)',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <strong>Tektwig DredgeOps</strong> secures the entire sand haulage lifecycle. We eliminate revenue leakage,
              unverified round-trips, and cargo deficits by providing an immutable, event-driven ledger that tracks every truck
              from pit pickup to weighbridge offload.
            </p>
          </div>

          {/* 3 Simple Operational Cards */}
          <div style={{ maxWidth: '1080px', margin: '0 auto', width: '100%' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1rem',
              }}
            >
              {portalOptions.map((opt) => (
                <div
                  key={opt.role}
                  className="card"
                  style={{
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    border: '1.5px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    transition: 'all 0.15s ease',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleOpenModal(opt.role)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = opt.color;
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div>
                    {/* Icon */}
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: opt.bgTint,
                        color: opt.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `1px solid ${opt.borderColor}`,
                        marginBottom: '0.85rem',
                      }}
                    >
                      {opt.icon}
                    </div>

                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.2rem' }}>
                      {opt.title}
                    </h3>
                    {opt.subtitle ? (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: opt.color,
                          marginBottom: '0.5rem',
                        }}
                      >
                        {opt.subtitle}
                      </div>
                    ) : null}
                    <p
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                        marginBottom: '1.25rem',
                      }}
                    >
                      {opt.description}
                    </p>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: '100%',
                        backgroundColor: opt.bgTint,
                        color: opt.color,
                        border: `1px solid ${opt.borderColor}`,
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        minHeight: '42px',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenModal(opt.role);
                      }}
                    >
                      <span>Sign In</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Clean Minimal Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: '#FFFFFF',
          padding: '0.85rem 0',
          fontSize: '0.78rem',
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
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Tektwig DredgeOps</span>
          <span>Operational Assurance & Revenue Protection</span>
        </div>
      </footer>

      {/* Sign In Modal */}
      <SignInModal
        isOpen={isSignInModalOpen}
        role={selectedRole}
        initialRole={selectedRole}
        onClose={() => setIsSignInModalOpen(false)}
        onSignIn={onSignIn}
      />
    </div>
  );
};
