import type { OpenTripState } from '../utils/openTripController';
import { captureMethod } from '../utils/captureMethod';

const failureMessages: Record<string, string> = {
  INVALID_REQUEST_ID: 'Start a new review and try again.',
  INVALID_PLATE: 'Check the plate and look up the truck again.',
  DRIVER_REQUIRED: 'Select an actual driver before reviewing the trip.',
  INVALID_DEFAULT_OPTION: 'Review the regular-driver choice again.',
  INVALID_CAPTURE_METHOD: 'The plate capture could not be accepted. Review the truck again.',
  INVALID_CAPTURE_TIMESTAMP: 'The capture time could not be accepted. Review the truck again.',
  INVALID_OCR_DATA: 'The plate evidence could not be accepted. Review the truck again.',
  UNKNOWN_TRUCK: 'This truck is no longer registered. Look it up again.',
  INACTIVE_TRUCK: 'This truck is inactive. Contact Operations.',
  OPEN_TRIP_EXISTS: 'This truck already has an open trip. Loading cannot open another.',
  BLOCKING_EXCEPTION: 'This truck has a blocking issue. Contact Operations.',
  DRIVER_NOT_FOUND: 'The selected driver is no longer available. Search again.',
  INACTIVE_DRIVER: 'The selected driver is inactive. Choose another driver.',
  INVALID_IMAGE_REFERENCE: 'The plate evidence could not be accepted. Review the truck again.',
  IMAGE_NOT_FOUND: 'The plate evidence could not be found. Review the truck again.',
  IMAGE_ALREADY_USED: 'The plate evidence has already been used. Review the truck again.',
};

type Props = {
  state: OpenTripState;
  canReview: boolean;
  operationalDate: string;
  onReview: () => void;
  onBack: () => void;
  onOpen: () => void;
  onNext: () => void;
};

export function TripReview({ state, canReview, operationalDate, onReview, onBack, onOpen, onNext }: Props) {
  if (state.status === 'idle') return canReview
    ? <div className="loading-trip-action"><button className="button" type="button" onClick={onReview}>Review Trip</button>
      <p>No trip has been opened yet.</p></div> : null;
  if (state.status === 'site_changed') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Loading site changed</h3><p>Your assignment is being refreshed. Review the truck and driver again before opening a trip.</p>
  </div>;
  if (state.status === 'authorization') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Loading access unavailable</h3><p>Your account or site access must be checked again. Contact an administrator if this continues.</p>
  </div>;
  if (state.status === 'success') {
    const { trip, defaultDriverChanged, capture } = state.result;
    return <div className="loading-trip-success" role="status">
      <h3>Trip opened</h3><p>Trip <strong>{trip.tripNumber}</strong> is open for <strong>{capture.confirmedPlate}</strong>.</p>
      <dl className="loading-details"><div><dt>Actual driver</dt><dd>{trip.driverNameAtLoading}</dd></div>
        <div><dt>Estimated tonnage</dt><dd>{trip.estimatedQuantityTonnes.toFixed(2)} tonnes</dd></div>
        <div><dt>Opened at</dt><dd>{new Date(trip.openedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</dd></div></dl>
      {state.review.makeRegular && <p>{defaultDriverChanged
        ? 'This driver is now the truck’s regular driver.'
        : 'The regular driver was not changed.'}</p>}
      <button className="button" type="button" onClick={onNext}>Process Next Truck</button>
    </div>;
  }
  const { review } = state;
  return <section className="loading-trip-review" aria-label="Review trip">
    <h3>Review Trip</h3><p>Confirm the loading estimate and trip details before opening.</p>
    <dl className="loading-details">
      <div><dt>Confirmed plate</dt><dd>{review.plate}</dd></div>
      <div><dt>Truck</dt><dd>{review.truck.registrationNumber}</dd></div>
      <div><dt>Actual driver</dt><dd>{review.actualDriver.fullName}<span>{review.actualDriver.phoneNumber}</span></dd></div>
      <div><dt>Assigned loading site</dt><dd>{review.site.siteName}</dd></div>
      <div><dt>Estimated tonnage</dt><dd>{review.estimatedQuantityTonnes.toFixed(2)} tonnes</dd></div>
      <div><dt>Operational date · Africa/Lagos</dt><dd>{operationalDate}</dd></div>
      <div><dt>Plate capture</dt><dd>{captureMethod(review)} scan confirmed</dd></div>
      {review.actualDriver.id !== review.regularDriverId && <div><dt>Regular driver</dt>
        <dd>{review.makeRegular ? 'Set selected driver as regular when the trip opens' : 'Leave unchanged'}</dd></div>}
    </dl>
    {state.status === 'business_failure' && <div role="alert" className="loading-trip-message">
      <p>{failureMessages[state.code] ?? 'The trip could not be opened. Review the truck and driver again.'}</p>
      {state.code === 'OPEN_TRIP_EXISTS' && state.tripNumber && <p>Open trip: <strong>{state.tripNumber}</strong></p>}
    </div>}
    {state.status === 'ambiguous' && <div role="alert" className="loading-trip-message">
      <p>The connection ended before the opening could be confirmed. The trip may have opened. Retry the same request to check its outcome.</p>
    </div>}
    <div className="loading-trip-buttons">
      {state.status === 'review' && <button className="button" type="button" onClick={onOpen}>Open Trip</button>}
      {state.status === 'submitting' && <button className="button" type="button" disabled>Opening trip…</button>}
      {state.status === 'ambiguous' && <button className="button" type="button" onClick={onOpen}>Retry Same Request</button>}
      {state.status !== 'submitting' && state.status !== 'ambiguous'
        && <button className="button secondary" type="button" onClick={onBack}>Back to driver</button>}
    </div>
  </section>;
}
