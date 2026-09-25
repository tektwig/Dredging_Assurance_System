import {
  AuditLogEntry,
  BusinessComplianceDoc,
  Driver,
  ExceptionItem,
  Invoice,
  PayoutBatch,
  Site,
  Trip,
  Truck,
} from '../types';

// Production starts empty. Operational records are loaded from Supabase or
// created by an authorized user; the client must never invent plate numbers,
// drivers, trips, finance records, compliance documents, or audit activity.
export const INITIAL_SITES: Site[] = [];
export const INITIAL_TRUCKS: Truck[] = [];
export const INITIAL_DRIVERS: Driver[] = [];
export const INITIAL_TRIPS: Trip[] = [];
export const INITIAL_EXCEPTIONS: ExceptionItem[] = [];
export const INITIAL_PAYOUT_BATCHES: PayoutBatch[] = [];
export const INITIAL_COMPLIANCE_DOCS: BusinessComplianceDoc[] = [];
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [];
export const INITIAL_INVOICES: Invoice[] = [];

export interface CommercialClientPreset {
  name: string;
  email: string;
  phone: string;
  address: string;
  tin: string;
  default_project: string;
}

export const COMMERCIAL_CLIENT_PRESETS: CommercialClientPreset[] = [];
