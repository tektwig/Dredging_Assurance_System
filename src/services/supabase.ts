import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Public browser configuration for this project's hosted Supabase instance.
// Environment variables still override these values for local development.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pidxlopbxlapfmakmtjt.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_s8NvM6ZPe-N6VdR4tQC7Vg_syJ-Ckb9';

let client: SupabaseClient | null = null;
let isConfigured = false;

try {
  if (supabaseUrl && supabaseAnonKey && supabaseAnonKey !== 'dummy_anon_key') {
    client = createClient(supabaseUrl, supabaseAnonKey);
    isConfigured = true;
  }
} catch (err) {
  console.warn('Supabase client failed to initialize, using local simulation mode:', err);
}

export const supabase = client;
export const isSupabaseLive = isConfigured;
