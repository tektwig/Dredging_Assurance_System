import { supabase } from '../../../lib/supabase';
import { normalizeOffloadingPlate, type OffloadingLookupResult, type OffloadingOpenTripsResult } from '../types';

export class OffloadingAuthorizationError extends Error {
  constructor() { super('Offloading access unavailable'); }
}

const failures = new Set(['INVALID_PLATE', 'NO_OPEN_TRIP', 'SITE_ASSIGNMENT_REQUIRED',
  'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE']);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function parseOffloadingLookup(value: unknown): OffloadingLookupResult {
  if (!record(value)) throw new Error('Invalid offloading lookup response');
  if (value.ok === false && nonempty(value.code) && failures.has(value.code)) {
    return { kind: 'business_failure', code: value.code as Extract<OffloadingLookupResult, {kind:'business_failure'}>['code'] };
  }
  if (value.ok !== true || !record(value.assignment) || value.assignment.ok !== true || !record(value.trip)) {
    throw new Error('Invalid offloading lookup response');
  }
  const assignment = value.assignment;
  const trip = value.trip;
  if (![assignment.assignment_id, assignment.site_id, assignment.site_name,
    trip.id, trip.trip_number, trip.truck_id, trip.registration_number,
    trip.normalized_registration, trip.driver_id, trip.driver_name,
    trip.opened_at, trip.loading_site_name].every(nonempty)
    || Number.isNaN(Date.parse(trip.opened_at as string))
    || !(trip.estimated_quantity_tonnes === null || (typeof trip.estimated_quantity_tonnes === 'number'
      && Number.isFinite(trip.estimated_quantity_tonnes) && trip.estimated_quantity_tonnes > 0
      && trip.estimated_quantity_tonnes < 100000000
      && Math.abs(trip.estimated_quantity_tonnes * 100 - Math.round(trip.estimated_quantity_tonnes * 100)) < 0.000001))) {
    throw new Error('Invalid offloading lookup response');
  }
  return { kind: 'found', assignment: {
    assignmentId: assignment.assignment_id as string, siteId: assignment.site_id as string,
    siteName: assignment.site_name as string,
  }, trip: {
    id: trip.id as string, tripNumber: trip.trip_number as string,
    truckId: trip.truck_id as string, registrationNumber: trip.registration_number as string,
    normalizedRegistration: trip.normalized_registration as string,
    driverId: trip.driver_id as string, driverName: trip.driver_name as string,
    openedAt: trip.opened_at as string, loadingSiteName: trip.loading_site_name as string,
    estimatedQuantityTonnes: trip.estimated_quantity_tonnes as number | null,
  } };
}

const openTripsFailures = new Set(['SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE']);

export function parseOffloadingOpenTrips(value: unknown): OffloadingOpenTripsResult {
  if (!record(value)) throw new Error('Invalid Offloading Open Trips response');
  if (value.ok === false && nonempty(value.code) && openTripsFailures.has(value.code)) {
    return { kind: 'business_failure', code: value.code as Extract<OffloadingOpenTripsResult,
      { kind: 'business_failure' }>['code'] };
  }
  if (value.ok !== true || !record(value.assignment) || !Array.isArray(value.trips)) {
    throw new Error('Invalid Offloading Open Trips response');
  }
  const assignment = value.assignment;
  if (![assignment.assignment_id, assignment.site_id, assignment.site_name].every(nonempty)) {
    throw new Error('Invalid Offloading Open Trips response');
  }
  const trips = value.trips.map(row => {
    if (!record(row) || ![row.id, row.trip_number, row.truck_id, row.registration_number,
      row.normalized_registration, row.opened_at, row.loading_site_name].every(nonempty)
      || Number.isNaN(Date.parse(row.opened_at as string))
      || normalizeOffloadingPlate(row.registration_number as string) !== row.normalized_registration
      || !/^[A-Z0-9]{1,32}$/.test(row.normalized_registration as string)) {
      throw new Error('Invalid Offloading Open Trips response');
    }
    return {
      id: row.id as string,
      tripNumber: row.trip_number as string,
      truckId: row.truck_id as string,
      registrationNumber: row.registration_number as string,
      normalizedRegistration: row.normalized_registration as string,
      openedAt: row.opened_at as string,
      loadingSiteName: row.loading_site_name as string,
    };
  });
  return { kind: 'ready', value: {
    assignment: { assignmentId: assignment.assignment_id as string,
      siteId: assignment.site_id as string, siteName: assignment.site_name as string },
    trips,
  } };
}

export async function loadOffloadingOpenTrips(): Promise<OffloadingOpenTripsResult> {
  if (!supabase) throw new Error('Offloading Open Trips unavailable');
  const { data, error } = await supabase.rpc('get_offloading_open_trips');
  if (error?.code === '42501') throw new OffloadingAuthorizationError();
  if (error) throw new Error('Offloading Open Trips unavailable');
  return parseOffloadingOpenTrips(data);
}

export async function lookupOffloadingOpenTrip(plate: string): Promise<OffloadingLookupResult> {
  if (!supabase) throw new Error('Offloading lookup unavailable');
  const { data, error } = await supabase.rpc('lookup_offloading_open_trip', { p_plate: plate });
  if (error?.code === '42501') throw new OffloadingAuthorizationError();
  if (error) throw new Error('Offloading lookup unavailable');
  return parseOffloadingLookup(data);
}
