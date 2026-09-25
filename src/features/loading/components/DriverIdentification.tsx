import type { DriverSearchState, DriverWorkflowSnapshot } from '../utils/driverWorkflowController';
import { validateNewDriver } from '../utils/driverWorkflowController';
import type { NewDriverForm, RegistrationFailureCode, SafeDriverSummary } from '../types';

type Props = {
  state: DriverWorkflowSnapshot;
  onRegular: () => void;
  onDifferent: () => void;
  onSearchEdit: (query: string) => void;
  onSearch: () => void;
  onSelectExisting: (driver: SafeDriverSummary) => void;
  onStartUnknown: () => void;
  onStartNewDriver: () => void;
  onFormEdit: (field: keyof NewDriverForm, value: string) => void;
  onCancel: () => void;
  onRegister: () => void;
  onBackFromDuplicate: () => void;
  onMakeRegular: (value: boolean) => void;
};

const registrationMessages: Record<RegistrationFailureCode, string> = {
  INVALID_REQUEST_ID: 'Please start a new registration attempt.',
  INVALID_PLATE: 'Check the confirmed vehicle plate and look it up again.',
  INVALID_REGISTRATION_MODE: 'This registration choice is no longer valid. Start again.',
  SITE_ASSIGNMENT_REQUIRED: 'Your loading-site assignment must be checked again.',
  INVALID_SITE_ASSIGNMENT: 'Your assigned site is not available for Loading.',
  INACTIVE_SITE: 'Your assigned loading site is inactive.',
  PLATE_ALREADY_REGISTERED: 'This plate is now registered. Look it up again before continuing.',
  TRUCK_NOT_FOUND: 'This truck can no longer be found. Look it up again.',
  TRUCK_PLATE_MISMATCH: 'The truck and confirmed plate no longer match. Look it up again.',
  INACTIVE_TRUCK: 'This truck is inactive. Contact Operations.',
  OPEN_TRIP_EXISTS: 'This truck already has an open trip. Contact Operations.',
  BLOCKING_EXCEPTION: 'This truck needs Operations review before continuing.',
  DRIVER_NOT_FOUND: 'That driver is no longer available. Search again.',
  INACTIVE_DRIVER: 'That driver is inactive. Search again or contact Operations.',
  INVALID_DRIVER_NAME: 'Check the driver’s full name.',
  INVALID_PHONE: 'Check the driver’s phone number.',
  INVALID_EMAIL: 'Check the driver’s email address.',
  DRIVER_MATCH_REQUIRES_REVIEW: 'A driver may already use this phone number. Review before continuing.',
  PAYMENT_DETAILS_REQUIRED: 'Complete all required payment details.',
  INVALID_BANK_NAME: 'Check the bank name.',
  INVALID_ACCOUNT_NUMBER: 'The account number must be exactly 10 digits.',
  INVALID_ACCOUNT_NAME: 'Check the account name.',
};

function DriverSearch({ search, onEdit, onSearch, onSelect }: {
  search: DriverSearchState; onEdit: Props['onSearchEdit']; onSearch: Props['onSearch']; onSelect: Props['onSelectExisting'];
}) {
  return <div className="loading-driver-search">
    <form onSubmit={event => { event.preventDefault(); onSearch(); }}>
      <label htmlFor="loading-driver-query">Find an existing driver</label>
      <div className="loading-entry-row">
        <input id="loading-driver-query" type="search" autoComplete="off" value={search.query}
          onChange={event => onEdit(event.target.value)} placeholder="Name or phone number" />
        <button className="button secondary" type="submit" disabled={search.query.trim().length < 3 || search.status === 'searching'}>
          {search.status === 'searching' ? 'Searching…' : 'Search drivers'}
        </button>
      </div>
    </form>
    {search.status === 'invalid' && <p role="alert">Enter at least three characters to search.</p>}
    {search.status === 'error' && <div role="alert"><p>Driver search is unavailable. Try again.</p>
      <button className="button secondary" type="button" onClick={onSearch}>Retry search</button></div>}
    {search.status === 'results' && (search.drivers.length === 0
      ? <p role="status">No matching driver found.</p>
      : <ul className="loading-driver-results" aria-label="Matching drivers">{search.drivers.map(driver =>
        <li key={driver.id}><div><strong>{driver.fullName}</strong><span>{driver.phoneNumber}</span>
          {driver.email && <span>{driver.email}</span>}</div>
          <button className="button secondary" type="button" disabled={!driver.isActive} onClick={() => onSelect(driver)}>
            {driver.isActive ? 'Choose driver' : 'Inactive'}</button></li>)}</ul>)}
  </div>;
}

