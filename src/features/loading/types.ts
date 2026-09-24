export type AssignedLoadingSite = {
  assignmentId: string;
  siteId: string;
  siteName: string;
};

export type SiteContextState =
  | { status: 'loading' }
  | { status: 'ready'; site: AssignedLoadingSite }
  | { status: 'blocked'; reason: 'missing' | 'wrong_type' | 'inactive' | 'unauthorized' }
  | { status: 'error' };

export type LoadingStatistics = {
  tripsOpened: number;
  openTrips: number;
  tripsClosed: number;
  trucksProcessed: number;
};

export type StatisticsState =
  | { status: 'loading' }
  | { status: 'ready'; statistics: LoadingStatistics }
  | { status: 'error' };

export type SafeDriverSummary = {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  isActive: boolean;
};

export type TruckSummary = {
  id: string;
  registrationNumber: string;
  normalizedRegistration: string;
  isActive: boolean;
};

export type OpenTripSummary = { tripId: string; tripNumber: string };
export type TruckLookupRequest = { plate: string };

export type LookupFailureCode =
  | 'INVALID_PLATE'
  | 'SITE_ASSIGNMENT_REQUIRED'
  | 'INVALID_SITE_ASSIGNMENT'
  | 'INACTIVE_SITE';

export type TruckLookupResult =
  | { kind: 'known_ready'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { kind: 'unknown_truck'; assignmentId: string }
  | { kind: 'inactive_truck'; assignmentId: string; truck: TruckSummary }
  | { kind: 'inactive_driver'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { kind: 'open_trip_exists'; assignmentId: string; truck: TruckSummary; trip: OpenTripSummary }
  | { kind: 'blocking_exception'; assignmentId: string; truck: TruckSummary }
  | { kind: 'business_failure'; code: LookupFailureCode };

export type LookupState =
  | { status: 'idle' }
  | { status: 'looking_up'; plate: string }
  | { status: 'known_ready'; plate: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { status: 'unknown_truck'; plate: string }
  | { status: 'inactive_truck'; plate: string; truck: TruckSummary }
  | { status: 'inactive_driver'; plate: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { status: 'open_trip_exists'; plate: string; truck: TruckSummary; trip: OpenTripSummary }
  | { status: 'blocking_exception'; plate: string; truck: TruckSummary }
  | { status: 'invalid_plate'; plate: string }
  | { status: 'site_unavailable' }
  | { status: 'access_unavailable' }
  | { status: 'lookup_error'; plate: string };
