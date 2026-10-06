import type { PlateCaptureEvidence } from '../loading/types';

export type OffloadingAssignment = { assignmentId: string; siteId: string; siteName: string };
export type OffloadingStatistics = {
  tripsClosedToday: number;
  openTrips: number;
  tonnageProcessedToday: number;
  trucksProcessedToday: number;
};
export type OffloadingStatisticsState =
  | { status: 'loading' }
  | { status: 'ready'; statistics: OffloadingStatistics }
  | { status: 'error' };

export type OffloadingOpenTripListItem = {
  id: string;
  tripNumber: string;
  truckId: string;
  registrationNumber: string;
  normalizedRegistration: string;
  openedAt: string;
  loadingSiteName: string;
};

export type OffloadingOpenTrips = {
  assignment: OffloadingAssignment;
  trips: OffloadingOpenTripListItem[];
};

export type OffloadingOpenTripsResult =
  | { kind: 'ready'; value: OffloadingOpenTrips }
  | { kind: 'business_failure'; code: 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT' | 'INACTIVE_SITE' };

export type OffloadingOpenTripsState =
  | { status: 'loading' }
  | { status: 'ready'; value: OffloadingOpenTrips }
  | { status: 'site_unavailable' }
  | { status: 'access_unavailable' }
  | { status: 'error' };

export type OffloadingVerificationState =
  | { status: 'idle' }
  | { status: 'verifying'; tripId: string; candidate: string }
  | { status: 'verified'; tripId: string; assignment: OffloadingAssignment;
      trip: OpenTripSummary; capture: PreparedOffloadingCapture }
  | { status: 'mismatch'; tripId: string; candidate: string }
  | { status: 'error'; tripId: string }
  | { status: 'site_unavailable' }
  | { status: 'access_unavailable' };

export function normalizeOffloadingPlate(value: string) {
  // Mirrors public.normalize_plate: uppercase, then remove whitespace and hyphens.
  return value.toUpperCase().replace(/[ \t\n\v\f\r-]+/g, '');
}

export type OpenTripSummary = {
  id: string; tripNumber: string; truckId: string; registrationNumber: string;
  normalizedRegistration: string; driverId: string; driverName: string;
  openedAt: string; loadingSiteName: string;
  estimatedQuantityTonnes: number | null;
};
export type OffloadingLookupResult =
  | { kind: 'found'; assignment: OffloadingAssignment; trip: OpenTripSummary }
  | { kind: 'business_failure'; code: 'INVALID_PLATE' | 'NO_OPEN_TRIP' | 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT' | 'INACTIVE_SITE' };

export type PreparedOffloadingCapture = {
  method: 'MANUAL' | 'OCR' | 'OCR_CORRECTED';
  confirmedPlate: string;
  capturedAt: string;
  ocrDetectedPlate: string | null;
  ocrConfidence: number | null;
  image: Blob | null;
  imagePath: string | null;
};

export type OffloadingLookupState = {
  status: 'found'; assignment: OffloadingAssignment; trip: OpenTripSummary; capture: PreparedOffloadingCapture;
};

export type ClosureReview = {
  assignment: OffloadingAssignment; trip: OpenTripSummary;
  capture: PreparedOffloadingCapture; quantityTonnes: number;
};
export type ClosureRequest = { requestId: string; review: ClosureReview };
export type ClosureFailureCode =
  | 'INVALID_REQUEST_ID' | 'TRIP_REQUIRED' | 'INVALID_PLATE' | 'INVALID_QUANTITY'
  | 'INVALID_CAPTURE_METHOD' | 'INVALID_CAPTURE_TIMESTAMP' | 'INVALID_OCR_DATA'
  | 'SITE_REVIEW_REQUIRED' | 'SITE_ASSIGNMENT_REQUIRED' | 'INVALID_SITE_ASSIGNMENT'
  | 'INACTIVE_SITE' | 'SITE_ASSIGNMENT_CHANGED' | 'TRIP_NOT_FOUND'
  | 'TRIP_NOT_OPEN' | 'PLATE_MISMATCH' | 'INVALID_IMAGE_REFERENCE'
  | 'IMAGE_NOT_FOUND' | 'IMAGE_ALREADY_USED';
export type ClosureSuccess = {
  kind: 'success'; requestId: string;
  trip: { id: string; tripNumber: string; status: 'closed'; truckId: string;
    driverId: string; offloadingSiteId: string; quantityTonnes: number;
    closedAt: string; closedBy: string };
  capture: { confirmedPlate: string; normalizedConfirmedPlate: string;
    method: 'MANUAL' | 'OCR' | 'OCR_CORRECTED'; imageRecorded: boolean };
  waybill: { invoiceNumber: string };
  notificationQueued: boolean;
};
export type ClosureResult = ClosureSuccess | { kind: 'business_failure'; code: ClosureFailureCode; tripNumber?: string };

export function preparedCapture(plate: string, evidence: PlateCaptureEvidence | null,
  capturedAt: string): PreparedOffloadingCapture {
  return {
    method: evidence ? normalizeOffloadingPlate(plate) === normalizeOffloadingPlate(evidence.candidate)
      ? 'OCR' : 'OCR_CORRECTED' : 'MANUAL',
    confirmedPlate: plate,
    capturedAt: evidence?.capturedAt ?? capturedAt,
    ocrDetectedPlate: evidence?.candidate ?? null,
    ocrConfidence: evidence?.confidence ?? null,
    image: evidence?.image ?? null,
    imagePath: evidence?.imagePath ?? null,
  };
}
