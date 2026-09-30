import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/profile';

const DEFAULT_SUPABASE_URL = 'https://pidxlopbxlapfmakmtjt.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_s8NvM6ZPe-N6VdR4tQC7Vg_syJ-Ckb9';

function readConfiguration() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const url = envUrl || (!('__testEnv' in globalThis) ? DEFAULT_SUPABASE_URL : '');
  const key = envKey || (!('__testEnv' in globalThis) ? DEFAULT_SUPABASE_ANON_KEY : '');
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