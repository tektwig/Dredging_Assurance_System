export interface WaybillFields {
  invoice_number: string;
  truck_registration: string;
  driver_name: string;
  loading_site_name: string;
  offloading_site_name: string;
  quantity_tonnes: number | string;
  opened_at: string;
  closed_at: string;
  issued_at: string;
}

export interface LegacyWaybillSnapshot {
  invoice_number: string;
  trip_number: string;
  truck_registration: string;
  truck_type: string | null;
  truck_capacity_tonnes: number | string | null;
  truck_owner_name: string | null;
  driver_name: string;
  driver_phone: string | null;
  driver_email: string | null;
  driver_license: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  loading_site_name: string;
  offloading_site_name: string;
  quantity_tonnes: number | string;
  opened_at: string;
  closed_at: string;
  loading_officer_name: string | null;
  offloading_officer_name: string | null;
  issued_at: string;
}

export interface DriverWaybillSnapshot extends WaybillFields {
  copy_kind: 'driver';
}

export interface CompanyWaybillSnapshot extends WaybillFields {
  copy_kind: 'company';
  driver_phone: string | null;
  bank_name: string;
  account_name: string;
  account_number: string;
}

export interface WaybillPdfJob {
  copy_id: string;
  invoice_id: string;
  trip_id: string;
  invoice_number: string;
  storage_bucket: string;
  storage_path: string;
  attempts: number;
  lease_token: string;
  lease_until: string;
}

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export type PdfFailureCode =
  | 'snapshot_unavailable'
  | 'invalid_snapshot'
  | 'pdf_generation_failed'
  | 'storage_upload_failed';

export interface PdfGenerators {
  legacy: (snapshot: LegacyWaybillSnapshot) => Promise<Uint8Array>;
  driver: (snapshot: DriverWaybillSnapshot) => Promise<Uint8Array>;
  company: (snapshot: CompanyWaybillSnapshot) => Promise<Uint8Array>;
}
