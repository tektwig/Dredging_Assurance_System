import React, { useState } from 'react';
import { UserRole } from '../../types';
import { isSupabaseLive, supabase } from '../../services/supabase';
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
  UserPlus,
  CheckCircle2,
} from 'lucide-react';

interface LoginScreenProps {
  onSignIn: (role: UserRole) => void;
  onBack: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSignIn, onBack }) => {
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState<'loading_officer' | 'offloading_officer' | 'operations_manager' | 'finance_officer'>('loading_officer');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanId = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (authMode === 'sign-up') {
      const cleanName = fullName.trim();
      if (!isSupabaseLive || !supabase) {
        setErrorMessage('Account registration is temporarily unavailable. Please try again when the live service is connected.');
        return;
      }
      if (cleanName.length < 2) {
        setErrorMessage('Please enter your full name.');
        return;
      }
      if (!cleanId || !cleanId.includes('@')) {
        setErrorMessage('Please enter a valid email address.');
        return;
      }
      if (cleanPassword.length < 8) {
        setErrorMessage('Password must contain at least 8 characters.');
        return;
      }
      if (cleanPassword !== confirmPassword) {
        setErrorMessage('The passwords do not match.');
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase.auth.signUp({
          email: cleanId,
          password: cleanPassword,
          options: {
            data: {
              display_name: cleanName,
              requested_role: requestedRole,
            },
          },
        });
        if (error) throw error;
        if (!data.user) throw new Error('The account could not be created.');
        if (data.session) await supabase.auth.signOut();

        setFullName('');
        setIdentifier('');
        setPassword('');
        setConfirmPassword('');
        setSuccessMessage(
          'Account created. Verify your email if prompted, then wait for an administrator to assign and activate your operational access.'
        );
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : 'The account could not be created.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

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
        ],
      },
      {
        role: 'offloading_officer',
        allowed: [
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

    let matchedRole: UserRole | null = null;
    let matchedEmail = cleanId.includes('@') ? cleanId : '';
    let locallyAuthorized = false;
    for (const group of credentialsMap) {
      const found = group.allowed.find((account) => {
        const matchesEmail = account.email === cleanId;
        const matchesUsername = account.email.split('@')[0] === cleanId;
        return matchesEmail || matchesUsername;
      });
      if (found) {
        matchedRole = group.role;
        matchedEmail = found.email;
        locallyAuthorized = found.password === cleanPassword;
        break;
      }
    }

    if (!isSupabaseLive || !supabase) {
      if (!matchedRole || !locallyAuthorized) {
        setIsLoading(false);
        setErrorMessage('Invalid credentials. Please verify your corporate ID and password.');
        return;
      }
      setIsLoading(false);
      onSignIn(matchedRole);
      return;
    }

    if (!matchedEmail) {
      setIsLoading(false);
      setErrorMessage('Enter your full corporate email address.');
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: matchedEmail,
        password: cleanPassword,
      });
      if (authError || !authData.user) {
        setErrorMessage(authError?.message || 'The live account could not be authenticated.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role,is_active')
        .eq('id', authData.user.id)
        .single();
      if (profileError || !profile?.is_active || !profile.role) {
        await supabase.auth.signOut();
        setErrorMessage('This live account is not active or has no operational role assigned.');
        return;
      }

      const roleMap: Record<string, UserRole> = {
        system_administrator: 'admin',
        loading_officer: 'loading_officer',
        offloading_officer: 'offloading_officer',
        operations_manager: 'operations_manager',
        finance_officer: 'finance_officer',
        audit_reviewer: 'audit_reviewer',
      };
      const liveRole = roleMap[profile.role];
      if (!liveRole) {
        await supabase.auth.signOut();
        setErrorMessage('This account role is not supported by the application.');
        return;
      }

      onSignIn(liveRole);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'The live service could not be reached.');
    } finally {
      setIsLoading(false);
    }
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
              {authMode === 'sign-in' ? <ShieldCheck size={26} /> : <UserPlus size={26} />}
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
              {authMode === 'sign-in' ? 'Terminal Sign In' : 'Create Account'}
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {authMode === 'sign-in'
                ? 'Enter your authorized operational credentials to continue'
                : 'Register securely and request the operational access you need'}
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.4rem',
              padding: '0.3rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: '#F1F5F9',
              marginBottom: '1.25rem',
            }}
          >
            {(['sign-in', 'sign-up'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAuthMode(mode);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                style={{
                  minHeight: 40,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: authMode === mode ? '#FFFFFF' : 'transparent',
                  color: authMode === mode ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  fontWeight: 750,
                  cursor: 'pointer',
                  boxShadow: authMode === mode ? 'var(--shadow-xs)' : 'none',
                }}
              >
                {mode === 'sign-in' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
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

          {successMessage && (
            <div
              role="status"
              style={{
                padding: '0.75rem 0.85rem',
                backgroundColor: '#ECFDF5',
                border: '1px solid #A7F3D0',
                borderRadius: 'var(--radius-md)',
                color: '#065F46',
                fontSize: '0.8125rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginBottom: '1.25rem',
                lineHeight: 1.4,
              }}
            >
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {authMode === 'sign-up' && (
              <>
                <div>
                  <label htmlFor="user-full-name" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                    Full Name
                  </label>
                  <input
                    id="user-full-name"
                    type="text"
                    autoComplete="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={{ width: '100%', minHeight: 48, padding: '0.75rem', fontSize: '0.9375rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--border-default)', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label htmlFor="requested-role" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                    Requested Access
                  </label>
                  <select
                    id="requested-role"
                    className="form-select"
                    value={requestedRole}
                    onChange={(e) => setRequestedRole(e.target.value as typeof requestedRole)}
                    style={{ minHeight: 48, width: '100%' }}
                  >
                    <option value="loading_officer">Loading Site Agent</option>
                    <option value="offloading_officer">Delivery / Offloading Agent</option>
                    <option value="operations_manager">Operations Manager</option>
                    <option value="finance_officer">Finance Officer</option>
                  </select>
                  <p style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    An administrator must approve this request before terminal access is enabled.
                  </p>
                </div>
              </>
            )}
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
                {authMode === 'sign-in' ? 'Corporate Email or Username' : 'Email Address'}
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
                  type={authMode === 'sign-up' ? 'email' : 'text'}
                  autoComplete={authMode === 'sign-up' ? 'email' : 'username'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
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
                  autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
                  required
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

            {authMode === 'sign-up' && (
              <div>
                <label htmlFor="user-confirm-password" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                  Confirm Password
                </label>
                <input
                  id="user-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: '100%', minHeight: 48, padding: '0.75rem', fontSize: '0.9375rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--border-default)', boxSizing: 'border-box' }}
                />
              </div>
            )}

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
                  <span>{authMode === 'sign-in' ? 'Verifying Credentials...' : 'Creating Account...'}</span>
                </>
              ) : (
                <span>{authMode === 'sign-in' ? 'Sign In to Terminal' : 'Create Account'}</span>
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
