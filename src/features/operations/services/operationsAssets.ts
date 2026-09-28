import { supabase } from '../../../lib/supabase';
import { DEFAULT_PAGE_SIZE, normalizePageRequest } from '../../../types/listQuery';
import type { Database } from '../../../types/profile';

export type AssetKind = 'truck' | 'driver';
export type ActiveFilter = 'all' | 'active' | 'inactive';
export type AssetFilters = { search: string; active: ActiveFilter };
export type AssetPage<T> = { items: T[]; page: number; pageSize: number; totalCount: number; hasNext: boolean };
export type TruckRow = {
  truck_id: string; plate: string; truck_type: string | null; capacity: number | null;
  capacity_unit: string | null; regular_driver_id: string; regular_driver_name: string;
  is_active: boolean; registered_at: string; total_trips: number; open_trips: number;
  last_trip_at: string | null;
};
export type DriverRow = {
  driver_id: string; name: string; phone: string; email: string | null; is_active: boolean;
  registered_at: string; regular_trucks: number; total_trips: number; open_trips: number;
  last_trip_at: string | null;
};
export type TruckDetail = Omit<TruckRow, 'regular_driver_id' | 'regular_driver_name' | 'last_trip_at'> & {
  owner_name: string | null; owner_contact: string | null; updated_at: string;
  regular_driver: { driver_id: string; name: string; is_active: boolean };
};
export type DriverDetail = Omit<DriverRow, 'last_trip_at'> & {
  license_number: string | null; updated_at: string; active_regular_trucks: number;
  regular_truck_preview: Array<{ truck_id: string; plate: string; is_active: boolean }>;
};
export type AssetTrip = {
  trip_id: string; trip_number: string; plate: string; driver_name: string;
  opened_at: string; closed_at: string | null; status: 'open' | 'closed' | 'cancelled';
  tonnage: number | null;
};
export type MutationOutcome = { outcome: 'updated' | 'unchanged'; updated_at: string };
export type MutationErrorKind = 'stale' | 'open-trip' | 'relationship' | 'duplicate' | 'denied' | 'failed';

export class OperationsAssetError extends Error {
  constructor(public readonly kind: MutationErrorKind) {
    super({ stale: 'This record changed. The latest details have been loaded.',
      'open-trip': 'An open trip prevents this change.',
      relationship: 'An active regular-driver relationship prevents this change.',
      duplicate: 'This plate or phone number is already in use.',
      denied: 'Operations access denied.', failed: 'The change could not be completed.' }[kind]);
  }
}

const validStatus = ['open', 'closed', 'cancelled'];
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const string = (value: unknown): value is string => typeof value === 'string';
const optionalString = (value: unknown): value is string | null => value === null || string(value);
const date = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown): value is string | null => value === null || date(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalNumber = (value: unknown): value is number | null => value === null
  || (typeof value === 'number' && Number.isFinite(value) && value > 0);
function invalid(): never { throw new Error('Invalid Operations Trucks & Drivers response'); }

function parseTruckRow(value: unknown): TruckRow {
  if (!record(value) || !exact(value, ['truck_id', 'plate', 'truck_type', 'capacity', 'capacity_unit',
    'regular_driver_id', 'regular_driver_name', 'is_active', 'registered_at', 'total_trips',
    'open_trips', 'last_trip_at']) || !string(value.truck_id) || !string(value.plate)
    || !optionalString(value.truck_type) || !optionalNumber(value.capacity)
    || !optionalString(value.capacity_unit) || !string(value.regular_driver_id)
    || !string(value.regular_driver_name) || typeof value.is_active !== 'boolean'
    || !date(value.registered_at) || !count(value.total_trips) || !count(value.open_trips)
    || !optionalDate(value.last_trip_at)) invalid();
  return value as TruckRow;
}

function parseDriverRow(value: unknown): DriverRow {
  if (!record(value) || !exact(value, ['driver_id', 'name', 'phone', 'email', 'is_active',
    'registered_at', 'regular_trucks', 'total_trips', 'open_trips', 'last_trip_at'])
    || !string(value.driver_id) || !string(value.name) || !string(value.phone)
    || !optionalString(value.email) || typeof value.is_active !== 'boolean'
    || !date(value.registered_at) || !count(value.regular_trucks)
    || !count(value.total_trips) || !count(value.open_trips) || !optionalDate(value.last_trip_at)) invalid();
  return value as DriverRow;
}

function parsePage<T>(value: unknown, request: { page: number; pageSize: number }, parseItem: (item: unknown) => T): AssetPage<T> {
  if (!record(value) || !exact(value, ['items', 'page', 'page_size', 'total_count', 'has_next'])
    || !Array.isArray(value.items) || value.items.length > request.pageSize
    || value.page !== request.page || value.page_size !== request.pageSize
    || !count(value.total_count) || typeof value.has_next !== 'boolean') invalid();
  return { items: value.items.map(parseItem), page: request.page, pageSize: request.pageSize,
    totalCount: value.total_count, hasNext: value.has_next };
}

export function parseTrucksPage(value: unknown, request: { page: number; pageSize: number }) {
  return parsePage(value, request, parseTruckRow);
}
export function parseDriversPage(value: unknown, request: { page: number; pageSize: number }) {
  return parsePage(value, request, parseDriverRow);
}

export function parseTruckDetail(value: unknown): TruckDetail | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ['truck_id', 'plate', 'truck_type', 'capacity', 'capacity_unit',
    'owner_name', 'owner_contact', 'is_active', 'registered_at', 'updated_at', 'regular_driver',
    'total_trips', 'open_trips']) || !record(value.regular_driver)
    || !exact(value.regular_driver, ['driver_id', 'name', 'is_active'])
    || !string(value.truck_id) || !string(value.plate) || !optionalString(value.truck_type)
    || !optionalNumber(value.capacity) || !optionalString(value.capacity_unit)
    || !optionalString(value.owner_name) || !optionalString(value.owner_contact)
    || typeof value.is_active !== 'boolean' || !date(value.registered_at) || !date(value.updated_at)
    || !string(value.regular_driver.driver_id) || !string(value.regular_driver.name)
    || typeof value.regular_driver.is_active !== 'boolean'
    || !count(value.total_trips) || !count(value.open_trips)) invalid();
  return value as TruckDetail;
}

