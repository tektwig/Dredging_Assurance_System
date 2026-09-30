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
      get_operations_report: { Args: { p_kind: string; p_filters?: Record<string, string | boolean>;
        p_page?: number; p_page_size?: number }; Returns: unknown };
      export_operations_report: { Args: { p_kind: string; p_filters: Record<string, string | boolean>; p_format: 'csv' | 'xlsx' }; Returns: unknown };
      get_operations_exceptions: { Args: { p_page?: number; p_page_size?: number; p_search?: string | null;
        p_status?: 'open' | 'in_review' | 'resolved' | null; p_type?: string | null;
        p_date_from?: string | null; p_date_to?: string | null; p_trip_id?: string | null;
        p_truck_id?: string | null }; Returns: unknown };
      get_operations_exception_detail: { Args: { p_exception_id: string; p_history_limit?: number }; Returns: unknown };
      start_operations_exception_review: { Args: { p_exception_id: string; p_expected_updated_at: string }; Returns: unknown };
      resolve_operations_exception: { Args: { p_exception_id: string; p_expected_updated_at: string;
        p_resolution_code: string }; Returns: unknown };
      get_operations_waybills: { Args: { p_page?: number; p_page_size?: number; p_search?: string | null;
        p_quick_filter?: string | null; p_date_from?: string | null; p_date_to?: string | null;
        p_pdf_status?: string | null; p_delivery_status?: string | null; p_payout_status?: string | null }; Returns: unknown };
      get_operations_waybill_detail: { Args: { p_invoice_id: string }; Returns: unknown };
      get_operations_waybill_delivery_history: { Args: { p_invoice_id: string; p_page?: number; p_page_size?: number }; Returns: unknown };
      resend_operations_waybill: { Args: { p_invoice_id: string; p_audience: string; p_request_id: string;
        p_reason_code: string; p_duplicate_risk_confirmed: boolean }; Returns: unknown };
      retry_operations_waybill_delivery: { Args: { p_invoice_id: string; p_audience: string; p_reason_code: string }; Returns: unknown };
      complete_operations_payment_details: { Args: { p_payment_id: string; p_expected_updated_at: string;
        p_account_name: string; p_account_number: string; p_bank_name: string }; Returns: unknown };
      mark_operations_payment_paid: { Args: { p_payment_id: string; p_expected_updated_at: string;
        p_payment_reference: string }; Returns: unknown };
      get_operations_trucks: { Args: { p_page?: number; p_page_size?: number; p_search?: string | null;
        p_active?: boolean | null; p_regular_driver_id?: string | null }; Returns: unknown };
      get_operations_drivers: { Args: { p_page?: number; p_page_size?: number; p_search?: string | null;
        p_active?: boolean | null }; Returns: unknown };
      get_operations_truck_detail: { Args: { p_truck_id: string }; Returns: unknown };
      get_operations_driver_detail: { Args: { p_driver_id: string }; Returns: unknown };
      get_operations_asset_trips: { Args: { p_kind: string; p_asset_id: string; p_page?: number;
        p_page_size?: number }; Returns: unknown };
      update_operations_truck_master: { Args: { p_truck_id: string; p_expected_updated_at: string;
        p_truck_type: string | null; p_capacity: string | null; p_owner_name: string | null;
        p_owner_contact: string | null; p_reason: string }; Returns: unknown };
      correct_operations_truck_plate: { Args: { p_truck_id: string; p_expected_updated_at: string;
        p_plate: string; p_reason: string }; Returns: unknown };
      set_operations_truck_regular_driver: { Args: { p_truck_id: string; p_driver_id: string;
        p_expected_updated_at: string; p_reason: string }; Returns: unknown };
      set_operations_truck_active: { Args: { p_truck_id: string; p_active: boolean;
        p_expected_updated_at: string; p_reason: string }; Returns: unknown };
      update_operations_driver_master: { Args: { p_driver_id: string; p_expected_updated_at: string;
        p_name: string; p_phone: string; p_email: string | null; p_license_number: string | null;
        p_reason: string }; Returns: unknown };
      set_operations_driver_active: { Args: { p_driver_id: string; p_active: boolean;
        p_expected_updated_at: string; p_reason: string }; Returns: unknown };
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
        p_capture_method: string; p_captured_at: string; p_estimated_quantity_tonnes: number;
        p_ocr_detected_plate?: string | null;
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
