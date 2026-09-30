import { supabase } from '../../../lib/supabase';
import type { OpenTripFailureCode, OpenTripRequest, OpenTripResult, OpenTripSuccess } from '../types';
import { platePreview } from '../utils/operationalDate';
import { captureMethod } from '../utils/captureMethod';
import { LoadingAuthorizationError, TripOutcomeUnknownError } from './errors';

const businessCodes: readonly OpenTripFailureCode[] = [
  'INVALID_REQUEST_ID', 'INVALID_PLATE', 'DRIVER_REQUIRED', 'INVALID_DEFAULT_OPTION', 'INVALID_ESTIMATED_TONNAGE', 'REQUEST_PAYLOAD_CONFLICT',
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

// The same frozen request object is reused for an ambiguous RPC retry. A
// confirmed upload must not be repeated or overwritten on that retry.
const uploadedRequests = new WeakSet<OpenTripRequest>();
async function ensureEvidenceUploaded(request: OpenTripRequest): Promise<void> {
  const evidence = request.review.capture;
  if (!evidence || uploadedRequests.has(request)) return;
  if (!supabase || evidence.image.type !== 'image/jpeg' || evidence.image.size < 1
    || evidence.image.size > 5242880) throw new TripOutcomeUnknownError();
  const bucket = supabase.storage.from('loading-plate-evidence');
  try {
    const { error } = await bucket.upload(evidence.imagePath, evidence.image,
      { contentType: 'image/jpeg', upsert: false });
    if (error) {
      if (String(error.statusCode) === '401' || String(error.statusCode) === '403') throw new LoadingAuthorizationError();
      if (String(error.statusCode) !== '409') throw new TripOutcomeUnknownError();
      // A retry may find that its earlier upload actually succeeded. Verify
      // the private object is byte-identical before linking it to the trip.
      const existing = await bucket.download(evidence.imagePath);
      if (existing.error || !existing.data || existing.data.size !== evidence.image.size) throw new TripOutcomeUnknownError();
      const [actual, expected] = await Promise.all([existing.data.arrayBuffer(), evidence.image.arrayBuffer()]);
      const [actualHash, expectedHash] = await Promise.all([
        crypto.subtle.digest('SHA-256', actual), crypto.subtle.digest('SHA-256', expected),
      ]);
      if (!new Uint8Array(actualHash).every((value, index) => value === new Uint8Array(expectedHash)[index])) {
        throw new TripOutcomeUnknownError();
      }
    }
    uploadedRequests.add(request);
  } catch (error) {
    if (error instanceof LoadingAuthorizationError) throw error;
    throw new TripOutcomeUnknownError();
  }
}

export async function openLoadingTrip(request: OpenTripRequest): Promise<OpenTripResult> {
  if (!supabase) throw new TripOutcomeUnknownError();
  const { review } = request;
  if (!review.capture) throw new TripOutcomeUnknownError();
  await ensureEvidenceUploaded(request);
  const method = captureMethod(review);
  const { data, error } = await supabase.rpc('create_loading_trip_v2', {
    p_request_id: request.requestId,
    p_plate: review.plate,
    p_driver_id: review.actualDriver.id,
    p_expected_assignment_id: review.site.assignmentId,
    p_capture_method: method,
    p_captured_at: request.capturedAt,
    p_estimated_quantity_tonnes: review.estimatedQuantityTonnes,
    p_ocr_detected_plate: review.capture.candidate,
    p_ocr_confidence: review.capture.confidence,
    p_image_path: review.capture.imagePath,
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
    || trip.estimated_quantity_tonnes !== review.estimatedQuantityTonnes
    || capture.confirmed_plate !== review.plate
    || capture.normalized_confirmed_plate !== platePreview(review.plate)
    || capture.capture_method !== method || capture.image_recorded !== true
    || typeof row.default_driver_changed !== 'boolean'
    || (row.default_driver_changed && !review.makeRegular)) throw new TripOutcomeUnknownError();
  const result: OpenTripSuccess = { kind: 'success', requestId: row.request_id,
    trip: { id: trip.id, tripNumber: trip.trip_number, status: 'open', truckId: trip.truck_id,
      driverId: trip.driver_id, driverNameAtLoading: trip.driver_name_at_loading,
      dailyRegistrationId: trip.daily_registration_id, loadingSiteId: trip.loading_site_id,
      loadingAssignmentId: trip.loading_assignment_id, openedAt: trip.opened_at,
      openedBy: trip.opened_by, quantityTonnes: null, estimatedQuantityTonnes: trip.estimated_quantity_tonnes },
    capture: { confirmedPlate: capture.confirmed_plate,
      normalizedConfirmedPlate: capture.normalized_confirmed_plate,
      captureMethod: method, imageRecorded: true },
    defaultDriverChanged: row.default_driver_changed };
  return result;
}