export function parseDriverDetail(value: unknown): DriverDetail | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ['driver_id', 'name', 'phone', 'email', 'license_number',
    'is_active', 'registered_at', 'updated_at', 'regular_trucks', 'active_regular_trucks', 'regular_truck_preview',
    'total_trips', 'open_trips']) || !string(value.driver_id) || !string(value.name)
    || !string(value.phone) || !optionalString(value.email) || !optionalString(value.license_number)
    || typeof value.is_active !== 'boolean' || !date(value.registered_at) || !date(value.updated_at)
    || !count(value.regular_trucks) || !count(value.active_regular_trucks)
    || value.active_regular_trucks > value.regular_trucks
    || !count(value.total_trips) || !count(value.open_trips)
    || !Array.isArray(value.regular_truck_preview) || value.regular_truck_preview.length > 10
    || !value.regular_truck_preview.every(item => record(item)
      && exact(item, ['truck_id', 'plate', 'is_active']) && string(item.truck_id)
      && string(item.plate) && typeof item.is_active === 'boolean')) invalid();
  return value as DriverDetail;
}

function parseTrip(value: unknown): AssetTrip {
  if (!record(value) || !exact(value, ['trip_id', 'trip_number', 'plate', 'driver_name',
    'opened_at', 'closed_at', 'status', 'tonnage']) || !string(value.trip_id)
    || !string(value.trip_number) || !string(value.plate) || !string(value.driver_name)
    || !date(value.opened_at) || !optionalDate(value.closed_at)
    || !validStatus.includes(value.status as string) || !optionalNumber(value.tonnage)) invalid();
  return value as AssetTrip;
}
export function parseHistoryPage(value: unknown, request: { page: number; pageSize: number }) {
  return parsePage(value, request, parseTrip);
}

export function parseMutation(value: unknown): MutationOutcome | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ['outcome', 'updated_at'])
    || !['updated', 'unchanged'].includes(value.outcome as string) || !date(value.updated_at)) invalid();
  return value as MutationOutcome;
}

function client() {
  if (!supabase) throw new Error('Operations Trucks & Drivers unavailable');
  return supabase;
}
function handleError(error: { code?: string } | null): never {
  const kind: MutationErrorKind = error?.code === 'P4090' ? 'stale'
    : error?.code === 'P4091' ? 'open-trip'
      : error?.code === 'P4092' ? 'relationship'
        : error?.code === '23505' ? 'duplicate'
          : error?.code === '42501' ? 'denied' : 'failed';
  throw new OperationsAssetError(kind);
}
function activeArg(active: ActiveFilter): boolean | null {
  return active === 'all' ? null : active === 'active';
}

