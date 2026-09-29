import type { RegistrationRequest, RegistrationSafeResponse, SavedRegistrationOutcome, SavedRegistrationReceipt, TruckLookupResult } from '../types';
import { platePreview } from './operationalDate';

export type ValidatedRegistrationRefresh = {
  outcome: SavedRegistrationOutcome;
  publishableTruck: Extract<TruckLookupResult, { kind: 'known_ready' | 'inactive_driver' }> | null;
};

export function registrationResponseMatchesMode(request: RegistrationRequest, response: RegistrationSafeResponse): boolean {
  if (response.requestId !== request.requestId) return false;
  const newDriverMatches = request.newDriver !== null
    && response.driver.fullName === request.newDriver.fullName.trim()
    && response.driver.phoneNumber === request.newDriver.phoneNumber.trim()
    && response.driver.email === (request.newDriver.email.trim() || null);
  if (request.expectedTruckId === null) {
    if (!response.truck.created) return false;
    if (request.existingDriverId !== null) return !response.driver.created
      && response.driver.id === request.existingDriverId && !response.paymentDetailsCaptured;
    return newDriverMatches && response.driver.created && response.paymentDetailsCaptured;
  }
  return request.existingDriverId === null && !response.truck.created
    && response.truck.id === request.expectedTruckId
    && newDriverMatches && response.driver.created && response.paymentDetailsCaptured;
}

export function registrationReceipt(
  plate: string, assignmentId: string, response: RegistrationSafeResponse,
): SavedRegistrationReceipt {
  return {
    requestId: response.requestId, plate, normalizedPlate: response.truck.normalizedRegistration,
    truckId: response.truck.id, driverId: response.driver.id, assignmentId,
  };
}

// Evaluate the independent post-registration RPC result before any ordinary
// lookup/driver state is published. This receipt contains no payment fields.
export function validateRegistrationRefresh(
  receipt: SavedRegistrationReceipt,
  response: RegistrationSafeResponse,
  lookup: TruckLookupResult,
): ValidatedRegistrationRefresh {
  const review = (): ValidatedRegistrationRefresh => ({
    outcome: { status: 'review_required', receipt, reason: 'identity_mismatch' }, publishableTruck: null,
  });
  if (lookup.kind === 'business_failure' || lookup.kind === 'unknown_truck') return review();
  if (lookup.assignmentId !== receipt.assignmentId || !response.truck.created
    || lookup.truck.id !== receipt.truckId
    || lookup.truck.normalizedRegistration !== receipt.normalizedPlate
    || platePreview(receipt.plate) !== receipt.normalizedPlate
    || platePreview(response.truck.registrationNumber) !== receipt.normalizedPlate
    || platePreview(lookup.truck.registrationNumber) !== receipt.normalizedPlate
    || lookup.driver.id !== receipt.driverId) return review();

  if (lookup.kind === 'inactive_truck' || !lookup.truck.isActive) {
    return { outcome: { status: 'blocked', receipt, reason: 'inactive_truck' }, publishableTruck: null };
  }
  if (lookup.kind === 'open_trip_exists') {
    return { outcome: { status: 'blocked', receipt, reason: 'open_trip_exists', trip: lookup.trip }, publishableTruck: null };
  }
  if (lookup.kind === 'blocking_exception') {
    return { outcome: { status: 'blocked', receipt, reason: 'blocking_exception' }, publishableTruck: null };
  }
  if (lookup.kind === 'inactive_driver' || !lookup.driver.isActive) {
    return { outcome: { status: 'blocked', receipt, reason: 'inactive_driver' },
      publishableTruck: lookup.kind === 'inactive_driver' ? lookup : null };
  }
  return { outcome: { status: 'ready', receipt }, publishableTruck: lookup };
}
