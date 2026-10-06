import type { ReactNode } from 'react';
import { operationalDateLabel } from '../../loading/utils/operationalDate';
import type { ClosureState } from '../utils/closureController';
import type { OffloadingOpenTripsState, OffloadingOpenTripListItem,
  OffloadingStatisticsState, OffloadingVerificationState } from '../types';

type Props = {
  officerName: string;
  openTrips: OffloadingOpenTripsState;
  selectedTrip: OffloadingOpenTripListItem | null;
  verification: OffloadingVerificationState;
  closure: ClosureState;
  capturePanel: ReactNode;
  closurePanel: ReactNode;
  statistics: OffloadingStatisticsState;
  now: Date;
  onSelectTrip: (trip: OffloadingOpenTripListItem) => void;
  onRetryOpenTrips: () => void;
  onRetryStatistics: () => void;
  onRescan: () => void;
  onReturnToOpenTrips: () => void;
};

export function OffloadingStatistics({ state, retry }: { state: OffloadingStatisticsState; retry: () => void }) {
  if (state.status === 'loading') return <p className="loading-note" role="status">Loading today's figures…</p>;
  if (state.status === 'error') return <div className="loading-note" role="status">
    <p>Today's figures are unavailable. Open Trips remains available. Try again shortly.</p>
    <button className="button secondary" type="button" onClick={retry}>Retry figures</button>
  </div>;
  const cards = [
    ['Trips Closed Today', state.statistics.tripsClosedToday.toLocaleString('en-NG')],
    ['Open Trips', state.statistics.openTrips.toLocaleString('en-NG')],
    ['Tonnage Processed Today', state.statistics.tonnageProcessedToday.toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })],
    ['Trucks Processed Today', state.statistics.trucksProcessedToday.toLocaleString('en-NG')],
  ] as const;
  return <div className="loading-stat-grid" aria-label="Offloading statistics">
    {cards.map(([label, value]) => <div className="loading-stat" key={label}>
      <span>{label}</span><strong>{value}</strong>
    </div>)}
  </div>;
}

function openedLabel(value: string) {
  return new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
}

