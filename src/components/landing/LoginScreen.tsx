import React, { useState } from 'react';
import { UserRole } from '../../types';
import { TektwigLogo } from '../common/TektwigLogo';
import {
  ArrowLeft,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

interface LoginScreenProps {
  onSignIn: (role: UserRole) => void;
  onBack: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSignIn, onBack }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanId = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanId || !cleanPassword) {
      setErrorMessage('Please enter both your corporate ID / email and password.');
      return;
    }

    setIsLoading(true);

    // Dynamic resolution of all authorized credentials without revealing role options to the user
    const credentialsMap: { role: UserRole; allowed: { email: string; password: string }[] }[] = [
      {
        role: 'loading_officer',
        allowed: [
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
      },
      {
        role: 'operations_manager',
        allowed: [
          {
            email: (import.meta.env.VITE_AUTH_OPS_EMAIL || 'ops@tektwig.com').trim().toLowerCase(),
            password: (import.meta.env.VITE_AUTH_OPS_PASSWORD || 'opscontrol2026').trim(),
          },
        ],
      },
      {
        role: 'finance_officer',
        allowed: [
          {
            email: (import.meta.env.VITE_AUTH_FINANCE_EMAIL || 'finance@tektwig.com').trim().toLowerCase(),
            password: (import.meta.env.VITE_AUTH_FINANCE_PASSWORD || 'finance2026').trim(),
          },
        ],
      },
      {
        role: 'admin',
        allowed: [
          {
            email: (import.meta.env.VITE_AUTH_ADMIN_EMAIL || 'admin@tektwig.com').trim().toLowerCase(),
            password: (import.meta.env.VITE_AUTH_ADMIN_PASSWORD || 'tektwigadmin2026').trim(),
          },
        ],
      },
    ];

    setTimeout(() => {
      // Find matching authorized account
      let matchedRole: UserRole | null = null;

      for (const group of credentialsMap) {
        const found = group.allowed.find((acc) => {
          // Check exact email or prefix username (e.g., 'ops' matching 'ops@tektwig.com')
          const matchesEmail = acc.email === cleanId;
          const matchesUsername = acc.email.split('@')[0] === cleanId;
          return (matchesEmail || matchesUsername) && acc.password === cleanPassword;
        });

        if (found) {
          matchedRole = group.role;
          break;
        }
      }

      if (matchedRole) {
        setIsLoading(false);
        onSignIn(matchedRole);
      } else {
        setIsLoading(false);
        setErrorMessage('Invalid credentials. Please verify your corporate ID and password.');
      }
    }, 400);
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        backgroundColor: '#F8FAFC',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Mobile-First Header */}
      <header
        style={{
          padding: '0.75rem 1rem',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '0.4rem 0.2rem',
            minHeight: '44px',
          }}
          aria-label="Back to overview"
        >
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <TektwigLogo height={34} />
        </div>

        <div style={{ width: 44 }} />
      </header>

      {/* Main Login Viewport */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '1.5rem 1rem',
        }}
      >
        <div
          className="card"
          style={{
            width: '100%',
            maxWidth: '420px',
            backgroundColor: '#FFFFFF',
            border: '1.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-md)',
            padding: '1.75rem 1.25rem',
          }}
        >
          {/* Header Title */}
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                backgroundColor: '#EFF6FF',
                color: 'var(--brand-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '0.75rem',
                border: '1px solid #DBEAFE',
              }}
            >
              <ShieldCheck size={26} />
            </div>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: '#0F172A',
                letterSpacing: '-0.02em',
                marginBottom: '0.35rem',
              }}
            >
              Terminal Sign In
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Enter your authorized operational credentials to continue
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div
              style={{
                padding: '0.75rem 0.85rem',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 'var(--radius-md)',
                color: '#991B1B',
                fontSize: '0.8125rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1.25rem',
                lineHeight: 1.35,
              }}
            >
              <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {/* Identity Field */}
            <div>
              <label
                htmlFor="user-login-identifier"
                style={{
                  display: 'block',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '0.4rem',
                }}
              >
                Corporate Email or Username
              </label>
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <Mail size={16} />
                </div>
                <input
                  id="user-login-identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  placeholder="e.g. agent@tektwig.com"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  style={{
                    width: '100%',
                    minHeight: '48px',
                    padding: '0.75rem 0.75rem 0.75rem 2.4rem',
                    fontSize: '0.9375rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1.5px solid var(--border-default)',
                    backgroundColor: '#FFFFFF',
                    color: '#0F172A',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="user-login-password"
                style={{
                  display: 'block',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '0.4rem',
                }}
              >
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <Lock size={16} />
                </div>
                <input
                  id="user-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  style={{
                    width: '100%',
                    minHeight: '48px',
                    padding: '0.75rem 2.6rem 0.75rem 2.4rem',
                    fontSize: '0.9375rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1.5px solid var(--border-default)',
                    backgroundColor: '#FFFFFF',
                    color: '#0F172A',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '40px',
                    minHeight: '40px',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary"
              style={{
                width: '100%',
                minHeight: '50px',
                fontSize: '0.95rem',
                fontWeight: 700,
                borderRadius: 'var(--radius-md)',
                justifyContent: 'center',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginTop: '0.5rem',
                backgroundColor: 'var(--brand-primary)',
                color: '#FFFFFF',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="spin-animation" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <span>Sign In to Terminal</span>
              )}
            </button>
          </form>

          {/* Secure Assurance Tag */}
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              textAlign: 'center',
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
            }}
          >
            <ShieldCheck size={14} color="#059669" />
            <span>Encrypted Session • Automated Terminal Routing</span>
          </div>
        </div>
      </main>
    </div>
  );
};
