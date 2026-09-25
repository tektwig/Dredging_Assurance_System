import { Driver, ExceptionType, Site, Trip, TripException, Truck, UserRole } from '../types';
import { isSupabaseLive, supabase } from './supabase';

type JsonObject = Record<string, any>;

export interface LiveSnapshot {
  sites: Site[];
  trucks: Truck[];
  drivers: Driver[];
  trips: Trip[];
  assignedSiteId?: string;
}

const mapExceptionType = (value: string): ExceptionType => {
  if (value === 'unknown_truck') return 'unlisted_truck';
  if (value === 'offloading_mismatch') return 'quantity_mismatch';
  if (value === 'invalid_driver') return 'unregistered_vehicle';
  if (value === 'dispute') return 'other';
  return 'other';
};

export interface LiveTruckLookup {
  found: boolean;
  truck?: Truck;
  driver?: Driver;
  assignmentId?: string;
  error?: string;
}

export interface LiveParticipantRegistration {
  truck: Truck;
  driver: Driver;
}

const ensureClient = () => {
  if (!isSupabaseLive || !supabase) throw new Error('Live Supabase service is not configured.');
  return supabase;
};

const ensureAuthenticatedClient = async () => {
  const client = ensureClient();
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Your live session has expired. Please sign in again.');
  return client;
};

const mapSite = (row: JsonObject): Site => ({
  id: row.id,
  name: row.name,
  code: row.site_code || row.name?.split(/\s+/).map((word: string) => word[0]).join('').slice(0, 6).toUpperCase(),
  site_code: row.site_code,
  site_type: row.site_type,
  status: row.is_active === false || row.status === 'inactive' ? 'inactive' : 'active',
  location: row.location_description,
  location_description: row.location_description,
  timezone: row.timezone || 'Africa/Lagos',
});

const mapTruck = (row: JsonObject): Truck => ({
  id: row.id,
  registration_number: row.registration_number,
  normalized_registration: row.normalized_registration,
  capacity: Number(row.capacity || row.capacity_tonnes || 30),
  capacity_tonnes: Number(row.capacity_tonnes || row.capacity || 30),
  capacity_unit: row.capacity_unit || 'tonnes',
  truck_type: row.truck_type || 'Registered tipper truck',
  owner_name: row.owner_name || 'Registered haulage operator',
  owner_phone: row.owner_contact,
  status: row.is_active === false ? 'suspended' : (row.status || 'active'),
  created_at: row.created_at,
});

const mapDriver = (row: JsonObject): Driver => ({
  id: row.id,
  full_name: row.full_name,
  phone: row.phone_number || row.phone || '',
  license_number: row.license_number || 'ON FILE',
  status: row.is_active === false ? 'inactive' : (row.status || 'active'),
  assigned_truck_id: row.assigned_truck_id,
  bank_name: row.bank_name,
  account_number_last4: row.account_number_last4,
});

function mapTrip(row: JsonObject, sites: Site[], trucks: Truck[], drivers: Driver[], exceptionRows: JsonObject[]): Trip {
  const truck = trucks.find((item) => item.id === row.truck_id);
  const driver = drivers.find((item) => item.id === row.driver_id) || (row.driver_name_at_loading
    ? {
        id: row.driver_id,
        full_name: row.driver_name_at_loading,
        phone: '',
        license_number: 'ON FILE',
        status: 'active' as const,
      }
    : undefined);
  const openedAt = row.opened_at || row.loaded_at || row.created_at;

  const exceptions: TripException[] = exceptionRows
    .filter((exception) => exception.trip_id === row.id)
    .map((exception) => ({
      id: exception.id,
      trip_id: row.id,
      trip_number: row.trip_number,
      exception_type: mapExceptionType(exception.exception_type),
      description: exception.description,
      severity: exception.blocks_operations ? 'high' : 'medium',
      status: exception.status === 'resolved' ? 'resolved' : 'open',
      flagged_by: exception.reported_by || 'Operational officer',
      flagged_at: exception.created_at,
      resolution_notes: exception.resolution_reason,
      resolved_at: exception.resolved_at,
    }));

  return {
    id: row.id,
    trip_number: row.trip_number,
    truck_id: row.truck_id,
    driver_id: row.driver_id,
    loading_site_id: row.loading_site_id,
    offloading_site_id: row.offloading_site_id,
    status: row.status === 'open' && exceptions.some((exception) => exception.status === 'open') ? 'exception' : row.status,
    loaded_at: openedAt,
    closed_at: row.closed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    truck,
    driver,
    loading_site: sites.find((item) => item.id === row.loading_site_id),
    offloading_site: sites.find((item) => item.id === row.offloading_site_id),
    loading_event: {
      id: `live-loading-${row.id}`,
      trip_id: row.id,
      confirmed_plate: truck?.registration_number,
      confidence_score: 100,
      captured_at: openedAt,
      estimated_tonnes: truck?.capacity_tonnes || 30,
      captured_by_name: 'Loading officer',
    },
    offloading_event: row.status === 'closed'
      ? {
          id: `live-offloading-${row.id}`,
          trip_id: row.id,
          quantity: Number(row.quantity_tonnes || 0),
          unit: 'tonnes',
          weighed_at: row.closed_at,
          closed_by_name: 'Offloading officer',
        }
      : undefined,
    exceptions,
  };
}

