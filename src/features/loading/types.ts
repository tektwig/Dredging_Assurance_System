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

export type DriverSearchRequest = { query: string; limit?: number };
export type DriverSearchResult =
  | { kind: 'results'; drivers: SafeDriverSummary[] }
  | { kind: 'business_failure'; code: 'INVALID_SEARCH' | 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT' | 'INACTIVE_SITE' };

export type NewDriverForm = {
  fullName: string;
  phoneNumber: string;
  email: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
};

export type RegistrationMode = 'new_truck_new_driver' | 'new_truck_existing_driver' | 'existing_truck_new_driver';
export type RegistrationRequest = {
  requestId: string;
  plate: string;
  expectedTruckId: string | null;
  existingDriverId: string | null;
  newDriver: NewDriverForm | null;
};
export type RegistrationFailureCode =
  | 'INVALID_REQUEST_ID' | 'INVALID_PLATE' | 'INVALID_REGISTRATION_MODE'
  | 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT' | 'INACTIVE_SITE'
  | 'PLATE_ALREADY_REGISTERED' | 'TRUCK_NOT_FOUND' | 'TRUCK_PLATE_MISMATCH'
  | 'INACTIVE_TRUCK' | 'OPEN_TRIP_EXISTS' | 'BLOCKING_EXCEPTION'
  | 'DRIVER_NOT_FOUND' | 'INACTIVE_DRIVER' | 'INVALID_DRIVER_NAME'
  | 'INVALID_PHONE' | 'INVALID_EMAIL' | 'DRIVER_MATCH_REQUIRES_REVIEW'
  | 'PAYMENT_DETAILS_REQUIRED' | 'INVALID_BANK_NAME' | 'INVALID_ACCOUNT_NUMBER'
  | 'INVALID_ACCOUNT_NAME';
export type RegistrationSafeResponse = {
  kind: 'success'; requestId: string;
  truck: { id: string; registrationNumber: string; normalizedRegistration: string; created: boolean };
  driver: { id: string; fullName: string; phoneNumber: string; email: string | null; created: boolean };
  paymentDetailsCaptured: boolean;
  defaultDriverChanged: false;
};
export type RegistrationResult = RegistrationSafeResponse | { kind: 'business_failure'; code: RegistrationFailureCode };
export type SelectedActualDriver = { driver: SafeDriverSummary; source: 'regular' | 'existing' | 'new'; makeRegular: boolean };
export type SavedRegistrationReceipt = {
  requestId: string;
  plate: string;
  normalizedPlate: string;
  truckId: string;
  driverId: string;
  assignmentId: string;
};
export type SavedRegistrationOutcome =
  | { status: 'validating'; receipt: SavedRegistrationReceipt }
  | { status: 'ready'; receipt: SavedRegistrationReceipt }
  | { status: 'review_required'; receipt: SavedRegistrationReceipt; reason: 'identity_mismatch' | 'lookup_unavailable' }
  | { status: 'blocked'; receipt: SavedRegistrationReceipt; reason: 'inactive_truck' | 'inactive_driver' | 'open_trip_exists' | 'blocking_exception'; trip?: OpenTripSummary };

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
  | { kind: 'inactive_truck'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { kind: 'inactive_driver'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary }
  | { kind: 'open_trip_exists'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary; trip: OpenTripSummary }
  | { kind: 'blocking_exception'; assignmentId: string; truck: TruckSummary; driver: SafeDriverSummary }
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

export type OpenTripReview = {
  plate: string;
  truck: TruckSummary;
  actualDriver: SafeDriverSummary;
  regularDriverId: string;
  site: AssignedLoadingSite;
  makeRegular: boolean;
  estimatedQuantityTonnes: number;
  capture: PlateCaptureEvidence;
};

export type PlateCaptureEvidence = {
  id: string;
  imagePath: string;
  image: Blob;
  candidate: string;
  confidence: number | null;
  capturedAt: string;
};

export type OpenTripRequest = {
  requestId: string;
  capturedAt: string;
  review: OpenTripReview;
};

export type OpenTripFailureCode =
  | 'INVALID_REQUEST_ID' | 'INVALID_PLATE' | 'DRIVER_REQUIRED' | 'INVALID_DEFAULT_OPTION' | 'INVALID_ESTIMATED_TONNAGE' | 'REQUEST_PAYLOAD_CONFLICT'
  | 'INVALID_CAPTURE_METHOD' | 'INVALID_CAPTURE_TIMESTAMP' | 'INVALID_OCR_DATA'
  | 'SITE_REVIEW_REQUIRED' | 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT'
  | 'INACTIVE_SITE' | 'SITE_ASSIGNMENT_CHANGED' | 'UNKNOWN_TRUCK' | 'INACTIVE_TRUCK'
  | 'OPEN_TRIP_EXISTS' | 'BLOCKING_EXCEPTION' | 'DRIVER_NOT_FOUND' | 'INACTIVE_DRIVER'
  | 'INVALID_IMAGE_REFERENCE' | 'IMAGE_NOT_FOUND' | 'IMAGE_ALREADY_USED';

export type OpenedTrip = {
  id: string;
  tripNumber: string;
  status: 'open';
  truckId: string;
  driverId: string;
  driverNameAtLoading: string;
  dailyRegistrationId: string;
  loadingSiteId: string;
  loadingAssignmentId: string;
  openedAt: string;
  openedBy: string;
  quantityTonnes: null;
  estimatedQuantityTonnes: number;
};

export type OpenTripSuccess = {
  kind: 'success';
  requestId: string;
  trip: OpenedTrip;
  capture: { confirmedPlate: string; normalizedConfirmedPlate: string;
    captureMethod: 'OCR'; imageRecorded: boolean };
  defaultDriverChanged: boolean;
};

export type OpenTripResult = OpenTripSuccess | {
  kind: 'business_failure';
  code: OpenTripFailureCode;
  tripNumber?: string;
};
