export type UserRole =
  | 'loading_officer'
  | 'offloading_officer'
  | 'operations_manager'
  | 'finance_officer'
  | 'system_admin'
  | 'audit_reviewer';

export type TripStatus =
  | 'draft_capture'
  | 'open'
  | 'closed'
  | 'exception'
  | 'cancelled'
  | 'sync_failed';

export interface Site {
  id: string;
  name: string;
  site_code: string;
  site_type: 'loading' | 'offloading' | 'hybrid';
  location_description: string;
  status: 'active' | 'inactive';
  timezone: string;
}

export interface Truck {
  id: string;
  registration_number: string;
  normalized_registration: string;
  capacity: number;
  capacity_unit: 'm3' | 'tonnes' | 'truckloads';
  truck_type: string;
  owner_name: string;
  status: 'active' | 'suspended';
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  license_number: string;
  status: 'active' | 'suspended';
  payment_profile_id?: string;
}

export interface TripLoadingEvent {
  id: string;
  trip_id: string;
  plate_image_file_id?: string;
  plate_image_url?: string;
  extracted_number: string;
  confirmed_number: string;
  confidence_score: number;
  captured_by: string;
  operator_notes?: string;
  captured_at: string;
}

export interface TripOffloadingEvent {
  id: string;
  trip_id: string;
  quantity: number;
  unit: 'm3' | 'tonnes' | 'truckloads';
  weighed_at: string;
  evidence_file_id?: string;
  ticket_image_url?: string;
  closed_by: string;
  variance_percentage?: number;
  operator_notes?: string;
}

export interface Trip {
  id: string;
  trip_number: string;
  truck_id: string;
  driver_id: string;
  loading_site_id: string;
  offloading_site_id?: string;
  status: TripStatus;
  loaded_at: string;
  closed_at?: string;
  idempotency_key?: string;
  created_at: string;
  updated_at: string;

  // Joined relations for UI convenience
  truck?: Truck;
  driver?: Driver;
  loading_site?: Site;
  offloading_site?: Site;
  loading_event?: TripLoadingEvent;
  offloading_event?: TripOffloadingEvent;
}

export interface ExceptionItem {
  id: string;
  trip_id: string;
  trip_number?: string;
  truck_plate?: string;
  exception_type:
    | 'volume_variance'
    | 'plate_mismatch'
    | 'unregistered_vehicle'
    | 'gate_timeout'
    | 'route_anomaly'
    | 'damaged_seal'
    | 'other';
  description: string;
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed';
  owner_id?: string;
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface PayoutItem {
  id: string;
  payout_batch_id: string;
  driver_id: string;
  driver_name?: string;
  trip_count: number;
  quantity_total: number;
  rate_per_unit: number;
  amount: number;
  status: 'pending' | 'queued' | 'success' | 'failed';
  transfer_code?: string;
  failure_reason?: string;
}

export interface PayoutBatch {
  id: string;
  batch_number: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  total_trips: number;
  status: 'draft' | 'approved' | 'processing' | 'completed' | 'failed';
  approved_by?: string;
  approved_at?: string;
  paystack_transfer_reference?: string;
  items?: PayoutItem[];
  created_at: string;
}

export interface PaymentProfile {
  id: string;
  account_name: string;
  account_number: string;
  account_last4: string;
  bank_code: string;
  bank_name: string;
  paystack_recipient_code?: string;
  status: 'unverified' | 'active' | 'suspended';
  verified_at?: string;
}

export interface BusinessComplianceDoc {
  id: string;
  document_type: 'cac_certificate' | 'tin_certificate' | 'scuml' | 'director_id' | 'bank_statement';
  registration_number?: string;
  title: string;
  status: 'pending' | 'verified' | 'rejected';
  notes?: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  entity_name: string;
  entity_id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  reason: string;
  actor_id?: string;
  actor_role: string;
  created_at: string;
}

export interface DraftTrip {
  idempotency_key: string;
  truck_plate: string;
  driver_id: string;
  loading_site_id: string;
  capacity: number;
  captured_at: string;
  notes?: string;
}