export async function fetchLiveSnapshot(role: UserRole | null): Promise<LiveSnapshot> {
  const client = ensureClient();
  const [sitesResult, trucksResult, tripsResult, assignmentsResult, exceptionsResult] = await Promise.all([
    client.from('sites').select('*').eq('is_active', true),
    client.from('trucks').select('*').eq('is_active', true),
    client.from('trips').select('*').order('opened_at', { ascending: false }).limit(500),
    client.from('user_site_assignments').select('site_id').is('ended_at', null).limit(1),
    client.from('exceptions').select('*').order('created_at', { ascending: false }).limit(500),
  ]);

  const firstError = sitesResult.error || trucksResult.error || tripsResult.error || exceptionsResult.error;
  if (firstError) throw firstError;

  let driverRows: JsonObject[] = [];
  if (role !== 'loading_officer') {
    const driversResult = await client.from('drivers').select('*').eq('is_active', true);
    if (driversResult.error) throw driversResult.error;
    driverRows = driversResult.data || [];
  }

  const sites = (sitesResult.data || []).map(mapSite);
  const trucks = (trucksResult.data || []).map(mapTruck);
  const drivers = driverRows.map(mapDriver);
  const trips = (tripsResult.data || []).map((row) => mapTrip(row, sites, trucks, drivers, exceptionsResult.data || []));

  return {
    sites,
    trucks,
    drivers,
    trips,
    assignedSiteId: assignmentsResult.data?.[0]?.site_id,
  };
}

export async function lookupLiveTruck(plate: string): Promise<LiveTruckLookup> {
  const client = await ensureAuthenticatedClient();
  const { data, error } = await client.rpc('lookup_loading_truck', { p_plate: plate });
  if (error) return { found: false, error: error.message };
  const result = data as JsonObject;
  if (!result?.ok) return { found: false, error: result?.code || 'Truck lookup failed.' };
  if (!result.found) return { found: false, assignmentId: result.assignment?.assignment_id };

  return {
    found: true,
    truck: mapTruck(result.truck),
    driver: result.default_driver?.id ? mapDriver(result.default_driver) : undefined,
    assignmentId: result.assignment?.assignment_id,
    error: result.block?.code,
  };
}

export async function registerLiveParticipant(params: {
  plate: string;
  expectedTruckId?: string;
  fullName: string;
  phoneNumber: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  capacityTonnes?: number;
  truckType?: string;
  ownerName?: string;
  ownerPhone?: string;
}): Promise<LiveParticipantRegistration> {
  const client = await ensureAuthenticatedClient();
  const { data, error } = await client.rpc('register_loading_participant', {
    p_request_id: crypto.randomUUID(),
    p_plate: params.plate,
    p_expected_truck_id: params.expectedTruckId || null,
    p_existing_driver_id: null,
    p_full_name: params.fullName,
    p_phone_number: params.phoneNumber,
    p_email: null,
    p_bank_name: params.bankName,
    p_account_number: params.accountNumber,
    p_account_name: params.accountName,
  });
  if (error) throw error;

  const result = data as JsonObject;
  if (!result?.ok) throw new Error(result?.code || 'The truck and driver could not be registered.');

  const truck: Truck = {
    ...mapTruck(result.truck),
    capacity: params.capacityTonnes || 30,
    capacity_tonnes: params.capacityTonnes || 30,
    truck_type: params.truckType || 'Registered tipper truck',
    owner_name: params.ownerName || 'Registered haulage operator',
    owner_phone: params.ownerPhone,
  };
  const driver: Driver = {
    ...mapDriver(result.driver),
    assigned_truck_id: truck.id,
    bank_name: params.bankName,
    account_number_last4: params.accountNumber.slice(-4),
  };

  return { truck, driver };
}

