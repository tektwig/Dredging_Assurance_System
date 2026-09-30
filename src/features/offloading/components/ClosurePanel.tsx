import { parseTonnage } from '../utils/tonnage';
import type { OffloadingLookupState } from '../types';
import type { ClosureState } from '../utils/closureController';

type Props = { lookup: Extract<OffloadingLookupState, { status: 'found' }> | null;
  state: ClosureState; quantity: string; onQuantity: (value: string) => void;
  onReview: () => void; onBack: () => void; onClose: () => void };

function failureMessage(code: Extract<ClosureState, { status: 'business_failure' }>['code'], tripNumber?: string) {
  if (code === 'TRIP_NOT_OPEN') return `This trip${tripNumber ? ` (${tripNumber})` : ''} is no longer OPEN. Contact Operations.`;
  if (code === 'TRIP_NOT_FOUND') return 'This trip could not be found. Look up the plate again or contact Operations.';
  if (code === 'PLATE_MISMATCH' || code === 'INVALID_PLATE') return 'The confirmed plate does not match this trip. Look up the plate again.';
  if (code === 'INVALID_QUANTITY') return 'The tonnage was rejected. Review the quantity before another attempt.';
  if (code === 'INVALID_CAPTURE_METHOD' || code === 'INVALID_CAPTURE_TIMESTAMP' || code === 'INVALID_OCR_DATA') {
    return 'The plate capture could not be accepted. Start a new scan and try again.';
  }
  if (code === 'INVALID_IMAGE_REFERENCE' || code === 'IMAGE_NOT_FOUND' || code === 'IMAGE_ALREADY_USED') {
    return 'The plate image could not be accepted. Start a new capture or contact Operations.';
  }
  return 'The trip could not be closed. Recheck the trip with Operations before trying again.';
}

export function ClosurePanel({ lookup, state, quantity, onQuantity, onReview, onBack, onClose }: Props) {
  if (state.status === 'success') return <div className="loading-trip-success" role="status">
    <p className="eyebrow">Trip closed</p><h3>{state.result.trip.tripNumber}</h3>
    <dl className="loading-details">
      <div><dt>Waybill</dt><dd>{state.result.waybill.invoiceNumber}</dd></div>
      <div><dt>Confirmed plate</dt><dd>{state.result.capture.confirmedPlate}</dd></div>
      <div><dt>Tonnage</dt><dd>{state.result.trip.quantityTonnes.toFixed(2)} tonnes</dd></div>
      <div><dt>Status</dt><dd>Closed</dd></div>
      <div><dt>Closed at</dt><dd>{new Date(state.result.trip.closedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</dd></div>
    </dl>
    <p className="loading-next-note">{state.result.notificationQueued
      ? 'Notification queued successfully.'
      : 'Notification was not queued. Trip closure succeeded; contact Operations if follow-up is needed.'}</p>
  </div>;
  if (state.status === 'site_changed') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Offloading site changed</h3><p>Your assignment changed or is unavailable. Start again and find the trip with current access.</p>
  </div>;
  if (state.status === 'authorization') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Offloading access unavailable</h3><p>Your account is no longer authorized. Sign in again or contact an administrator.</p>
  </div>;
  if (state.status === 'business_failure') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Trip not closed</h3><p>{failureMessage(state.code, state.tripNumber)}</p>
    <p>No frontend override is available. Start a new lookup after resolving the issue.</p>
  </div>;
  if (state.status === 'submitting') return <div className="loading-trip-review" role="status">
    <h3>Closing trip…</h3><p>Keep this page open while the result is checked.</p>
  </div>;
  if (state.status === 'ambiguous') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Closure result unknown</h3>
    <p>The request may have closed the trip. Do not start another closure. Retry the same request to confirm its result.</p>
    <button className="button" type="button" onClick={onClose}>Retry Same Request</button>
  </div>;
  if (state.status === 'review') return <div className="loading-trip-review">
    <p className="eyebrow">Review offloading</p><h3>Review Trip</h3>
    <dl className="loading-details">
      <div><dt>Confirmed truck plate</dt><dd>{state.review.capture.confirmedPlate}</dd></div>
      <div><dt>Trip number</dt><dd>{state.review.trip.tripNumber}</dd></div>
      <div><dt>Actual driver</dt><dd>{state.review.trip.driverName}</dd></div>
      <div><dt>Loading site</dt><dd>{state.review.trip.loadingSiteName}</dd></div>
      <div><dt>Opened</dt><dd>{new Date(state.review.trip.openedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</dd></div>
      <div><dt>Assigned Offloading site</dt><dd>{state.review.assignment.siteName}</dd></div>
      {state.review.trip.estimatedQuantityTonnes !== null && <>
        <div><dt>Estimated Tonnage</dt><dd>{state.review.trip.estimatedQuantityTonnes.toFixed(2)} tonnes</dd></div>
        <div><dt>Actual Tonnage</dt><dd>{state.review.quantityTonnes.toFixed(2)} tonnes</dd></div>
        <div><dt>Variance</dt><dd>{(state.review.quantityTonnes - state.review.trip.estimatedQuantityTonnes).toFixed(2)} tonnes</dd></div>
      </>}
      {state.review.trip.estimatedQuantityTonnes === null && <div><dt>Actual Tonnage</dt><dd>{state.review.quantityTonnes.toFixed(2)} tonnes</dd></div>}
    </dl>
    <div className="offloading-review-actions">
      <button className="button" type="button" onClick={onClose}>Confirm &amp; Close Trip</button>
      <button className="button secondary" type="button" onClick={onBack}>Edit tonnage</button>
    </div>
  </div>;
  if (!lookup) return null;
  const valid = parseTonnage(quantity);
  return <div className="offloading-tonnage">
    <h3>Enter Tonnage</h3>
    <label htmlFor="offloading-tonnage">Quantity (tonnes)</label>
    <input id="offloading-tonnage" type="text" inputMode="decimal" autoComplete="off"
      value={quantity} onChange={event => onQuantity(event.target.value)} placeholder="e.g. 12.50" />
    {quantity && valid === null && <p role="alert">Enter a quantity greater than 0, below 100000000, with no more than two decimal places.</p>}
    <button className="button" type="button" disabled={valid === null} onClick={onReview}>Review Trip</button>
  </div>;
}