function NewDriverFields({ state, onEdit, disabled }: {
  state: NewDriverForm; onEdit: Props['onFormEdit']; disabled: boolean;
}) {
  const field = (key: keyof NewDriverForm, label: string, required: boolean, extras: { type?: string; inputMode?: 'numeric' | 'tel'; maxLength?: number } = {}) =>
    <label key={key}>{label}<input name={key} type={extras.type ?? 'text'} inputMode={extras.inputMode}
      maxLength={extras.maxLength} required={required} autoComplete="off" disabled={disabled}
      value={state[key]} onChange={event => onEdit(key, event.target.value)} /></label>;
  return <div className="loading-driver-fields">
    <h4>Driver Details</h4>
    {field('fullName', 'Full Name', true, { maxLength: 200 })}
    {field('phoneNumber', 'Phone Number', true, { type: 'tel', maxLength: 40 })}
    {field('email', 'Email (optional)', false, { type: 'email', maxLength: 254 })}
    <div className="loading-payment-fields"><h4>Payment Details</h4>
      <p>Required for driver payout setup. Account ownership is not verified here.</p>
      {field('bankName', 'Bank Name', true, { maxLength: 200 })}
      {field('accountNumber', 'Account Number', true, { inputMode: 'numeric', maxLength: 10 })}
      {field('accountName', 'Account Name', true, { maxLength: 200 })}
    </div>
  </div>;
}