async function imageUrlToBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('The captured plate image could not be read for upload.');
  return response.blob();
}

export async function createLiveLoadingTrip(params: {
  plate: string;
  driverId: string;
  plateImageUrl: string;
  confidenceScore: number;
}): Promise<JsonObject> {
  const client = await ensureAuthenticatedClient();
  const { data: sessionData } = await client.auth.getSession();
  const user = sessionData.session!.user;

  const lookup = await lookupLiveTruck(params.plate);
  if (!lookup.found || !lookup.assignmentId) {
    throw new Error(lookup.error || 'The truck or loading-site assignment could not be verified.');
  }

  const image = await imageUrlToBlob(params.plateImageUrl);
  const extension = image.type === 'image/png' ? 'png' : 'jpg';
  const imagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage
    .from('loading-plate-evidence')
    .upload(imagePath, image, { contentType: image.type || 'image/jpeg', upsert: false });
  if (uploadError) throw uploadError;

  const requestId = crypto.randomUUID();
  const { data, error } = await client.rpc('create_loading_trip_v2', {
    p_request_id: requestId,
    p_plate: params.plate,
    p_driver_id: params.driverId,
    p_expected_assignment_id: lookup.assignmentId,
    p_capture_method: 'OCR',
    p_captured_at: new Date().toISOString(),
    p_ocr_detected_plate: params.plate,
    p_ocr_confidence: Math.max(0, Math.min(1, params.confidenceScore / 100)),
    p_image_path: imagePath,
    p_make_default_driver: false,
  });
  if (error) throw error;
  const result = data as JsonObject;
  if (!result?.ok) throw new Error(result?.code || 'The live trip could not be opened.');
  return result.trip;
}

export async function closeLiveTrip(params: {
  tripId: string;
  offloadingSiteId: string;
  quantityTonnes: number;
}): Promise<JsonObject> {
  const client = await ensureAuthenticatedClient();
  const { data, error } = await client.rpc('close_trip', {
    p_trip_id: params.tripId,
    p_offloading_site_id: params.offloadingSiteId,
    p_quantity_tonnes: Number(params.quantityTonnes.toFixed(2)),
  });
  if (error) throw error;
  const result = data as JsonObject;
  if (!result?.ok) throw new Error(result?.code || 'The live trip could not be closed.');
  return result.trip;
}

export async function raiseLiveTripException(params: {
  type: string;
  description: string;
  tripId: string;
  truckId?: string;
}): Promise<string> {
  const client = await ensureAuthenticatedClient();
  const type = params.type === 'unlisted_truck'
    ? 'unknown_truck'
    : params.type === 'quantity_mismatch' || params.type === 'plate_discrepancy'
      ? 'offloading_mismatch'
      : 'dispute';
  const { data, error } = await client.rpc('raise_trip_exception', {
    p_type: type,
    p_description: params.description,
    p_truck_id: params.truckId || null,
    p_trip_id: params.tripId,
    p_entered_plate: null,
    p_blocks_operations: true,
  });
  if (error) throw error;
  return data as string;
}

export async function resolveLiveTripException(params: { exceptionId: string; reason: string }) {
  const client = await ensureAuthenticatedClient();
  const { error } = await client.rpc('resolve_trip_exception', {
    p_exception_id: params.exceptionId,
    p_reason: params.reason,
  });
  if (error) throw error;
}

export function subscribeToLiveTrips(onChange: () => void) {
  if (!isSupabaseLive || !supabase) return () => undefined;
  const channel = supabase
    .channel('operational-trips-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, onChange)
    .subscribe();

  return () => {
    void supabase?.removeChannel(channel);
  };
}
