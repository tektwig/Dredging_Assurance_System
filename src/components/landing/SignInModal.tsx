import React, { useState, useEffect } from 'react';
import { UserRole } from '../../types';
import { TektwigLogo } from '../common/TektwigLogo';
import {
  X,
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Loader2,
  Truck,
  Scale,
  Activity,
  CreditCard,
} from 'lucide-react';

interface SignInModalProps {
  isOpen: boolean;
  role?: UserRole;
  initialRole?: UserRole;
  onClose: () => void;
  onSignIn: (role: UserRole) => void;
}

interface TierInfo {
  role: UserRole;
  title: string;
  subtitle: string;
  badge: string;
  shortName: string;
  icon: React.ReactNode;
  color: string;
  bgTint: string;
  borderColor: string;
  defaultEmail: string;
  envKeyPassword: string;
}

export const TIER_CONFIG: Record<UserRole, TierInfo> = {
  loading_officer: {
    role: 'loading_officer',
    title: 'Site Agent',
    subtitle: 'Gate 1 Dredge Pit & Gate 2 Weighbridge',
    badge: 'SITE AGENT',
    shortName: 'Site Agent',
    icon: <Truck size={18} />,
    color: '#B45309',
    bgTint: '#FEF3C7',
    borderColor: '#FCD34D',
    defaultEmail: import.meta.env.VITE_AUTH_SITE_AGENT_EMAIL || import.meta.env.VITE_AUTH_LOADING_EMAIL || 'agent@tektwig.com',
    envKeyPassword: 'VITE_AUTH_SITE_AGENT_PASSWORD',
  },
  offloading_officer: {
    role: 'offloading_officer',
    title: 'Site Agent',
    subtitle: 'Gate 1 Dredge Pit & Gate 2 Weighbridge',
    badge: 'SITE AGENT',
    shortName: 'Site Agent',
    icon: <Scale size={18} />,
    color: '#B45309',
    bgTint: '#FEF3C7',
    borderColor: '#FCD34D',
    defaultEmail: import.meta.env.VITE_AUTH_OFFLOAD_EMAIL || 'agent@tektwig.com',
    envKeyPassword: 'VITE_AUTH_OFFLOAD_PASSWORD',
  },
  operations_manager: {
    role: 'operations_manager',
    title: 'Operations Manager',
    subtitle: 'Central Control Room & Discrepancy Triage',
    badge: 'CONTROL ROOM',
    shortName: 'Control Room',
    icon: <Activity size={18} />,
    color: '#0369A1',
    bgTint: '#E0F2FE',
    borderColor: '#BAE6FD',
    defaultEmail: import.meta.env.VITE_AUTH_OPS_EMAIL || 'ops@tektwig.com',
    envKeyPassword: 'VITE_AUTH_OPS_PASSWORD',
  },
  admin: {
    role: 'admin',
    title: 'System Administrator',
    subtitle: 'Governance, Fleet Master & Audit Ledger',
    badge: 'ADMIN & AUDIT',
    shortName: 'Admin & Audit',
    icon: <ShieldCheck size={18} />,
    color: '#475569',
    bgTint: '#F1F5F9',
    borderColor: '#CBD5E1',
    defaultEmail: import.meta.env.VITE_AUTH_ADMIN_EMAIL || 'admin@tektwig.com',
    envKeyPassword: 'VITE_AUTH_ADMIN_PASSWORD',
  },
  finance_officer: {
    role: 'finance_officer',
    title: 'Finance & Paystack Officer',
    subtitle: 'Batch Payout Disbursements & KYC',
    badge: 'FINANCE & PAYSTACK',
    shortName: 'Finance',
    icon: <CreditCard size={18} />,
    color: '#7C3AED',
    bgTint: '#EDE9FE',
    borderColor: '#DDD6FE',
    defaultEmail: import.meta.env.VITE_AUTH_FINANCE_EMAIL || 'finance@tektwig.com',
    envKeyPassword: 'VITE_AUTH_FINANCE_PASSWORD',
  },
};