export async function loadTrucks(filters: AssetFilters, page: number, regularDriverId?: string) {
  const request = normalizePageRequest(page);
  const result = await client().rpc('get_operations_trucks', { p_page: request.page,
    p_page_size: request.pageSize, p_search: filters.search.trim() || null,
    p_active: activeArg(filters.active), p_regular_driver_id: regularDriverId || null });
  if (result.error) handleError(result.error);
  return parseTrucksPage(result.data, request);
}
export async function loadDrivers(filters: AssetFilters, page: number) {
  const request = normalizePageRequest(page);
  const result = await client().rpc('get_operations_drivers', { p_page: request.page,
    p_page_size: request.pageSize, p_search: filters.search.trim() || null,
    p_active: activeArg(filters.active) });
  if (result.error) handleError(result.error);
  return parseDriversPage(result.data, request);
}
export async function loadTruckDetail(truckId: string) {
  const result = await client().rpc('get_operations_truck_detail', { p_truck_id: truckId });
  if (result.error) handleError(result.error);
  return parseTruckDetail(result.data);
}
export async function loadDriverDetail(driverId: string) {
  const result = await client().rpc('get_operations_driver_detail', { p_driver_id: driverId });
  if (result.error) handleError(result.error);
  return parseDriverDetail(result.data);
}
export async function loadAssetHistory(kind: AssetKind, assetId: string, page: number) {
  const request = normalizePageRequest(page);
  const result = await client().rpc('get_operations_asset_trips', { p_kind: kind,
    p_asset_id: assetId, p_page: request.page, p_page_size: request.pageSize });
  if (result.error) handleError(result.error);
  return parseHistoryPage(result.data, request);
}

type AssetMutationName = 'update_operations_truck_master' | 'correct_operations_truck_plate'
  | 'set_operations_truck_regular_driver' | 'set_operations_truck_active'
  | 'update_operations_driver_master' | 'set_operations_driver_active';
type AssetMutationArgs = Database['public']['Functions'][AssetMutationName]['Args'];

async function mutate(name: AssetMutationName, args: AssetMutationArgs): Promise<MutationOutcome | null> {
  const result = await client().rpc(name, args);
  if (result.error) handleError(result.error);
  return parseMutation(result.data);
}
export const updateTruckMaster = (truckId: string, expected: string, values: {
  truckType: string; capacity: string; ownerName: string; ownerContact: string; reason: string;
}) => mutate('update_operations_truck_master', { p_truck_id: truckId, p_expected_updated_at: expected,
  p_truck_type: values.truckType.trim() || null, p_capacity: values.capacity.trim() || null,
  p_owner_name: values.ownerName.trim() || null, p_owner_contact: values.ownerContact.trim() || null,
  p_reason: values.reason });
export const correctTruckPlate = (truckId: string, expected: string, plate: string) =>
  mutate('correct_operations_truck_plate', { p_truck_id: truckId, p_expected_updated_at: expected,
    p_plate: plate.trim(), p_reason: 'identity_correction' });
export const setRegularDriver = (truckId: string, expected: string, driverId: string) =>
  mutate('set_operations_truck_regular_driver', { p_truck_id: truckId, p_expected_updated_at: expected,
    p_driver_id: driverId, p_reason: 'regular_driver_change' });
export const setTruckActive = (truckId: string, expected: string, active: boolean) =>
  mutate('set_operations_truck_active', { p_truck_id: truckId, p_expected_updated_at: expected,
    p_active: active, p_reason: active ? 'reactivate' : 'deactivate' });
export const updateDriverMaster = (driverId: string, expected: string, values: {
  name: string; phone: string; email: string; licenseNumber: string; reason: string;
}) => mutate('update_operations_driver_master', { p_driver_id: driverId, p_expected_updated_at: expected,
  p_name: values.name.trim(), p_phone: values.phone.trim(), p_email: values.email.trim() || null,
  p_license_number: values.licenseNumber.trim() || null, p_reason: values.reason });
export const setDriverActive = (driverId: string, expected: string, active: boolean) =>
  mutate('set_operations_driver_active', { p_driver_id: driverId, p_expected_updated_at: expected,
    p_active: active, p_reason: active ? 'reactivate' : 'deactivate' });

export const ASSET_PAGE_SIZE = DEFAULT_PAGE_SIZE;
