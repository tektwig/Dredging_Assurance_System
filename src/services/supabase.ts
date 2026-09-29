import { supabase as baseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export const isSupabaseLive = !!baseClient;
export const supabase = baseClient as unknown as SupabaseClient<any>;


