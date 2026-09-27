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
      get_operations_trips: { Args: {
        p_page?: number; p_page_size?: number; p_search?: string | null; p_status?: 'open' | 'closed' | 'cancelled' | null;
        p_date_from?: string | null; p_date_to?: string | null; p_truck_filter?: string | null;
        p_driver_filter?: string | null; p_loading_site_filter?: string | null; p_offloading_site_filter?: string | null;
      }; Returns: unknown };
      get_operations_trip_detail: { Args: { p_trip_id: string }; Returns: unknown };
      cancel_trip: { Args: { p_trip_id: string; p_reason: string }; Returns: undefined };
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
      create_loading_trip_v2: { Args: {
        p_request_id: string; p_plate: string; p_driver_id: string; p_expected_assignment_id: string;
        p_capture_method: string; p_captured_at: string; p_ocr_detected_plate?: string | null;
        p_ocr_confidence?: number | null; p_image_path?: string | null;
        p_make_default_driver?: boolean;
      }; Returns: unknown };
      lookup_offloading_open_trip: { Args: { p_plate: string }; Returns: unknown };
      get_offloading_statistics: { Args: Record<string, never>; Returns: unknown };
      close_trip_v2: { Args: {
        p_request_id: string; p_trip_id: string; p_plate: string; p_expected_assignment_id: string;
        p_quantity_tonnes: number; p_capture_method: 'MANUAL' | 'OCR' | 'OCR_CORRECTED';
        p_captured_at: string; p_ocr_detected_plate: string | null;
        p_ocr_confidence: number | null; p_image_path: string | null;
      }; Returns: unknown };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
