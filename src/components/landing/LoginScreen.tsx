import React, { useState } from 'react';
import { UserRole } from '../../types';
import { isSupabaseLive, supabase } from '../../services/supabase';
import { TektwigLogo } from '../common/TektwigLogo';
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Sparkles,
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

  const DEMO_PRESETS: { label: string; role: UserRole; email: string; pass: string; description: string }[] = [
    {
      label: 'Site Agent (Pickup / Gate 1)',
      role: 'loading_officer',
      email: (import.meta.env.VITE_AUTH_SITE_AGENT_EMAIL || 'agent@tektwig.com').trim().toLowerCase(),
      pass: (import.meta.env.VITE_AUTH_SITE_AGENT_PASSWORD || 'dredge2026').trim(),
      description: 'Truck plate scanning, tare weighing & manifest creation',
    },
    {
      label: 'Site Agent (Delivery / Gate 2)',
      role: 'offloading_officer',
      email: (import.meta.env.VITE_AUTH_OFFLOAD_EMAIL || 'offload@tektwig.com').trim().toLowerCase(),
      pass: (import.meta.env.VITE_AUTH_OFFLOAD_PASSWORD || 'weighbridge2026').trim(),
      description: 'Gross weighing, delivery verification & invoice generation',
    },
    {
      label: 'Operations Manager',
      role: 'operations_manager',
      email: (import.meta.env.VITE_AUTH_OPS_EMAIL || 'ops@tektwig.com').trim().toLowerCase(),
      pass: (import.meta.env.VITE_AUTH_OPS_PASSWORD || 'opscontrol2026').trim(),
      description: 'Fleet analytics, live register & operational oversight',
    },
    {
      label: 'Finance & Billing Officer',
      role: 'finance_officer',
      email: (import.meta.env.VITE_AUTH_FINANCE_EMAIL || 'finance@tektwig.com').trim().toLowerCase(),
      pass: (import.meta.env.VITE_AUTH_FINANCE_PASSWORD || 'finance2026').trim(),
      description: 'Tonnage billing, accounts receivable & payment approval',
    },
    {
      label: 'System Administrator',
      role: 'admin',
      email: (import.meta.env.VITE_AUTH_ADMIN_EMAIL || 'admin@tektwig.com').trim().toLowerCase(),
      pass: (import.meta.env.VITE_AUTH_ADMIN_PASSWORD || 'tektwigadmin2026').trim(),
      description: 'RBAC policies, site assignments & immutable audit log',
    },
  ];

  const handleSelectPreset = (preset: typeof DEMO_PRESETS[0]) => {
    setIdentifier(preset.email);
    setPassword(preset.pass);
    setErrorMessage(null);
    onSignIn(preset.role);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanId = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (authMode === 'sign-up') {
      const cleanName = fullName.trim();
      if (!isSupabaseLive || !supabase) {
        setErrorMessage('Account registration requires live Supabase service connection.');
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
          'Account created successfully. An administrator must assign and activate your operational site access before you can sign in.'
        );
        setAuthMode('sign-in');
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : 'The account could not be created.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!cleanId || !cleanPassword) {
      setErrorMessage('Please enter both your corporate email and password.');
      return;
    }

    setIsLoading(true);

    // Fallback offline / local demo check
    const matchedPreset = DEMO_PRESETS.find(
      (p) => p.email.toLowerCase() === cleanId || p.email.split('@')[0] === cleanId
    );

    if (!isSupabaseLive || !supabase) {
      if (matchedPreset && matchedPreset.pass === cleanPassword) {
        setIsLoading(false);
        onSignIn(matchedPreset.role);
        return;
      }
      setIsLoading(false);
      setErrorMessage('Invalid credentials. Please verify your credentials or select a test role.');
      return;
    }

    try {
      const emailToUse = cleanId.includes('@') ? cleanId : matchedPreset ? matchedPreset.email : '';
      if (!emailToUse) {
        setIsLoading(false);
        setErrorMessage('Please enter your full corporate email address.');
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: cleanPassword,
      });

      if (authError || !authData.user) {
        // Fallback to local dev credentials if DB demo user isn't in remote Auth yet
        if (matchedPreset && matchedPreset.pass === cleanPassword) {
          setIsLoading(false);
          onSignIn(matchedPreset.role);
          return;
        }
        setErrorMessage(authError?.message || 'Authentication failed. Please verify your credentials.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role,is_active')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile?.is_active || !profile.role) {
        // Check if matched preset exists for dev
        if (matchedPreset) {
          setIsLoading(false);
          onSignIn(matchedPreset.role);
          return;
        }
        await supabase.auth.signOut();
        setErrorMessage('This account is not active or has no operational role assigned.');
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
        setErrorMessage('This user role is not supported by the application.');
        return;
      }

      onSignIn(liveRole);
    } catch (error: unknown) {
      if (matchedPreset && matchedPreset.pass === cleanPassword) {
        setIsLoading(false);
        onSignIn(matchedPreset.role);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'The live service could not be reached.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      {/* Editorial Left Hero Panel (Sixtus Visual Identity) */}
      <section className="login-intro" aria-label="Dredging Assurance System">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '2.5rem' }}>
            <div className="brand-mark" aria-hidden="true" style={{ margin: 0 }}>
              DA
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.08em', color: '#EFBD62', textTransform: 'uppercase' }}>
                TEKTWIG
              </span>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#9CB5B4' }}>Assurance Infrastructure</p>
            </div>
          </div>

          <p className="eyebrow">Truck Revenue Tracking System</p>
          <h1>
            Every movement.<br />
            Accounted for.
          </h1>
          <p className="intro-copy">
            A unified, tamper-proof operational platform for weighbridge gross/tare validation, automated ANPR verification, and real-time revenue assurance.
          </p>
        </div>

        <div className="intro-footer">
          <p style={{ margin: 0, fontWeight: 600 }}>Dredging Assurance System • Version 1.0.0</p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#7E9B9A' }}>Encrypted & Audited Field Operations</p>
        </div>
      </section>

      {/* Clean Right Panel (Sign In Form & Quick Switcher) */}
      <section className="login-panel">
        <div className="login-form-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: 'none',
                border: 'none',
                color: '#60717E',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <ArrowLeft size={16} /> Back to Overview
            </button>
            <TektwigLogo height={28} />
          </div>

          <p className="eyebrow">{authMode === 'sign-in' ? 'STAFF ACCESS' : 'NEW REGISTRATION'}</p>
          <h2>{authMode === 'sign-in' ? 'Sign in to your account' : 'Request Staff Access'}</h2>
          <p className="muted">
            {authMode === 'sign-in'
              ? 'Enter your corporate credentials provided by your administrator.'
              : 'Register your details to request an assigned terminal role.'}
          </p>

          {errorMessage && (
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.5rem',
                backgroundColor: '#FFF1EF',
                border: '1px solid #EFCECB',
                color: '#8C2424',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginBottom: '1.25rem',
              }}
              role="alert"
            >
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.5rem',
                backgroundColor: '#ECFDF5',
                border: '1px solid #A7F3D0',
                color: '#065F46',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginBottom: '1.25rem',
              }}
              role="status"
            >
              <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{successMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            {authMode === 'sign-up' && (
              <>
                <div className="sixtus-field">
                  <label htmlFor="fullName">Full Name</label>
                  <input
                    id="fullName"
                    type="text"
                    className="sixtus-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ibrahim Danjuma"
                    required
                    disabled={isLoading}
                  />
                </div>

                <div className="sixtus-field">
                  <label htmlFor="requestedRole">Requested Operational Role</label>
                  <select
                    id="requestedRole"
                    className="sixtus-input"
                    value={requestedRole}
                    onChange={(e) => setRequestedRole(e.target.value as any)}
                    disabled={isLoading}
                  >
                    <option value="loading_officer">Site Agent (Loading / Gate 1)</option>
                    <option value="offloading_officer">Site Agent (Offloading / Gate 2)</option>
                    <option value="operations_manager">Operations Manager</option>
                    <option value="finance_officer">Finance & Billing Officer</option>
                  </select>
                </div>
              </>
            )}

            <div className="sixtus-field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="sixtus-input"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@tektwig.com"
                required
                disabled={isLoading}
              />
            </div>

            <div className="sixtus-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="password">Password</label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#60717E',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="sixtus-input"
                autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            {authMode === 'sign-up' && (
              <div className="sixtus-field">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  className="sixtus-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            )}

            <button type="submit" className="sixtus-btn-primary" disabled={isLoading} style={{ marginTop: '0.5rem' }}>
              {isLoading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : authMode === 'sign-in' ? (
                'Sign In'
              ) : (
                'Submit Registration'
              )}
            </button>
          </form>

          {/* Quick Role Switcher Box for Field & Testing */}
          <div className="sixtus-quick-role-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
              <Sparkles size={15} color="#D97706" />
              <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#172B3A' }}>
                Quick Role Switcher (Field & Dev Testing)
              </span>
            </div>
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.76rem', color: '#60717E', lineHeight: 1.4 }}>
              Click any operational profile to auto-fill authorized credentials and launch:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {DEMO_PRESETS.map((preset) => (
                <button
                  key={preset.role}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.45rem 0.65rem',
                    background: '#FFFFFF',
                    border: '1px solid #DCE4E9',
                    borderRadius: '0.4rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#125B59')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#DCE4E9')}
                >
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#172B3A' }}>{preset.label}</div>
                    <div style={{ fontSize: '0.68rem', color: '#60717E' }}>{preset.description}</div>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#125B59', fontWeight: 700 }}>Launch &rarr;</span>
                </button>
              ))}
            </div>
          </div>

          {/* Toggle between Sign In and Registration */}
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            {authMode === 'sign-in' ? (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('sign-up');
                  setErrorMessage(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#125B59',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Need staff credentials? Request new access &rarr;
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('sign-in');
                  setErrorMessage(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#125B59',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Already have an account? Sign in &rarr;
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
