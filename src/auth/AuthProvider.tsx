import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isProfile, type Profile } from '../types/profile';
import type { AccountState } from './authState';
import { watchFieldSession, type FieldSessionProbe } from './fieldSessionWatcher';

type SessionState =
  | { status: 'restoring' | 'session-error' }
  | { status: 'ready'; session: Session | null };
type ProfileResult = {
  session: Session;
  status: 'active' | 'inactive' | 'missing-profile' | 'profile-error';
  profile?: Profile;
  fieldOperationalDate?: string;
  fieldSessionExpiresInMs?: number;
};
type FieldSessionNotice = 'operational_day_expired' | 'field_access_revoked' | null;
interface AuthContextValue {
  account: AccountState;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  retry: () => void;
  signingOut: boolean;
  signOutError: string | null;
  fieldSessionNotice: FieldSessionNotice;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseFieldSessionProbe(value: unknown): FieldSessionProbe {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unavailable' };
  const row = value as Record<string, unknown>;
  if (row.status === 'valid' && typeof row.operational_date === 'string'
    && Number.isFinite(row.expires_in_ms) && Number(row.expires_in_ms) >= 0) {
    return { status: 'valid', expiresInMs: Number(row.expires_in_ms), operationalDate: row.operational_date };
  }
  if (row.status === 'expired' || row.status === 'inactive' || row.status === 'not_field') {
    return { status: row.status };
  }
  return { status: 'unavailable' };
}

async function readFieldSessionProbe(): Promise<FieldSessionProbe> {
  if (!supabase) return { status: 'unavailable' };
  try {
    const { data, error } = await supabase.rpc('get_field_session_status');
    return error ? { status: 'unavailable' } : parseFieldSessionProbe(data);
  } catch { return { status: 'unavailable' }; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'restoring' });
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [revision, setRevision] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [fieldSessionNotice, setFieldSessionNotice] = useState<FieldSessionNotice>(null);
  const signingOutRef = useRef(false);
  const terminatingFieldAccessRef = useRef(false);

  const terminateFieldAccess = useCallback(async (reason: Exclude<FieldSessionNotice, null>) => {
    if (!supabase || terminatingFieldAccessRef.current) return;
    terminatingFieldAccessRef.current = true;
    signingOutRef.current = true;
    setFieldSessionNotice(reason);
    setSigningOut(true);
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Field access is still blocked in local state. */ }
    finally {
      setProfileResult(null);
      setSessionState({ status: 'ready', session: null });
      signingOutRef.current = false;
      terminatingFieldAccessRef.current = false;
      setSigningOut(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let eventReceived = false;
    setSessionState({ status: 'restoring' });
    setProfileResult(null);
    const timeout = window.setTimeout(() => {
      if (alive && !eventReceived) setSessionState({ status: 'session-error' });
    }, 15_000);
    // Keep this callback synchronous. Profile requests run in a separate effect.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      eventReceived = true;
      window.clearTimeout(timeout);
      setSessionState({ status: 'ready', session });
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || eventReceived) return;
      window.clearTimeout(timeout);
      setSessionState(error ? { status: 'session-error' } : { status: 'ready', session: data.session });
    }).catch(() => {
      if (alive && !eventReceived) {
        window.clearTimeout(timeout);
        setSessionState({ status: 'session-error' });
      }
    });
    return () => {
      alive = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [revision]);

  const session = sessionState.status === 'ready' ? sessionState.session : null;
  useEffect(() => {
    if (!session || !supabase) {
      setProfileResult(null);
      return;
    }
    const client = supabase;
    const controller = new AbortController();
    let alive = true;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    async function loadProfile() {
      try {
        const { data, error } = await client.from('profiles')
          .select('id, display_name, role, is_active, created_at, updated_at')
          .eq('id', session!.user.id).abortSignal(controller.signal).maybeSingle();
        if (!alive) return;
        if (error) setProfileResult({ session: session!, status: 'profile-error' });
        else if (!data) setProfileResult({ session: session!, status: 'missing-profile' });
        else if (!isProfile(data) || data.id !== session!.user.id) {
          setProfileResult({ session: session!, status: 'profile-error' });
        } else if (!data.is_active) setProfileResult({ session: session!, status: 'inactive', profile: data });
        else if (data.role === 'loading_officer' || data.role === 'offloading_officer') {
          const fieldStatus = await readFieldSessionProbe();
          if (!alive) return;
          if (fieldStatus.status === 'valid' && fieldStatus.operationalDate) setProfileResult({
            session: session!, status: 'active', profile: data,
            fieldOperationalDate: fieldStatus.operationalDate,
            fieldSessionExpiresInMs: fieldStatus.expiresInMs,
          });
          else if (fieldStatus.status === 'expired') void terminateFieldAccess('operational_day_expired');
          else if (fieldStatus.status === 'inactive') void terminateFieldAccess('field_access_revoked');
          else if (fieldStatus.status === 'not_field') setRevision(value => value + 1);
          else setProfileResult({ session: session!, status: 'profile-error' });
        } else setProfileResult({ session: session!, status: 'active', profile: data });
      } catch {
        if (alive) setProfileResult({ session: session!, status: 'profile-error' });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void loadProfile();
    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [session, terminateFieldAccess]);

  const activeFieldProfile = sessionState.status === 'ready' && session && profileResult?.session === session
    && profileResult.status === 'active' && profileResult.profile
    && (profileResult.profile.role === 'loading_officer' || profileResult.profile.role === 'offloading_officer')
    ? profileResult.profile : null;
  useEffect(() => {
    if (!activeFieldProfile || !supabase) return;
    return watchFieldSession(readFieldSessionProbe, status => {
      if (status === 'expired') void terminateFieldAccess('operational_day_expired');
      else if (status === 'inactive') void terminateFieldAccess('field_access_revoked');
      else if (status === 'not_field') setRevision(value => value + 1);
    });
  }, [activeFieldProfile?.id, activeFieldProfile?.role, profileResult?.fieldOperationalDate,
    terminateFieldAccess]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return false;
    setSignOutError(null);
    setFieldSessionNotice(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return !error;
    } catch { return false; }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase || signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    setSignOutError(null);
    setFieldSessionNotice(null);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setProfileResult(null);
      setSessionState({ status: 'ready', session: null });
    } catch {
      setSignOutError('Unable to sign out. Please try again.');
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }, []);

  const retry = useCallback(() => {
    setProfileResult(null);
    setSessionState({ status: 'restoring' });
    setRevision(value => value + 1);
  }, []);

  let account: AccountState;
  if (sessionState.status === 'restoring') account = { status: 'restoring' };
  else if (sessionState.status === 'session-error') account = { status: 'session-error' };
  else if (!session) account = { status: 'unauthenticated' };
  // Never render a previous user's profile while a new session loads.
  else if (profileResult?.session !== session) account = { status: 'loading-profile', session };
  else if ((profileResult.status === 'active' || profileResult.status === 'inactive') && profileResult.profile) {
    account = { status: profileResult.status, session, profile: profileResult.profile,
      fieldOperationalDate: profileResult.fieldOperationalDate,
      fieldSessionExpiresInMs: profileResult.fieldSessionExpiresInMs };
  } else if (profileResult.status === 'missing-profile') account = { status: 'missing-profile', session };
  else account = { status: 'profile-error', session };

  return <AuthContext.Provider value={{ account, signIn, signOut, retry, signingOut, signOutError, fieldSessionNotice }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider.');
  return context;
}
