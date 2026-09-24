import type { LookupSnapshot } from '../utils/lookupController';
import type { SiteContextState, StatisticsState } from '../types';
import { operationalDateLabel, platePreview } from '../utils/operationalDate';

type Props = {
  officerName: string;
  now: Date;
  site: SiteContextState;
  statistics: StatisticsState;
  plate: string;
  lookup: LookupSnapshot;
  onPlateChange: (plate: string) => void;
  onLookup: () => void;
  onRetrySite: () => void;
  onRetryStatistics: () => void;
};

function Statistics({ state, retry }: { state: StatisticsState; retry: () => void }) {
  if (state.status === 'loading') return <p className="loading-note" role="status">Loading today's figures…</p>;
  if (state.status === 'error') return <div className="loading-note" role="status">
    <p>Today's figures are unavailable. Truck lookup remains available when your site is active.</p>
    <button className="button secondary" type="button" onClick={retry}>Retry figures</button>
  </div>;
  const cards = [
    ['Trips Opened', state.statistics.tripsOpened],
    ['Open Trips', state.statistics.openTrips],
    ['Trips Closed', state.statistics.tripsClosed],
    ['Trucks Processed', state.statistics.trucksProcessed],
  ] as const;
  return <div className="loading-stat-grid" aria-label="Loading statistics">
    {cards.map(([label, count]) => <div className="loading-stat" key={label}>
      <span>{label}</span><strong>{count.toLocaleString('en-NG')}</strong>
    </div>)}
  </div>;
}

function LookupResult({ lookup, onRetry }: { lookup: LookupSnapshot; onRetry: () => void }) {
  const state = lookup.state;
  if (state.status === 'idle') return null;
  if (state.status === 'looking_up') return <div className="loading-result" role="status"><h3>Looking up truck…</h3>
    <p>Checking {state.plate} against the truck register.</p></div>;
  if (state.status === 'invalid_plate') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Check the plate number</h3><p>Enter a valid vehicle plate, then try again.</p></div>;
  if (state.status === 'access_unavailable') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Loading access unavailable</h3><p>Your account can no longer use truck lookup. Contact an administrator.</p></div>;
  if (state.status === 'site_unavailable') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Loading site changed or unavailable</h3><p>Your assignment is being refreshed. Review it before another lookup.</p></div>;
  if (state.status === 'lookup_error') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Truck lookup unavailable</h3><p>Check your connection and try again. No trip was opened.</p>
    <button className="button secondary" type="button" disabled={lookup.pending} onClick={onRetry}>Retry lookup</button>
  </div>;
  if (state.status === 'unknown_truck') return <div className="loading-result loading-result-warning" role="status">
    <h3>Truck not registered</h3><p>Confirmed plate: <strong>{state.plate}</strong></p>
    <p>This truck must be registered before a trip can be opened. Registration is coming in the next phase.</p>
  </div>;
  if (state.status === 'inactive_truck') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Truck inactive</h3><p>{state.truck.registrationNumber} cannot open a trip. Contact Operations.</p>
  </div>;
  if (state.status === 'inactive_driver') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Regular driver inactive</h3><p>{state.driver.fullName} is inactive. Contact Operations before continuing.</p>
  </div>;
  if (state.status === 'open_trip_exists') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Open trip already exists</h3><p>{state.truck.registrationNumber} already has open trip <strong>{state.trip.tripNumber}</strong>.</p>
    <p>Contact Operations if this needs investigation. Loading cannot override or close it.</p>
  </div>;
  if (state.status === 'blocking_exception') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Truck needs review</h3><p>{state.truck.registrationNumber} has an unresolved blocking issue. Contact Operations.</p>
  </div>;
  return <div className="loading-result loading-result-ready" role="status">
    <p className="eyebrow">Truck found</p>
    <h3>{state.truck.registrationNumber}</h3>
    <dl className="loading-details">
      <div><dt>Confirmed plate</dt><dd>{state.plate}</dd></div>
      <div><dt>Normalized plate</dt><dd>{state.truck.normalizedRegistration}</dd></div>
      <div><dt>Truck status</dt><dd>Active · no open trip or blocking issue</dd></div>
      <div><dt>Regular driver</dt><dd>{state.driver.fullName}<span>{state.driver.phoneNumber}</span>
        {state.driver.email && <span>{state.driver.email}</span>}</dd></div>
    </dl>
    <p className="loading-next-note">Driver confirmation and trip opening will be available in the next phase.</p>
  </div>;
}