export const SignInModal: React.FC<SignInModalProps> = ({
  isOpen,
  role,
  initialRole = 'loading_officer',
  onClose,
  onSignIn,
}) => {
  const activeRole: UserRole = role || initialRole;
  const currentTier = TIER_CONFIG[activeRole] || TIER_CONFIG.loading_officer;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Sync state when opened for this specific individual tier
  useEffect(() => {
    if (isOpen) {
      setEmail(currentTier.defaultEmail);
      setPassword('');
      setErrorMessage(null);
      setIsLoading(false);
    }
  }, [isOpen, activeRole]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMessage('Please enter both your corporate email and password.');
      return;
    }

    setIsLoading(true);

    // Read valid credentials specifically for this individual role
    const roleCredentials: Record<UserRole, { email: string; password: string }[]> = {
      loading_officer: [
        {
          email: (import.meta.env.VITE_AUTH_SITE_AGENT_EMAIL || 'agent@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_SITE_AGENT_PASSWORD || 'dredge2026').trim(),
        },
        {
          email: (import.meta.env.VITE_AUTH_LOADING_EMAIL || 'loading@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_LOADING_PASSWORD || 'dredge2026').trim(),
        },
        {
          email: (import.meta.env.VITE_AUTH_OFFLOAD_EMAIL || 'offload@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_OFFLOAD_PASSWORD || 'weighbridge2026').trim(),
        },
      ],
      offloading_officer: [
        {
          email: (import.meta.env.VITE_AUTH_SITE_AGENT_EMAIL || 'agent@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_SITE_AGENT_PASSWORD || 'dredge2026').trim(),
        },
      ],
      operations_manager: [
        {
          email: (import.meta.env.VITE_AUTH_OPS_EMAIL || 'ops@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_OPS_PASSWORD || 'opscontrol2026').trim(),
        },
      ],
      admin: [
        {
          email: (import.meta.env.VITE_AUTH_ADMIN_EMAIL || 'admin@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_ADMIN_PASSWORD || 'tektwigadmin2026').trim(),
        },
      ],
      finance_officer: [
        {
          email: (import.meta.env.VITE_AUTH_FINANCE_EMAIL || 'finance@tektwig.com').trim().toLowerCase(),
          password: (import.meta.env.VITE_AUTH_FINANCE_PASSWORD || 'finance2026').trim(),
        },
      ],
    };

    setTimeout(() => {
      const allowedAccounts = roleCredentials[activeRole] || [];
      const matched = allowedAccounts.find(
        (acc) => acc.email === cleanEmail && acc.password === cleanPassword
      );

      if (matched) {
        setIsLoading(false);
        onSignIn(activeRole);
        onClose();
      } else {
        setIsLoading(false);
        setErrorMessage(
          `Invalid credentials for ${currentTier.title}. Please enter your authorized email and password.`
        );
      }
    }, 350);
  };

  return (
    <div
      className="modal-overlay"
      style={{
        padding: '0.75rem',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        style={{
          maxWidth: '460px',
          width: '100%',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TektwigLogo height={36} />
            <div style={{ borderLeft: '1.5px solid var(--border-subtle)', paddingLeft: '0.65rem' }}>
              <h3 style={{ fontSize: '0.925rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.2 }}>
                {currentTier.title}
              </h3>
              <span style={{ fontSize: '0.68rem', color: currentTier.color, fontWeight: 700 }}>
                Sign In
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.35rem',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* PROMINENT TIER IDENTIFIER BANNER */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: currentTier.bgTint,
            borderBottom: `1.5px solid ${currentTier.borderColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: '#FFFFFF',
                color: currentTier.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1.5px solid ${currentTier.borderColor}`,
                boxShadow: 'var(--shadow-xs)',
                flexShrink: 0,
              }}
            >
              {currentTier.icon}
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.925rem',
                  fontWeight: 800,
                  color: '#0F172A',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {currentTier.title}
              </div>
              {currentTier.subtitle ? (
                <div
                  style={{
                    fontSize: '0.725rem',
                    fontWeight: 600,
                    color: currentTier.color,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {currentTier.subtitle}
                </div>
              ) : null}
            </div>
          </div>

          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: currentTier.color,
              backgroundColor: '#FFFFFF',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-full)',
              border: `1px solid ${currentTier.borderColor}`,
              flexShrink: 0,
            }}
          >
            {currentTier.badge}
          </span>
        </div>

        {/* Modal Form Body */}
        <div style={{ padding: '1.25rem 1.25rem 1.5rem 1.25rem' }}>

          {/* Validation Error Alert */}
          {errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.65rem',
                padding: '0.75rem 0.9rem',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 'var(--radius-md)',
                color: '#991B1B',
                fontSize: '0.8125rem',
                marginBottom: '1.15rem',
                animation: 'fadeIn 0.15s ease',
              }}
            >
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ lineHeight: 1.45 }}>{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Corporate Email Field */}
            <div className="form-group" style={{ margin: 0 }}>
              <label
                htmlFor="signin-email"
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '0.35rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Corporate Email</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="signin-email"
                  type="email"
                  className="form-input"
                  style={{
                    paddingLeft: '2.5rem',
                    minHeight: '44px',
                    fontSize: '0.875rem',
                  }}
                  placeholder="e.g. name@tektwig.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
                <Mail
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="form-group" style={{ margin: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.35rem',
                }}
              >
                <label
                  htmlFor="signin-password"
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  Password
                </label>
                <a
                  href="#forgot"
                  onClick={(e) => {
                    e.preventDefault();
                    setErrorMessage('Please check the password assigned to this tier in your project .env file.');
                  }}
                  style={{
                    fontSize: '0.75rem',
                    color: currentTier.color,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Forgot password?
                </a>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  style={{
                    paddingLeft: '2.5rem',
                    paddingRight: '2.75rem',
                    minHeight: '44px',
                    fontSize: '0.875rem',
                  }}
                  placeholder="Enter password from .env"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    position: 'absolute',
                    right: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '4px',
                  accentColor: currentTier.color,
                  cursor: 'pointer',
                }}
              />
              <label
                htmlFor="remember-me"
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                Keep me signed in on this workstation
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="btn"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '46px',
                fontSize: '0.9375rem',
                fontWeight: 700,
                marginTop: '0.4rem',
                backgroundColor: currentTier.color,
                color: '#FFFFFF',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Security Footnote */}
          <div
            style={{
              marginTop: '1.25rem',
              paddingTop: '0.85rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            <ShieldCheck size={14} color="#059669" />
            <span>Tektwig Encrypted Operational Assurance Protocol</span>
          </div>
        </div>
      </div>
    </div>
  );
};
