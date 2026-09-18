import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy_anon_key';

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