function OpenTripsList({ state, onSelect, onRetry }: {
  state: OffloadingOpenTripsState;
  onSelect: (trip: OffloadingOpenTripListItem) => void;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return <p className="loading-note" role="status">Loading Open Trips…</p>;
  if (state.status === 'site_unavailable') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Offloading site unavailable</h3>
    <p>Your current Offloading Site assignment is missing or unavailable. Contact an administrator.</p>
  </div>;
  if (state.status === 'access_unavailable') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Offloading access unavailable</h3>
    <p>Your account cannot read Open Trips. Sign in again or contact an administrator.</p>
  </div>;
  if (state.status === 'error') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Open Trips unavailable</h3><p>No trip has been changed. Check your connection and retry.</p>
    <button className="button secondary" type="button" onClick={onRetry}>Retry Open Trips</button>
  </div>;
  if (state.value.trips.length === 0) return <p className="loading-note" role="status">There are no OPEN trips available.</p>;
  return <ol className="offloading-open-trips" aria-label="Currently open trips">
    {state.value.trips.map(trip => <li key={trip.id}>
      <div className="offloading-open-trip-details">
        <strong className="offloading-open-trip-plate">{trip.registrationNumber}</strong>
        <dl>
          <div><dt>Trip Number</dt><dd>{trip.tripNumber}</dd></div>
          <div><dt>Loading Site</dt><dd>{trip.loadingSiteName}</dd></div>
          <div><dt>Opened</dt><dd>{openedLabel(trip.openedAt)}</dd></div>
        </dl>
      </div>
      <button className="button" type="button" onClick={() => onSelect(trip)}
        aria-label={`Select trip ${trip.tripNumber}, truck ${trip.registrationNumber}`}>
        Select Trip
      </button>
    </li>)}
  </ol>;
}

export function OffloadingPortalView({ officerName, openTrips, selectedTrip, verification,
  capturePanel, closure, closurePanel, statistics, now, onSelectTrip, onRetryOpenTrips,
  onRetryStatistics, onRescan, onReturnToOpenTrips }: Props) {
  const assignment = openTrips.status === 'ready' ? openTrips.value.assignment : null;
  const canReturn = selectedTrip !== null && closure.status !== 'submitting' && closure.status !== 'ambiguous';
  const showCapture = selectedTrip !== null && verification.status !== 'verified'
    && verification.status !== 'site_unavailable' && verification.status !== 'access_unavailable'
    && closure.status === 'idle';
  return <div className="loading-portal offloading-portal">
    <header className="loading-heading">
      <div><p className="eyebrow">Truck Revenue Tracking System</p><h1>Offloading Portal</h1>
        <p className="muted">{officerName}</p>
        <p className="loading-site-summary"><span>Assigned Offloading Site</span>
          <strong>{assignment?.siteName ?? 'Checking current assignment'}</strong></p>
      </div>
      <div className="loading-date"><span>Operational date · Africa/Lagos</span>
        <strong>{operationalDateLabel(now)}</strong></div>
    </header>
    <section className="loading-work-card" aria-label="Offloading work">
      {!selectedTrip && <>
        {closurePanel}
        <div className="loading-section-heading"><h2>Open Trips</h2>
          <p>Select the trip that matches the truck you are receiving. Selection does not begin trip processing.</p></div>
        <OpenTripsList state={openTrips} onSelect={onSelectTrip} onRetry={onRetryOpenTrips} />
      </>}
      {selectedTrip && <>
        <div className="loading-result loading-result-ready" aria-label="Selected trip">
          <p className="eyebrow">Selected trip — scan required</p>
          <h2>{selectedTrip.tripNumber}</h2>
          <dl className="loading-details">
            <div><dt>Expected Truck Plate</dt><dd>{selectedTrip.registrationNumber}</dd></div>
            <div><dt>Loading Site</dt><dd>{selectedTrip.loadingSiteName}</dd></div>
            <div><dt>Opened</dt><dd>{openedLabel(selectedTrip.openedAt)}</dd></div>
          </dl>
        </div>
        {verification.status === 'verifying' && <p className="loading-note" role="status">
          Checking the scanned plate against the selected open trip…
        </p>}
        {verification.status === 'mismatch' && <div className="loading-result loading-result-warning" role="alert">
          <h3>Scanned truck does not match the selected trip</h3>
          <p>Scanned plate {verification.candidate} does not match {selectedTrip.registrationNumber} for {selectedTrip.tripNumber}.</p>
          <div className="offloading-review-actions">
            <button className="button" type="button" onClick={onRescan}>Rescan</button>
            <button className="button secondary" type="button" onClick={onReturnToOpenTrips}>Return to Open Trips</button>
          </div>
        </div>}
        {verification.status === 'error' && <div className="loading-result loading-result-warning" role="alert">
          <h3>Plate verification unavailable</h3><p>Retry the camera scan. Tonnage entry remains locked.</p>
          <div className="offloading-review-actions">
            <button className="button" type="button" onClick={onRescan}>Rescan</button>
            <button className="button secondary" type="button" onClick={onReturnToOpenTrips}>Return to Open Trips</button>
          </div>
        </div>}
        {verification.status === 'site_unavailable' && <div className="loading-result loading-result-warning" role="alert">
          <h3>Offloading site unavailable</h3><p>Your current assignment could not be validated. Contact an administrator.</p>
        </div>}
        {verification.status === 'access_unavailable' && <div className="loading-result loading-result-warning" role="alert">
          <h3>Offloading access unavailable</h3><p>Sign in again or contact an administrator.</p>
        </div>}
        {showCapture && <div className="offloading-scan-step" aria-label="Mandatory truck plate verification">
          <div className="loading-section-heading"><h3>Verify Physical Truck</h3>
            <p>Scan the truck plate with the camera. Tonnage entry unlocks only when it matches this trip.</p></div>
          {capturePanel}
        </div>}
        {verification.status === 'verified' && <div className="loading-result loading-result-ready" role="status">
          <p className="eyebrow">Truck verified</p>
          <p>{verification.capture.confirmedPlate}</p>
        </div>}
        {closurePanel}
        {canReturn && verification.status !== 'mismatch' && verification.status !== 'error'
          && <button className="button secondary offloading-next" type="button"
            onClick={onReturnToOpenTrips}>Return to Open Trips</button>}
      </>}
    </section>
    <section className="loading-stat-section" aria-label="Today's Offloading activity">
      <div className="loading-section-heading"><h2>Today's activity</h2>
        <p>Figures reflect your closures. Open Trips shows the currently processable in-transit trip pool.</p></div>
      <OffloadingStatistics state={statistics} retry={onRetryStatistics} />
    </section>
  </div>;
}
