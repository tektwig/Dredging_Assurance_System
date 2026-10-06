import { supabase } from '../../../lib/supabase';
import { platePreview } from '../../loading/utils/operationalDate';
import { OffloadingAuthorizationError } from './offloadingData';
import type { ClosureFailureCode, ClosureRequest, ClosureResult } from '../types';

export class ClosureOutcomeUnknownError extends Error {
  constructor() { super('Trip closure outcome unknown'); }
}

const failureCodes: readonly ClosureFailureCode[] = [
  'INVALID_REQUEST_ID', 'TRIP_REQUIRED', 'INVALID_PLATE', 'INVALID_QUANTITY',
  'INVALID_CAPTURE_METHOD', 'INVALID_CAPTURE_TIMESTAMP', 'INVALID_OCR_DATA',
  'SITE_REVIEW_REQUIRED', 'SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT',
  'INACTIVE_SITE', 'SITE_ASSIGNMENT_CHANGED', 'TRIP_NOT_FOUND', 'TRIP_NOT_OPEN',
  'PLATE_MISMATCH', 'INVALID_IMAGE_REFERENCE', 'IMAGE_NOT_FOUND', 'IMAGE_ALREADY_USED',
];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// The same request object is reused for an ambiguous retry. A confirmed upload
// is not repeated, and a 409 on a retry is accepted only for identical bytes.
const uploaded = new WeakSet<ClosureRequest>();
export async function ensureOffloadingImageUploaded(request: ClosureRequest): Promise<void> {
  const { capture } = request.review;
  if (capture.method === 'MANUAL' && !capture.image) return;
  if (uploaded.has(request)) return;
  if (!supabase || !capture.image || !capture.imagePath || capture.image.type !== 'image/jpeg'
    || capture.image.size < 1 || capture.image.size > 5242880) throw new ClosureOutcomeUnknownError();
  const bucket = supabase.storage.from('offloading-plate-evidence');
  try {
    const { error } = await bucket.upload(capture.imagePath, capture.image,
      { contentType: 'image/jpeg', upsert: false });
    if (error) {
      if (String(error.statusCode) === '401' || String(error.statusCode) === '403') {
        throw new OffloadingAuthorizationError();
      }
      if (String(error.statusCode) !== '409') throw new ClosureOutcomeUnknownError();
      const existing = await bucket.download(capture.imagePath);
      if (existing.error || !existing.data || existing.data.size !== capture.image.size) {
        throw new ClosureOutcomeUnknownError();
      }
      const [actual, expected] = await Promise.all([existing.data.arrayBuffer(), capture.image.arrayBuffer()]);
      const [actualHash, expectedHash] = await Promise.all([
        crypto.subtle.digest('SHA-256', actual), crypto.subtle.digest('SHA-256', expected),
      ]);
      if (!new Uint8Array(actualHash).every((value, index) => value === new Uint8Array(expectedHash)[index])) {
        throw new ClosureOutcomeUnknownError();
      }
    }
    uploaded.add(request);
  } catch (error) {
    if (error instanceof OffloadingAuthorizationError) throw error;
    throw new ClosureOutcomeUnknownError();
  }
}

export function parseCloseTripResponse(value: unknown, request: ClosureRequest): ClosureResult {
  if (!record(value)) throw new ClosureOutcomeUnknownError();
  if (value.ok === false && nonempty(value.code) && failureCodes.includes(value.code as ClosureFailureCode)
    && record(value.details)) {
    return { kind: 'business_failure', code: value.code as ClosureFailureCode,
      tripNumber: value.code === 'TRIP_NOT_OPEN' && nonempty(value.details.trip_number)
        ? value.details.trip_number : undefined };
  }
  const trip = record(value.trip) ? value.trip : null;
  const capture = record(value.capture) ? value.capture : null;
  const waybill = record(value.waybill) ? value.waybill : null;
  const review = request.review;
  if (value.ok !== true || value.request_id !== request.requestId || !trip || !capture || !waybill
    || trip.id !== review.trip.id || !nonempty(trip.trip_number) || trip.status !== 'closed'
    || trip.truck_id !== review.trip.truckId || trip.driver_id !== review.trip.driverId
    || trip.offloading_site_id !== review.assignment.siteId
    || typeof trip.quantity_tonnes !== 'number' || trip.quantity_tonnes !== review.quantityTonnes
    || !nonempty(trip.closed_at) || Number.isNaN(Date.parse(trip.closed_at))
    || !nonempty(trip.closed_by) || capture.confirmed_plate !== review.capture.confirmedPlate
    || capture.normalized_confirmed_plate !== platePreview(review.capture.confirmedPlate)
    || capture.capture_method !== review.capture.method
    || capture.image_recorded !== !!review.capture.imagePath
    || typeof waybill.invoice_number !== 'string'
    || !/^(INV|WB)-[0-9]{4}-[0-9]{6,}$/.test(waybill.invoice_number)
    || typeof value.notification_queued !== 'boolean') throw new ClosureOutcomeUnknownError();
  return { kind: 'success', requestId: value.request_id as string,
    trip: { id: trip.id as string, tripNumber: trip.trip_number as string, status: 'closed',
      truckId: trip.truck_id as string, driverId: trip.driver_id as string,
      offloadingSiteId: trip.offloading_site_id as string, quantityTonnes: trip.quantity_tonnes,
      closedAt: trip.closed_at, closedBy: trip.closed_by },
    capture: { confirmedPlate: capture.confirmed_plate, normalizedConfirmedPlate: capture.normalized_confirmed_plate,
      method: capture.capture_method as 'MANUAL' | 'OCR' | 'OCR_CORRECTED', imageRecorded: capture.image_recorded },
    waybill: { invoiceNumber: waybill.invoice_number },
    notificationQueued: value.notification_queued };
}

export async function closeOffloadingTrip(request: ClosureRequest): Promise<ClosureResult> {
  if (!supabase) throw new ClosureOutcomeUnknownError();
  await ensureOffloadingImageUploaded(request);
  const { review } = request;
  const { capture } = review;
  const { data, error } = await supabase.rpc('close_trip_v2', {
    p_request_id: request.requestId,
    p_trip_id: review.trip.id,
    p_plate: capture.confirmedPlate,
    p_expected_assignment_id: review.assignment.assignmentId,
    p_quantity_tonnes: review.quantityTonnes,
    p_capture_method: capture.method,
    p_captured_at: capture.capturedAt,
    p_ocr_detected_plate: capture.ocrDetectedPlate,
    p_ocr_confidence: capture.ocrConfidence,
    p_image_path: capture.imagePath,
  });
  if (error?.code === '42501') throw new OffloadingAuthorizationError();
  if (error) throw new ClosureOutcomeUnknownError();
  return parseCloseTripResponse(data, request);
}
