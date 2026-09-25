import type { ReactNode } from 'react';
import type { LookupSnapshot } from '../utils/lookupController';
import type { SavedRegistrationOutcome, SavedRegistrationReceipt, SiteContextState, StatisticsState } from '../types';
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
  driverPanel?: ReactNode;
  tripPanel?: ReactNode;
  tripStage?: string;
  lateOpenedTrip?: string | null;
  onDismissLateOpenedTrip?: () => void;
  plateLocked?: boolean;
  savedRegistration?: SavedRegistrationOutcome | null;
  lateRegistration?: SavedRegistrationReceipt | null;
  onDismissLateRegistration?: () => void;
  onRetryRegistrationCheck?: () => void;
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

function LookupResult({ lookup, onRetry, driverPanel, saved, onRetryRegistrationCheck }: {
  lookup: LookupSnapshot; onRetry: () => void; driverPanel?: ReactNode;
  saved?: SavedRegistrationOutcome | null; onRetryRegistrationCheck?: () => void;
}) {
  const state = lookup.state;
  if (saved?.status === 'validating') return <div className="loading-result" role="status">
    <h3>Registration saved</h3><p>Checking the registered truck details. Do not register it again.</p>
  </div>;
  if (saved?.status === 'review_required') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Registration saved · review required</h3>
    <p>{saved.reason === 'lookup_unavailable'
      ? 'The truck details could not be checked after registration. Do not register this truck again.'
      : 'The refreshed truck details did not match the completed registration. Do not register this truck again.'}</p>
    <p>Confirmed plate: <strong>{saved.receipt.plate}</strong>. Contact Operations or an administrator before continuing.</p>
    {saved.reason === 'lookup_unavailable' && <button className="button secondary" type="button"
      onClick={onRetryRegistrationCheck}>Retry truck check</button>}
  </div>;
  if (saved?.status === 'blocked') {
    const message = saved.reason === 'inactive_truck' ? 'The registered truck is inactive.'
      : saved.reason === 'inactive_driver' ? 'The registered regular driver is inactive.'
        : saved.reason === 'open_trip_exists' ? `An open trip already exists${saved.trip ? ` (${saved.trip.tripNumber})` : ''}.`
          : 'A blocking issue needs Operations review.';
    return <div className="loading-result loading-result-warning" role="alert">
      <h3>{saved.reason === 'inactive_driver'
        ? 'Registration saved · choose the actual driver' : 'Registration saved · truck cannot continue'}</h3><p>{message}</p>
      <p>{saved.reason === 'inactive_driver'
        ? 'Choose a different active driver. Do not register the truck again.'
        : 'Do not register this truck again. Contact Operations before continuing.'}</p>
      {saved.reason === 'inactive_driver' && driverPanel}
    </div>;
  }
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
    {driverPanel}
  </div>;
  if (state.status === 'unknown_truck') return <div className="loading-result loading-result-warning" role="status">
    <h3>Truck not registered</h3><p>Confirmed plate: <strong>{state.plate}</strong></p>
    <p>This truck must be registered before a trip can be opened.</p>{driverPanel}
  </div>;
  if (state.status === 'inactive_truck') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Truck inactive</h3><p>{state.truck.registrationNumber} cannot open a trip. Contact Operations.</p>
  </div>;
  if (state.status === 'inactive_driver') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Regular driver inactive</h3><p>{state.driver.fullName} cannot drive this trip. Choose a different active driver.</p>
    {driverPanel}
  </div>;
  if (state.status === 'open_trip_exists') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Open trip already exists</h3><p>{state.truck.registrationNumber} already has open trip <strong>{state.trip.tripNumber}</strong>.</p>
    <p>Contact Operations if this needs investigation. Loading cannot override or close it.</p>
  </div>;
  if (state.status === 'blocking_exception') return <div className="loading-result loading-result-warning" role="alert">
    <h3>Truck needs review</h3><p>{state.truck.registrationNumber} has an unresolved blocking issue. Contact Operations.</p>
  </div>;
  return <div className="loading-result loading-result-ready" role="status">
    {saved?.status === 'ready' && <p className="loading-saved-note">Registration saved. Truck and regular driver verified.</p>}
    <p className="eyebrow">Truck found</p>
    <h3>{state.truck.registrationNumber}</h3>
    <dl className="loading-details">
      <div><dt>Confirmed plate</dt><dd>{state.plate}</dd></div>
      <div><dt>Normalized plate</dt><dd>{state.truck.normalizedRegistration}</dd></div>
      <div><dt>Truck status</dt><dd>Active · no open trip or blocking issue</dd></div>
      <div><dt>Regular driver</dt><dd>{state.driver.fullName}<span>{state.driver.phoneNumber}</span>
        {state.driver.email && <span>{state.driver.email}</span>}</dd></div>
    </dl>
    {driverPanel}
  </div>;
}

