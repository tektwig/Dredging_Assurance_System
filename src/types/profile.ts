// Contract: 20260921000100_mvp_foundation.sql. Profiles are not Auth metadata.
export const APP_ROLES = [
  'system_administrator', 'loading_officer', 'offloading_officer',
  'operations_manager', 'finance_officer', 'audit_reviewer',
] as const;

export type AppRole = typeof APP_ROLES[number];

export type Profile = {
  id: string;
  display_name: string;
  role: AppRole | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.display_name === 'string'
    && typeof row.is_active === 'boolean'
    && typeof row.created_at === 'string' && typeof row.updated_at === 'string'
    && (row.role === null || APP_ROLES.some(role => role === row.role))
    && (!row.is_active || row.role !== null);
}

// Columns used by the browser; database policies and RPCs remain authoritative.
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; display_name?: string; role?: AppRole | null; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      user_site_assignments: {
        Row: { id: string; profile_id: string; site_id: string; ended_at: string | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      sites: {
        Row: { id: string; name: string; site_type: 'loading' | 'offloading'; is_active: boolean };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      lookup_loading_truck: { Args: { p_plate: string }; Returns: unknown };
      get_loading_statistics: { Args: Record<string, never>; Returns: unknown };
      search_loading_drivers: { Args: { p_query: string; p_limit?: number }; Returns: unknown };
      register_loading_participant: { Args: {
        p_request_id: string; p_plate: string; p_expected_truck_id?: string | null;
        p_existing_driver_id?: string | null; p_full_name?: string | null;
        p_phone_number?: string | null; p_email?: string | null;
        p_bank_name?: string | null; p_account_number?: string | null;
        p_account_name?: string | null;
      }; Returns: unknown };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