export function LoadingPortalView(props: Props) {
  const canProcess = props.site.status === 'ready';
  const preview = platePreview(props.plate);
  return <div className="loading-portal">
    <div className="loading-heading">
      <div><p className="eyebrow">Truck Revenue Tracking System</p><h1>Loading Portal</h1>
        <p className="muted">Welcome, {props.officerName}. Confirm each plate before looking up a truck.</p></div>
      <div className="loading-date"><span>Operational date · Africa/Lagos</span><strong>{operationalDateLabel(props.now)}</strong></div>
    </div>

    <section className="loading-context" aria-label="Assigned loading site">
      <span className="eyebrow">Assigned Site</span>
      {props.site.status === 'ready' ? <strong>{props.site.site.siteName}</strong>
        : props.site.status === 'loading' ? <p role="status">Checking your loading-site assignment…</p>
          : <div role="alert"><strong>Loading site unavailable</strong>
            <p>{props.site.status === 'error'
              ? 'Unable to verify your assignment. Check your connection and retry.'
              : props.site.reason === 'unauthorized' ? 'Your account cannot access Loading assignments. Contact an administrator.'
                : props.site.reason === 'missing' ? 'Your account has no current loading-site assignment. Contact an administrator.'
                : props.site.reason === 'wrong_type' ? 'Your assigned site is not a loading site. Contact an administrator.'
                  : 'Your assigned loading site is inactive. Contact an administrator.'}</p>
            <button className="button secondary" type="button" onClick={props.onRetrySite}>Recheck assignment</button>
          </div>}
    </section>

    <section className="loading-stat-section" aria-label="Today’s Loading activity">
      <div className="loading-section-heading"><h2>Today’s activity</h2><p>Figures for your Loading work. Open Trips includes older open trips.</p></div>
      <Statistics state={props.statistics} retry={props.onRetryStatistics} />
    </section>

    <section className="loading-work-card" aria-label="Manual truck lookup">
      <div className="loading-section-heading"><p className="eyebrow">Process a truck</p><h2>Confirm the vehicle plate</h2>
        <p>Enter the plate as you see it. Spaces and hyphens are accepted.</p></div>
      <form className="loading-plate-form" onSubmit={event => { event.preventDefault(); props.onLookup(); }} aria-busy={props.lookup.pending}>
        <label htmlFor="loading-plate">Vehicle Plate Number</label>
        <div className="loading-entry-row">
          <input id="loading-plate" name="plate" type="text" autoComplete="off" autoCapitalize="characters"
            spellCheck={false} maxLength={64} placeholder="e.g. ABC-123" value={props.plate}
            onChange={event => props.onPlateChange(event.target.value)} disabled={!canProcess} />
          <button className="button" type="submit" disabled={!canProcess || props.lookup.pending || !props.plate.trim()}>
            {props.lookup.pending ? 'Looking up…' : 'Confirm plate & look up'}
          </button>
        </div>
        {props.plate.trim() && <p className="loading-plate-preview">Entered: <strong>{props.plate.trim()}</strong>
          <span>Normalized preview: <strong>{preview || '—'}</strong></span></p>}
      </form>
      {!canProcess && <p className="loading-disabled-note">Truck processing is paused until an active loading site is confirmed.</p>}
      {canProcess && <LookupResult lookup={props.lookup} onRetry={props.onLookup} />}
    </section>
  </div>;
}
