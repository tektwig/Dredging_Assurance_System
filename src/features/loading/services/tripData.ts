import { supabase } from '../../../lib/supabase';
import type { OpenTripFailureCode, OpenTripRequest, OpenTripResult, OpenTripSuccess } from '../types';
import { platePreview } from '../utils/operationalDate';
import { LoadingAuthorizationError, TripOutcomeUnknownError } from './errors';

const businessCodes: readonly OpenTripFailureCode[] = [
  'INVALID_REQUEST_ID', 'INVALID_PLATE', 'DRIVER_REQUIRED', 'INVALID_DEFAULT_OPTION',
  'INVALID_CAPTURE_METHOD', 'INVALID_CAPTURE_TIMESTAMP', 'INVALID_OCR_DATA',
  'SITE_REVIEW_REQUIRED', 'SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT',
  'INACTIVE_SITE', 'SITE_ASSIGNMENT_CHANGED', 'UNKNOWN_TRUCK', 'INACTIVE_TRUCK',
  'OPEN_TRIP_EXISTS', 'BLOCKING_EXCEPTION', 'DRIVER_NOT_FOUND', 'INACTIVE_DRIVER',
  'INVALID_IMAGE_REFERENCE', 'IMAGE_NOT_FOUND', 'IMAGE_ALREADY_USED',
];

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

export async function openLoadingTrip(request: OpenTripRequest): Promise<OpenTripResult> {
  if (!supabase) throw new TripOutcomeUnknownError();
  const { review } = request;
  const { data, error } = await supabase.rpc('create_loading_trip_v2', {
    p_request_id: request.requestId,
    p_plate: review.plate,
    p_driver_id: review.actualDriver.id,
    p_expected_assignment_id: review.site.assignmentId,
    p_capture_method: 'MANUAL',
    p_captured_at: request.capturedAt,
    p_ocr_detected_plate: null,
    p_ocr_confidence: null,
    p_image_path: null,
    p_make_default_driver: review.makeRegular,
  });
  if (error?.code === '42501') throw new LoadingAuthorizationError();
  if (error) throw new TripOutcomeUnknownError();
  const row = object(data);
  if (row?.ok === false && string(row.code) && businessCodes.includes(row.code as OpenTripFailureCode)) {
    const details = object(row.details);
    if (!details) throw new TripOutcomeUnknownError();
    return { kind: 'business_failure', code: row.code as OpenTripFailureCode,
      tripNumber: row.code === 'OPEN_TRIP_EXISTS' && string(details.trip_number) ? details.trip_number : undefined };
  }
  const trip = object(row?.trip);
  const capture = object(row?.capture);
  if (row?.ok !== true || row.request_id !== request.requestId || !trip || !capture
    || !string(trip.id) || !string(trip.trip_number) || trip.status !== 'open'
    || trip.truck_id !== review.truck.id || trip.driver_id !== review.actualDriver.id
    || !string(trip.driver_name_at_loading) || !string(trip.daily_registration_id)
    || trip.loading_site_id !== review.site.siteId
    || trip.loading_assignment_id !== review.site.assignmentId
    || !string(trip.opened_at) || !string(trip.opened_by) || trip.quantity_tonnes !== null
    || capture.confirmed_plate !== review.plate
    || capture.normalized_confirmed_plate !== platePreview(review.plate)
    || capture.capture_method !== 'MANUAL' || capture.image_recorded !== false
    || typeof row.default_driver_changed !== 'boolean'
    || (row.default_driver_changed && !review.makeRegular)) throw new TripOutcomeUnknownError();
  const result: OpenTripSuccess = { kind: 'success', requestId: row.request_id,
    trip: { id: trip.id, tripNumber: trip.trip_number, status: 'open', truckId: trip.truck_id,
      driverId: trip.driver_id, driverNameAtLoading: trip.driver_name_at_loading,
      dailyRegistrationId: trip.daily_registration_id, loadingSiteId: trip.loading_site_id,
      loadingAssignmentId: trip.loading_assignment_id, openedAt: trip.opened_at,
      openedBy: trip.opened_by, quantityTonnes: null },
    capture: { confirmedPlate: capture.confirmed_plate,
      normalizedConfirmedPlate: capture.normalized_confirmed_plate,
      captureMethod: 'MANUAL', imageRecorded: false },
    defaultDriverChanged: row.default_driver_changed };
  return result;
}
