import type { ReactNode } from 'react';
import { operationalDateLabel, platePreview } from '../../loading/utils/operationalDate';
import type { OffloadingLookupSnapshot } from '../utils/offloadingLookupController';
import type { ClosureState } from '../utils/closureController';

type Props = { officerName: string; plate: string; lookup: OffloadingLookupSnapshot;
  closure: ClosureState; closurePanel: ReactNode; capturePanel: ReactNode;
  onPlateChange: (plate: string) => void; onLookup: () => void; onReset: () => void };

export function OffloadingPortalView({ officerName, plate, lookup, capturePanel,
  closure, closurePanel, onPlateChange, onLookup, onReset }: Props) {
  const state = lookup.state;
  const locked = closure.status !== 'idle';
  const showCapture = closure.status === 'idle';
  const showLookup = closure.status === 'idle';
  return <div className="loading-portal offloading-portal">
    <header className="loading-heading">
      <div><p className="eyebrow">Truck Revenue Tracking System</p><h1>Offloading Portal</h1>
        <p className="muted">{officerName}</p>
        <p className="loading-site-summary"><span>Assigned Offloading Site</span>
          <strong>{state.status === 'found' ? state.assignment.siteName : 'Will be verified when you find a trip'}</strong></p>
      </div>
      <div className="loading-date"><span>Operational date · Africa/Lagos</span>
        <strong>{operationalDateLabel()}</strong></div>
    </header>
    <section className="loading-work-card" aria-label="Find open trip">
      <div className="loading-section-heading"><h2>Find Open Trip</h2>
        <p>Scan or enter the vehicle plate. Confirm it before finding the trip.</p></div>
      {showCapture && capturePanel}
      {showLookup && <>
      <form className="loading-plate-form" onSubmit={event => { event.preventDefault(); onLookup(); }}
        aria-busy={lookup.pending}>
        <label htmlFor="offloading-plate">Vehicle Plate Number</label>
        <div className="loading-entry-row">
          <input id="offloading-plate" name="plate" type="text" autoComplete="off"
            autoCapitalize="characters" spellCheck={false} maxLength={64}
            value={plate} onChange={event => onPlateChange(event.target.value)}
            placeholder="e.g. ABC-123" />
          <button type="submit" className="button" disabled={lookup.pending || !plate.trim()}>
            {lookup.pending ? 'Finding trip…' : 'Find Open Trip'}
          </button>
        </div>
        {plate.trim() && <p className="loading-plate-preview">Confirmed plate: <strong>{plate.trim()}</strong>
          <span>Normalized preview: <strong>{platePreview(plate)}</strong></span></p>}
      </form>
      </>}
      {state.status === 'looking_up' && <div className="loading-result" role="status">
        <h3>Finding open trip…</h3><p>Checking the confirmed plate.</p></div>}
      {state.status === 'invalid_plate' && <div className="loading-result loading-result-warning" role="alert">
        <h3>Check the plate number</h3><p>Correct the plate and try again.</p></div>}
      {state.status === 'no_open_trip' && <div className="loading-result loading-result-warning" role="alert">
        <h3>No open trip</h3><p>No OPEN trip was found for {state.plate}. Contact Operations before offloading.</p>
      </div>}
      {state.status === 'site_unavailable' && <div className="loading-result loading-result-warning" role="alert">
        <h3>Offloading site unavailable</h3><p>Your current offloading assignment is missing or unavailable. Contact an administrator.</p>
      </div>}
      {state.status === 'access_unavailable' && <div className="loading-result loading-result-warning" role="alert">
        <h3>Offloading access unavailable</h3><p>Your account cannot use this lookup. Sign in again or contact an administrator.</p>
      </div>}
      {state.status === 'lookup_error' && <div className="loading-result loading-result-warning" role="alert">
        <h3>Trip lookup unavailable</h3><p>Check your connection and retry. No trip has been changed.</p>
        <button className="button secondary" type="button" onClick={onLookup}>Retry lookup</button>
      </div>}
      {state.status === 'found' && !locked && <div className="loading-result loading-result-ready" role="status">
        <p className="eyebrow">Open trip found</p><h3>{state.trip.tripNumber}</h3>
        <dl className="loading-details">
          <div><dt>Confirmed plate</dt><dd>{state.capture.confirmedPlate}</dd></div>
          <div><dt>Truck plate</dt><dd>{state.trip.registrationNumber}</dd></div>
          <div><dt>Driver</dt><dd>{state.trip.driverName}</dd></div>
          <div><dt>Loading site</dt><dd>{state.trip.loadingSiteName}</dd></div>
          <div><dt>Opened</dt><dd>{new Date(state.trip.openedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</dd></div>
          <div><dt>Offloading site</dt><dd>{state.assignment.siteName}</dd></div>
        </dl>
      </div>}
      {closurePanel}
      {(state.status !== 'idle' || closure.status !== 'idle')
        && closure.status !== 'submitting' && closure.status !== 'ambiguous'
        && <button className="button secondary offloading-next" type="button"
        onClick={onReset}>Scan Next Truck</button>}
    </section>
  </div>;
}
