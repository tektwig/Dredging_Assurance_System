// Domain Models for Adams Sand Dredging Truck Movement Waybill & Revenue Assurance System
// Unifying Field Operations, ANPR OCR, Commercial Invoices, Paystack Settlement, and Governance

export type UserRole =
  | 'loading_officer'
  | 'offloading_officer'
  | 'operations_manager'
  | 'finance_officer'
  | 'admin'
  | 'system_admin'
  | 'audit_reviewer';

export type SiteType = 'loading' | 'offloading' | 'hybrid';

export interface Site {
  id: string;
  name: string;
  code?: string;
  site_code?: string;
  site_type: SiteType;
  status: 'active' | 'inactive';
  location?: string;
  location_description?: string;
  timezone: string;
  daily_target_tonnes?: number;
}

export interface Truck {
  id: string;
  registration_number: string;
  normalized_registration: string; // Canonical format (no spaces/hyphens, uppercase)
  capacity?: number;
  capacity_tonnes?: number;
  capacity_unit?: 'm3' | 'tonnes' | 'truckloads';
  truck_type: string; // e.g., '10-Wheeler Tipper', 'Sino 30T', 'Mack 35T'
  owner_name: string;
  owner_phone?: string;
  status: 'active' | 'maintenance' | 'flagged' | 'suspended';
  created_at?: string;
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
  account_number?: string;
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
  plate_image_file_id?: string;
  plate_image_url?: string;
  extracted_number?: string;
  confirmed_number?: string;
  extracted_plate?: string;
  confirmed_plate?: string;
  confidence_score: number; // 0 to 100
  captured_by?: string;
  captured_by_name?: string;
  captured_by_id?: string;
  operator_notes?: string;
  notes?: string;
  estimated_tonnes?: number;
  captured_at: string;
}

export interface TripOffloadingEvent {
  id: string;
  trip_id: string;
  quantity: number;
  unit: QuantityUnit;
  weighed_at: string;
  evidence_file_id?: string;
  ticket_image_url?: string;
  scale_ticket_number?: string;
  scale_ticket_url?: string;
  delivery_plate_image_url?: string;
  delivery_extracted_plate?: string;
  delivery_confirmed_plate?: string;
  delivery_plate_confidence?: number;
  delivery_plate_captured_at?: string;
  closed_by?: string;
  closed_by_name?: string;
  closed_by_id?: string;
  variance_percentage?: number;
  variance_from_estimate?: number;
  operator_notes?: string;
  notes?: string;
}

export type ExceptionType =
  | 'unlisted_truck'
  | 'quantity_mismatch'
  | 'plate_discrepancy'
  | 'gate_timeout'
  | 'diversion_suspected'
  | 'damaged_cargo'
  | 'volume_variance'
  | 'plate_mismatch'
  | 'unregistered_vehicle'
  | 'route_anomaly'
  | 'damaged_seal'
  | 'other';

export interface TripException {
  id: string;
  trip_id: string;
  trip_number: string;
  exception_type: ExceptionType;
  description: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_review' | 'resolved' | 'cancelled' | 'pending' | 'under_review' | 'dismissed';
  flagged_by?: string;
  flagged_at?: string;
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
  driver_id: string;
  loading_site_id: string;
  offloading_site_id?: string;
  status: TripStatus;
  loaded_at: string;
  closed_at?: string;
  idempotency_key?: string;
  created_at?: string;
  updated_at?: string;
  truck_registration_at_loading?: string;
  truck_type_at_loading?: string;
  truck_capacity_at_loading?: number;
  truck_owner_at_loading?: string;
  driver_name_at_loading?: string;
  driver_phone_at_loading?: string;
  driver_license_at_loading?: string;

  // Joined relations for UI convenience
  truck?: Truck;
  driver?: Driver;
  loading_site?: Site;
  offloading_site?: Site;
  loading_event?: TripLoadingEvent;
  offloading_event?: TripOffloadingEvent;
  exceptions?: TripException[];
}

export interface TripClosureInvoice {
  id: string;
  invoice_number: string;
  trip_id: string;
  trip_number: string;
  truck_id: string;
  truck_registration: string;
  truck_type?: string;
  truck_capacity_tonnes?: number;
  truck_owner_name?: string;
  driver_id: string;
  driver_name: string;
  driver_phone?: string;
  driver_license?: string;
  loading_site_id: string;
  loading_site_name: string;
  offloading_site_id: string;
  offloading_site_name: string;
  quantity_tonnes: number;
  opened_at: string;
  closed_at: string;
  issued_at: string;
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
  driver_name: string;
  bank_name?: string;
  account_last4?: string;
  trip_count: number;
  quantity_total?: number;
  quantity_total_tonnes?: number;
  rate_per_unit?: number;
  rate_per_tonne_ngn?: number;
  amount?: number;
  amount_ngn?: number;
  status: 'pending' | 'queued' | 'processing' | 'success' | 'failed';
  transfer_code?: string;
  paystack_transfer_code?: string;
  failure_reason?: string;
}

export interface PayoutBatch {
  id: string;
  batch_number?: string;
  batch_reference?: string;
  period_start: string;
  period_end: string;
  gross_amount?: number;
  gross_amount_ngn?: number;
  total_trips: number;
  total_tonnes?: number;
  status: 'draft' | 'approved' | 'processing' | 'completed' | 'failed' | 'pending_approval' | 'disbursed';
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
  file_name?: string;
  file_size?: string;
  status: 'verified' | 'pending_review' | 'rejected' | 'missing';
  uploaded_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  expiry_date?: string;
}

export interface AuditLogEntry {
  id: string;
  entity_name?: string;
  entity_id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  reason?: string;
  actor_id?: string;
  actor_name?: string;
  actor_role?: UserRole | string;
  created_at?: string;
  timestamp?: string;
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

export interface InvoiceItem {
  id: string;
  trip_id?: string;
  trip_number?: string;
  truck_plate?: string;
  description: string;
  sand_type: string;
  quantity: number;
  unit: 'm3' | 'tonnes' | 'truckloads';
  unit_price: number;
  amount: number;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_tin?: string;
  project_site_name?: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled';
  items: InvoiceItem[];
  subtotal: number;
  tax_rate: number; // 7.5% standard VAT
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  currency: string;
  payment_terms: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  paystack_payment_link?: string;
  notes?: string;
  created_at: string;
  paid_at?: string;
  paid_reference?: string;
}
