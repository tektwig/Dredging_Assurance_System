import type { ReactNode } from 'react';
import { operationalDateLabel } from '../../loading/utils/operationalDate';
import type { OffloadingLookupSnapshot } from '../utils/offloadingLookupController';
import type { ClosureState } from '../utils/closureController';
import type { OffloadingStatisticsState } from '../types';

type Props = { officerName: string; lookup: OffloadingLookupSnapshot;
  closure: ClosureState; closurePanel: ReactNode; capturePanel: ReactNode;
  statistics: OffloadingStatisticsState; now: Date; onRetryStatistics: () => void;
  onLookup: () => void; onReset: () => void };

export function OffloadingStatistics({ state, retry }: { state: OffloadingStatisticsState; retry: () => void }) {
  if (state.status === 'loading') return <p className="loading-note" role="status">Loading today's figures…</p>;
  if (state.status === 'error') return <div className="loading-note" role="status">
    <p>Today's figures are unavailable. Trip lookup remains available. Try again shortly.</p>
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

export function OffloadingPortalView({ officerName, lookup, capturePanel,
  closure, closurePanel, statistics, now, onRetryStatistics, onLookup, onReset }: Props) {
  const state = lookup.state;
  const locked = closure.status !== 'idle';
  const showCapture = closure.status === 'idle';
  return <div className="loading-portal offloading-portal">
    <header className="loading-heading">
      <div><p className="eyebrow">Truck Revenue Tracking System</p><h1>Offloading Portal</h1>
        <p className="muted">{officerName}</p>
        <p className="loading-site-summary"><span>Assigned Offloading Site</span>
          <strong>{state.status === 'found' ? state.assignment.siteName : 'Will be verified when you find a trip'}</strong></p>
      </div>
      <div className="loading-date"><span>Operational date · Africa/Lagos</span>
        <strong>{operationalDateLabel(now)}</strong></div>
    </header>
    <section className="loading-work-card" aria-label="Scan plate and find open trip">
      <div className="loading-section-heading"><h2>Scan Plate</h2>
        <p>Scan the vehicle plate to find its open trip.</p></div>
      {showCapture && capturePanel}
      {state.status === 'looking_up' && <div className="loading-result" role="status">
        <h3>Finding open trip…</h3><p>Checking the confirmed plate.</p></div>}
      {state.status === 'invalid_plate' && <div className="loading-result loading-result-warning" role="alert">
        <h3>Plate not recognized</h3><p>Rescan the plate or try again.</p></div>}
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
          <div><dt>Estimated Tonnage</dt><dd>{state.trip.estimatedQuantityTonnes === null
            ? 'Estimate not recorded for this trip' : `${state.trip.estimatedQuantityTonnes.toFixed(2)} tonnes`}</dd></div>
        </dl>
      </div>}
      {closurePanel}
      {(state.status !== 'idle' || closure.status !== 'idle')
        && closure.status !== 'submitting' && closure.status !== 'ambiguous'
        && <button className="button secondary offloading-next" type="button"
        onClick={onReset}>Scan Next Truck</button>}
    </section>
    <section className="loading-stat-section" aria-label="Today's Offloading activity">
      <div className="loading-section-heading"><h2>Today’s activity</h2>
        <p>Figures reflect your closures. Open Trips counts all currently open trips available for lookup.</p></div>
      <OffloadingStatistics state={statistics} retry={onRetryStatistics} />
    </section>
  </div>;
}
