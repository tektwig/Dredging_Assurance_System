import { supabase } from '../../../lib/supabase';
import type { DriverSearchRequest, DriverSearchResult, LoadingDriverByIdResult, RegistrationFailureCode,
  RegistrationRequest, RegistrationResult, SafeDriverSummary } from '../types';
import { LoadingAuthorizationError, RegistrationOutcomeUnknownError } from './errors';

const registrationCodes: readonly RegistrationFailureCode[] = [
  'INVALID_REQUEST_ID', 'INVALID_PLATE', 'INVALID_REGISTRATION_MODE',
  'SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE',
  'PLATE_ALREADY_REGISTERED', 'TRUCK_NOT_FOUND', 'TRUCK_PLATE_MISMATCH',
  'INACTIVE_TRUCK', 'OPEN_TRIP_EXISTS', 'BLOCKING_EXCEPTION',
  'DRIVER_NOT_FOUND', 'INACTIVE_DRIVER', 'INVALID_DRIVER_NAME', 'INVALID_PHONE',
  'INVALID_EMAIL', 'DRIVER_MATCH_REQUIRES_REVIEW', 'PAYMENT_DETAILS_REQUIRED',
  'INVALID_BANK_NAME', 'INVALID_ACCOUNT_NUMBER', 'INVALID_ACCOUNT_NAME',
];
const siteCodes = ['SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE'] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function safeDriver(value: unknown): SafeDriverSummary | null {
  const row = object(value);
  if (!row || typeof row.id !== 'string' || typeof row.full_name !== 'string'
    || typeof row.phone_number !== 'string' || (row.email !== null && typeof row.email !== 'string')
    || typeof row.is_active !== 'boolean') return null;
  return { id: row.id, fullName: row.full_name, phoneNumber: row.phone_number,
    email: row.email, isActive: row.is_active };
}

export async function searchLoadingDrivers(request: DriverSearchRequest): Promise<DriverSearchResult> {
  if (!supabase) throw new Error('Client unavailable');
  const { data, error } = await supabase.rpc('search_loading_drivers', {
    p_query: request.query, p_limit: request.limit ?? 10,
  });
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new Error('Driver search unavailable');
  const row = object(data);
  if (row?.ok === false && typeof row.code === 'string'
    && (row.code === 'INVALID_SEARCH' || siteCodes.some(code => code === row.code))) {
    return { kind: 'business_failure', code: row.code as 'INVALID_SEARCH' | typeof siteCodes[number] };
  }
  if (row?.ok !== true || !Array.isArray(row.drivers)) throw new Error('Invalid driver search response');
  const drivers = row.drivers.map(safeDriver);
  if (drivers.some(driver => driver === null)) throw new Error('Invalid driver search response');
  return { kind: 'results', drivers: drivers as SafeDriverSummary[] };
}

export async function lookupLoadingDriverById(driverId: string, assignmentId: string): Promise<LoadingDriverByIdResult> {
  if (!supabase) throw new Error('Client unavailable');
  const { data, error } = await supabase.rpc('lookup_loading_driver_by_id', {
    p_driver_id: driverId, p_expected_assignment_id: assignmentId,
  });
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new Error('Driver lookup unavailable');
  const row = object(data);
  if (row?.ok === false && typeof row.code === 'string'
    && ['SITE_ASSIGNMENT_REQUIRED','INVALID_SITE_ASSIGNMENT','INACTIVE_SITE','SITE_ASSIGNMENT_CHANGED',
      'DRIVER_NOT_FOUND','INACTIVE_DRIVER'].includes(row.code)) {
    return { kind: 'business_failure', code: row.code as Extract<LoadingDriverByIdResult, { kind: 'business_failure' }>['code'] };
  }
  const driver = safeDriver(row?.driver);
  if (row?.ok !== true || typeof row.assignment_id !== 'string' || !driver || !driver.isActive) {
    throw new Error('Invalid driver lookup response');
  }
  return { kind: 'found', assignmentId: row.assignment_id, driver };
}

export async function registerLoadingParticipant(request: RegistrationRequest): Promise<RegistrationResult> {
  if (!supabase) throw new RegistrationOutcomeUnknownError();
  const newDriver = request.newDriver;
  const { data, error } = await supabase.rpc('register_loading_participant', {
    p_request_id: request.requestId,
    p_plate: request.plate,
    p_expected_truck_id: request.expectedTruckId,
    p_existing_driver_id: request.existingDriverId,
    p_full_name: newDriver?.fullName ?? null,
    p_phone_number: newDriver?.phoneNumber ?? null,
    p_email: newDriver?.email.trim() || null,
    p_bank_name: newDriver?.bankName ?? null,
    p_account_number: newDriver?.accountNumber ?? null,
    p_account_name: newDriver?.accountName ?? null,
  });
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new RegistrationOutcomeUnknownError();
  const row = object(data);
  if (row?.ok === false && typeof row.code === 'string' && registrationCodes.includes(row.code as RegistrationFailureCode)) {
    return { kind: 'business_failure', code: row.code as RegistrationFailureCode };
  }
  const truck = object(row?.truck);
  const driver = object(row?.driver);
  if (row?.ok !== true || row.request_id !== request.requestId || !truck || !driver
    || typeof truck.id !== 'string' || typeof truck.registration_number !== 'string'
    || typeof truck.normalized_registration !== 'string' || typeof truck.created !== 'boolean'
    || typeof driver.id !== 'string' || typeof driver.full_name !== 'string'
    || typeof driver.phone_number !== 'string' || (driver.email !== null && typeof driver.email !== 'string')
    || typeof driver.created !== 'boolean' || typeof row.payment_details_captured !== 'boolean'
    || row.default_driver_changed !== false) throw new RegistrationOutcomeUnknownError();
  return { kind: 'success', requestId: row.request_id,
    truck: { id: truck.id, registrationNumber: truck.registration_number,
      normalizedRegistration: truck.normalized_registration, created: truck.created },
    driver: { id: driver.id, fullName: driver.full_name, phoneNumber: driver.phone_number,
      email: driver.email, created: driver.created },
    paymentDetailsCaptured: row.payment_details_captured,
    defaultDriverChanged: false };
}
