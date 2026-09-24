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

// Intentionally limited to the table used by this phase.
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; display_name?: string; role?: AppRole | null; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}