export function DriverIdentification(props: Props) {
  const { context, choice, selected, search, registration, existingForNewTruck, form } = props.state;
  if (!context) return null;
  // The saved receipt is authoritative until validation finishes. In
  // particular, the old unknown-truck context must never offer registration.
  if (props.state.saved && (context.kind !== 'known'
    || (props.state.saved.status !== 'ready'
      && !(props.state.saved.status === 'blocked' && props.state.saved.reason === 'inactive_driver')))) return null;
  const isSubmitting = registration.status === 'submitting' || registration.status === 'refreshing';
  const editingNew = registration.status !== 'closed' && registration.mode !== 'new_truck_existing_driver';
  return <section className="loading-driver-panel" aria-label="Identify actual driver">
    {context.kind === 'known' ? <>
      <h4>Who is driving this trip?</h4>
      <label className="loading-choice"><input type="radio" name="actual-driver-choice" checked={choice === 'regular'}
        onChange={props.onRegular} disabled={isSubmitting || !context.regular.isActive} />
        {context.regular.fullName} — Regular Driver{!context.regular.isActive && ' (Inactive)'}</label>
      {!context.regular.isActive && <p role="status">The regular driver cannot be selected for this trip.</p>}
      <label className="loading-choice"><input type="radio" name="actual-driver-choice" checked={choice === 'different'}
        onChange={props.onDifferent} disabled={isSubmitting} />Different Driver</label>
    </> : <>
      <h4>Register this truck</h4>
      <p>Confirmed plate: <strong>{context.plate}</strong></p>
      {registration.status === 'closed' && <button className="button" type="button" onClick={props.onStartUnknown}>Register Truck &amp; Driver</button>}
    </>}

    {registration.status === 'closed' && (context.kind === 'unknown' || choice === 'different') && <>
      <DriverSearch search={search} onEdit={props.onSearchEdit} onSearch={props.onSearch} onSelect={props.onSelectExisting} />
      {context.kind === 'known' && <button className="button secondary" type="button" onClick={props.onStartNewDriver}>Register New Driver</button>}
    </>}

    {registration.status !== 'closed' && <div className="loading-registration">
      {registration.status === 'duplicate_review' ? <div role="alert">
        <h4>Possible existing driver</h4>
        <p>A driver already uses this phone number. Review the identity before selecting anyone.</p>
        {registration.candidates.length ? <ul className="loading-driver-results">{registration.candidates.map(driver =>
          <li key={driver.id}><div><strong>{driver.fullName}</strong><span>{driver.phoneNumber}</span>
            {driver.email && <span>{driver.email}</span>}</div>
            <button className="button secondary" type="button" disabled={!driver.isActive}
              onClick={() => props.onSelectExisting(driver)}>Use this driver</button></li>)}</ul>
          : <p>No safe match could be shown. Correct the details or contact an administrator.</p>}
        <button className="button secondary" type="button" onClick={props.onBackFromDuplicate}>Correct entered details</button>
      </div> : <>
        {registration.status === 'business_failure' && <p role="alert">{registrationMessages[registration.code]}</p>}
        {registration.status === 'authorization' && <p role="alert">Loading access is unavailable. Recheck your account and site assignment before registering.</p>}
        {registration.status === 'ambiguous' && <p role="alert">The connection ended before registration could be confirmed. Do not start another registration. Retry the same request to check its outcome.</p>}
        {registration.status === 'refreshing' && <p role="status">Registration saved. Checking the truck register…</p>}
        {registration.status === 'refresh_error' && <p role="alert">Registration was saved, but truck lookup could not be refreshed. Look up this plate again before continuing.</p>}
        {(registration.status === 'refreshing' || registration.status === 'refresh_error' || registration.status === 'authorization')
          ? null : registration.mode === 'new_truck_existing_driver' && existingForNewTruck
          ? <div><h4>Register truck with existing driver</h4><p>{existingForNewTruck.fullName} · {existingForNewTruck.phoneNumber}</p></div>
          : <form id="loading-driver-registration" onSubmit={event => { event.preventDefault(); props.onRegister(); }}>
            <NewDriverFields state={form} onEdit={props.onFormEdit} disabled={isSubmitting} />
          </form>}
        {(registration.status === 'editing' || registration.status === 'submitting' || registration.status === 'ambiguous'
          || registration.status === 'business_failure') && <div className="loading-registration-actions">
          <button className="button" type={registration.mode === 'new_truck_existing_driver' ? 'button' : 'submit'}
            form={registration.mode === 'new_truck_existing_driver' ? undefined : 'loading-driver-registration'}
            onClick={registration.mode === 'new_truck_existing_driver' ? props.onRegister : undefined}
            disabled={isSubmitting || (editingNew && !!validateNewDriver(form))}>
            {isSubmitting ? 'Registering…' : registration.status === 'ambiguous' ? 'Retry same request' : 'Register'}</button>
          <button className="button secondary" type="button" disabled={isSubmitting} onClick={props.onCancel}>Cancel</button>
        </div>}
      </>}
    </div>}

    {selected && <div className="loading-actual-driver"><h4>Actual Driver</h4>
      <strong>{selected.driver.fullName}</strong><span>{selected.driver.phoneNumber}</span>
      {selected.driver.email && <span>{selected.driver.email}</span>}
      {context.kind === 'known' && selected.driver.id !== context.regular.id && <label className="loading-choice">
        <input type="checkbox" checked={selected.makeRegular} onChange={event => props.onMakeRegular(event.target.checked)} />
        Set {selected.driver.fullName} as this truck’s regular driver</label>}
      <p className="loading-next-note">Driver identified. Review the trip details before opening.</p>
    </div>}
  </section>;
}
