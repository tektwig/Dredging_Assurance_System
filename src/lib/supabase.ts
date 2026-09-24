import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/profile';

function readConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Configure the backup frontend environment and restart Vite.');
  }
  const parsedUrl = new URL(url);
  if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('VITE_SUPABASE_URL must be a valid Supabase HTTP(S) URL.');
  }
  // Configuration validation only, not JWT authentication. Never accept a privileged key.
  if (!key.startsWith('sb_publishable_')) {
    let role: unknown;
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      role = JSON.parse(atob(payload)).role;
    } catch {
      throw new Error('VITE_SUPABASE_ANON_KEY must be a public anon or publishable key.');
    }
    if (role !== 'anon') throw new Error('Only a public anon or publishable key is allowed in this frontend.');
  }
  return { url, key };
}

function configureClient() {
  try {
    const { url, key } = readConfiguration();
    return {
      client: createClient<Database>(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          // Separate backup frontend sessions from the team's existing application.
          storageKey: 'dredging-frontend-backup-auth',
        },
      }),
      error: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Invalid Supabase configuration.';
    return {
      client: null,
      error: import.meta.env.DEV ? detail : 'This application is not configured. Please contact your administrator.',
    };
  }
}

export const { client: supabase, error: configurationError } = configureClient();