import { supabase } from '../../../lib/supabase';
import { OffloadingAuthorizationError } from './offloadingData';
import type { OffloadingStatistics } from '../types';

const statisticKeys = [
  'trips_closed_today', 'open_trips', 'tonnage_processed_today', 'trucks_processed_today',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function tonnage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function parseOffloadingStatistics(value: unknown): OffloadingStatistics {
  if (!record(value) || Object.keys(value).length !== statisticKeys.length
    || statisticKeys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || !count(value.trips_closed_today) || !count(value.open_trips)
    || !tonnage(value.tonnage_processed_today) || !count(value.trucks_processed_today)) {
    throw new Error('Invalid Offloading statistics response');
  }
  return {
    tripsClosedToday: value.trips_closed_today,
    openTrips: value.open_trips,
    tonnageProcessedToday: value.tonnage_processed_today,
    trucksProcessedToday: value.trucks_processed_today,
  };
}

export async function loadOffloadingStatistics(): Promise<OffloadingStatistics> {
  if (!supabase) throw new Error('Offloading statistics unavailable');
  const { data, error } = await supabase.rpc('get_offloading_statistics');
  if (error?.code === '42501') throw new OffloadingAuthorizationError();
  if (error) throw new Error('Offloading statistics unavailable');
  return parseOffloadingStatistics(data);
}
