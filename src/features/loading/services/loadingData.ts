import { supabase } from '../../../lib/supabase';
import type { AssignedLoadingSite, LoadingStatistics, LookupFailureCode, TruckLookupRequest, TruckLookupResult } from '../types';
import { LoadingAuthorizationError } from './errors';

const LOOKUP_FAILURES: LookupFailureCode[] = [
  'INVALID_PLATE', 'SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE',
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown): value is string { return typeof value === 'string'; }

export async function loadAssignedSite(actorId: string): Promise<
  | { kind: 'ready'; site: AssignedLoadingSite }
  | { kind: 'blocked'; reason: 'missing' | 'wrong_type' | 'inactive' }
> {
  if (!supabase) throw new Error('Client unavailable');
  const assignment = await supabase.from('user_site_assignments')
    .select('id, site_id').eq('profile_id', actorId).is('ended_at', null).maybeSingle();
  if (assignment.error?.code === '42501') throw new LoadingAuthorizationError();
  if (assignment.error) throw new Error('Assignment read failed');
  if (!assignment.data) return { kind: 'blocked', reason: 'missing' };
  const site = await supabase.from('sites').select('id, name, site_type, is_active')
    .eq('id', assignment.data.site_id).maybeSingle();
  if (site.error?.code === '42501') throw new LoadingAuthorizationError();
  if (site.error) throw new Error('Site read failed');
  // The Loading site policy hides inactive rows. The assignment FK guarantees
  // the site exists, so an invisible assigned row is an inactive site.
  if (!site.data) return { kind: 'blocked', reason: 'inactive' };
  if (site.data.site_type !== 'loading') return { kind: 'blocked', reason: 'wrong_type' };
  if (!site.data.is_active) return { kind: 'blocked', reason: 'inactive' };
  return { kind: 'ready', site: {
    assignmentId: assignment.data.id, siteId: site.data.id, siteName: site.data.name,
  } };
}

export async function loadLoadingStatistics(): Promise<LoadingStatistics> {
  if (!supabase) throw new Error('Client unavailable');
  const { data, error } = await supabase.rpc('get_loading_statistics');
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new Error('Statistics read failed');
  const result = record(data);
  if (!result || result.ok !== true) throw new Error('Statistics unavailable');
  const validCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!validCount(result.trips_opened) || !validCount(result.open_trips)
    || !validCount(result.trips_closed) || !validCount(result.trucks_processed)) {
    throw new Error('Invalid statistics response');
  }
  return { tripsOpened: result.trips_opened, openTrips: result.open_trips,
    tripsClosed: result.trips_closed, trucksProcessed: result.trucks_processed };
}

export async function lookupLoadingTruck(request: TruckLookupRequest): Promise<TruckLookupResult> {
  if (!supabase) throw new Error('Client unavailable');
  const { data, error } = await supabase.rpc('lookup_loading_truck', { p_plate: request.plate });
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new Error('Truck lookup failed');
  const result = record(data);
  if (!result) throw new Error('Invalid truck lookup response');
  if (result.ok === false) {
    if (string(result.code) && LOOKUP_FAILURES.includes(result.code as LookupFailureCode)) {
      return { kind: 'business_failure', code: result.code as LookupFailureCode };
    }
    throw new Error('Unexpected truck lookup response');
  }
  if (result.ok !== true) throw new Error('Invalid truck lookup response');
  const assignment = record(result.assignment);
  if (!assignment || assignment.ok !== true || !string(assignment.assignment_id)) {
    throw new Error('Invalid truck lookup assignment');
  }
  const assignmentId = assignment.assignment_id;
  if (result.found === false) return { kind: 'unknown_truck', assignmentId };
  if (result.found !== true) throw new Error('Invalid truck lookup response');
  const truck = record(result.truck);
  if (!truck || !string(truck.id) || !string(truck.registration_number)
    || !string(truck.normalized_registration) || typeof truck.is_active !== 'boolean') {
    throw new Error('Invalid truck response');
  }
  const safeTruck = {
    id: truck.id, registrationNumber: truck.registration_number,
    normalizedRegistration: truck.normalized_registration, isActive: truck.is_active,
  };
  if (!safeTruck.isActive) return { kind: 'inactive_truck', assignmentId, truck: safeTruck };
  if (result.block !== null) {
    const block = record(result.block);
    const details = record(block?.details);
    if (block?.ok !== false || !string(block.code)) throw new Error('Invalid truck block');
    if (block.code === 'OPEN_TRIP_EXISTS' && string(details?.trip_id) && string(details.trip_number)) {
      return { kind: 'open_trip_exists', assignmentId, truck: safeTruck,
        trip: { tripId: details.trip_id, tripNumber: details.trip_number } };
    }
    if (block.code === 'BLOCKING_EXCEPTION') return { kind: 'blocking_exception', assignmentId, truck: safeTruck };
    throw new Error('Unexpected truck block');
  }
  const driver = record(result.default_driver);
  if (!driver || !string(driver.id) || !string(driver.full_name) || !string(driver.phone_number)
    || (driver.email !== null && !string(driver.email)) || typeof driver.is_active !== 'boolean') {
    throw new Error('Invalid regular driver response');
  }
  const safeDriver = { id: driver.id, fullName: driver.full_name, phoneNumber: driver.phone_number,
    email: driver.email, isActive: driver.is_active };
  if (!safeDriver.isActive) return { kind: 'inactive_driver', assignmentId, truck: safeTruck, driver: safeDriver };
  return { kind: 'known_ready', assignmentId, truck: safeTruck, driver: safeDriver };
}
