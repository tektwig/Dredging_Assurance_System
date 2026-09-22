// Domain Models for Tektwig Dredging Assurance System
// Based on AdamsProjectTechnicalDocument.docx and AdamsProjectBRD.docx

export type UserRole =
  | 'loading_officer'
  | 'offloading_officer'
  | 'operations_manager'
  | 'finance_officer'
  | 'admin';

export type SiteType = 'loading' | 'offloading';

export interface Site {
  id: string;
  name: string;
  code: string;
  site_type: SiteType;
  status: 'active' | 'inactive';
  location: string;
  timezone: string;
  daily_target_tonnes?: number;
}

export interface Truck {
  id: string;
  registration_number: string;
  normalized_registration: string; // Canonical (no spaces/hyphens, uppercase)
  capacity_tonnes: number;
  truck_type: string; // e.g., '10-Wheeler Tipper', 'Sino 30T', 'Mack 35T'
  owner_name: string;
  owner_phone?: string;
  status: 'active' | 'maintenance' | 'flagged';
  created_at: string;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  license_number: string;
  status: 'active' | 'suspended' | 'inactive';
  assigned_truck_id?: string;
  payment_profile_id?: string;
  bank_name?: string;
  account_number_last4?: string;
  paystack_recipient_code?: string;
}

export type TripStatus =
  | 'draft_capture'
  | 'open'
  | 'closed'
  | 'exception'
  | 'cancelled'
  | 'sync_failed';

export type QuantityUnit = 'tonnes' | 'm3' | 'truckloads';

export interface TripLoadingEvent {
  id: string;
  trip_id: string;
  plate_image_url: string;
  extracted_plate: string;
  confirmed_plate: string;
  confidence_score: number; // 0 to 100
  captured_by_name: string;
  captured_by_id: string;
  captured_at: string;
  estimated_tonnes: number;
  notes?: string;
}

export interface TripOffloadingEvent {
  id: string;
  trip_id: string;
  quantity: number;
  unit: QuantityUnit;
  scale_ticket_number?: string;
  scale_ticket_url?: string;
  weighed_at: string;
  closed_by_name: string;
  closed_by_id: string;
  variance_from_estimate?: number;
  notes?: string;
}

export type ExceptionType =
  | 'unlisted_truck'
  | 'quantity_mismatch'
  | 'plate_discrepancy'
  | 'gate_timeout'
  | 'diversion_suspected'
  | 'damaged_cargo';

export interface TripException {
  id: string;
  trip_id: string;
  trip_number: string;
  exception_type: ExceptionType;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_review' | 'resolved' | 'cancelled';
  flagged_by: string;
  flagged_at: string;
  resolution_notes?: string;
  reason_code?: string;
  resolved_by?: string;
  resolved_at?: string;
  adjusted_quantity?: number;
}

export interface Trip {
  id: string;
  trip_number: string; // e.g. TRP-2026-08192
  truck_id: string;
  truck?: Truck;
  driver_id: string;
  driver?: Driver;
  loading_site_id: string;
  loading_site?: Site;
  offloading_site_id?: string;
  offloading_site?: Site;
  status: TripStatus;
  loaded_at: string;
  closed_at?: string;
  loading_event?: TripLoadingEvent;
  offloading_event?: TripOffloadingEvent;
  exceptions?: TripException[];
  idempotency_key: string;
}

export interface PayoutItem {
  id: string;
  payout_batch_id: string;
  driver_id: string;
  driver_name: string;
  bank_name: string;
  account_last4: string;
  trip_count: number;
  quantity_total_tonnes: number;
  rate_per_tonne_ngn: number;
  amount_ngn: number;
  status: 'pending' | 'processing' | 'success' | 'failed';
  paystack_transfer_code?: string;
}

export interface PayoutBatch {
  id: string;
  batch_reference: string; // e.g. PAY-2026-WK38-01
  period_start: string;
  period_end: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'disbursed';
  total_trips: number;
  total_tonnes: number;
  gross_amount_ngn: number;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  paystack_transfer_reference?: string;
  items: PayoutItem[];
}

export interface ComplianceDocument {
  id: string;
  document_type:
    | 'cac_certificate'
    | 'tin_certificate'
    | 'director_kyc'
    | 'proof_of_address'
    | 'scuml_certificate'
    | 'bank_mandate';
  title: string;
  registration_number?: string;
  file_name: string;
  file_size: string;
  status: 'verified' | 'pending_review' | 'rejected' | 'missing';
  uploaded_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  expiry_date?: string;
}

export interface AuditLogEntry {
  id: string;
  entity_name: string;
  entity_id: string;
  action: 'CREATE' | 'UPDATE' | 'CLOSE' | 'EXCEPTION_RAISE' | 'EXCEPTION_RESOLVE' | 'PAYOUT_APPROVE';
  old_value?: Record<string, any>;
  new_value?: Record<string, any>;
  reason?: string;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole;
  timestamp: string;
}