function siteUnavailableMessage(site: SiteContextState): string {
  if (site.status === 'loading') return 'Checking your loading-site assignment…';
  if (site.status === 'error') return 'Unable to verify your assignment. Check your connection and retry.';
  if (site.status === 'blocked') {
    if (site.reason === 'unauthorized') return 'Your account cannot access Loading assignments. Contact an administrator.';
    if (site.reason === 'missing') return 'Your account has no current loading-site assignment. Contact an administrator.';
    if (site.reason === 'wrong_type') return 'Your assigned site is not a loading site. Contact an administrator.';
    return 'Your assigned loading site is inactive. Contact an administrator.';
  }
  return '';
}

export function LoadingPortalView(props: Props) {
  const canProcess = props.site.status === 'ready';
  const preview = platePreview(props.plate);
  return <div className="loading-portal">
    <header className="loading-heading">
      <div><p className="eyebrow">Truck Revenue Tracking System</p><h1>Loading Portal</h1>
        <p className="muted">{props.officerName}</p>
        <p className="loading-site-summary"><span>Assigned Loading Site</span>
          <strong>{props.site.status === 'ready' ? props.site.site.siteName : 'Unavailable'}</strong></p></div>
      <div className="loading-date"><span>Operational date · Africa/Lagos</span><strong>{operationalDateLabel(props.now)}</strong></div>
    </header>

    <section className="loading-work-card" aria-label="Manual truck lookup">
      {props.lateOpenedTrip && <div className="loading-result loading-result-warning" role="alert">
        <strong>Trip {props.lateOpenedTrip} opened for a previous truck.</strong>
        <p>The response arrived after the workspace changed. Do not open that truck again. Check with Operations if needed.</p>
        <button className="button secondary" type="button" onClick={props.onDismissLateOpenedTrip}>Dismiss notice</button>
      </div>}
      {props.lateRegistration && <div className="loading-result loading-result-warning" role="status">
        <strong>Registration saved for {props.lateRegistration.plate}.</strong>
        <p>It completed after the page context changed. Look up that plate before continuing; do not register it again.</p>
        <button className="button secondary" type="button" onClick={props.onDismissLateRegistration}>Dismiss notice</button>
      </div>}
      {canProcess ? <>
        <div className="loading-section-heading"><h2>Process Truck</h2>
          <p>Enter the plate as you see it. Spaces and hyphens are accepted.</p></div>
        <form className="loading-plate-form" onSubmit={event => { event.preventDefault(); props.onLookup(); }} aria-busy={props.lookup.pending}>
          <label htmlFor="loading-plate">Vehicle Plate Number</label>
          <div className="loading-entry-row">
            <input id="loading-plate" name="plate" type="text" autoComplete="off" autoCapitalize="characters"
              spellCheck={false} maxLength={64} placeholder="e.g. ABC-123" value={props.plate}
              onChange={event => props.onPlateChange(event.target.value)} disabled={props.plateLocked} />
            <button className="button" type="submit" disabled={props.plateLocked || props.lookup.pending || !props.plate.trim()}>
              {props.lookup.pending ? 'Looking up…' : 'Find Truck'}
            </button>
          </div>
          {props.plate.trim() && <p className="loading-plate-preview">Entered: <strong>{props.plate.trim()}</strong>
            <span>Normalized preview: <strong>{preview || '—'}</strong></span></p>}
        </form>
        {(!props.tripStage || props.tripStage === 'idle' || props.tripStage === 'site_changed' || props.tripStage === 'authorization')
          && <LookupResult lookup={props.lookup} onRetry={props.onLookup} driverPanel={props.driverPanel}
            saved={props.savedRegistration} onRetryRegistrationCheck={props.onRetryRegistrationCheck} />}
        {props.tripPanel}
      </> : <div className="loading-site-block" role={props.site.status === 'loading' ? 'status' : 'alert'}>
        <h2>{props.site.status === 'loading' ? 'Checking loading site' : 'Loading site unavailable'}</h2>
        <p>{siteUnavailableMessage(props.site)}</p>
        {props.site.status !== 'loading' && <button className="button secondary" type="button"
          onClick={props.onRetrySite}>Recheck assignment</button>}
      </div>}
    </section>

    <section className="loading-stat-section" aria-label="Today’s Loading activity">
      <div className="loading-section-heading"><h2>Today’s activity</h2><p>Figures for your Loading work. Open Trips includes older open trips.</p></div>
      <Statistics state={props.statistics} retry={props.onRetryStatistics} />
    </section>
  </div>;
}
