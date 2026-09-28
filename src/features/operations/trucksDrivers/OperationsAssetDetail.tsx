import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import {
  correctTruckPlate, loadAssetHistory, loadDriverDetail, loadDrivers, loadTruckDetail,
  OperationsAssetError, setDriverActive, setRegularDriver, setTruckActive,
  updateDriverMaster, updateTruckMaster,
  type AssetKind, type AssetPage, type AssetTrip, type DriverDetail, type DriverRow, type TruckDetail,
} from '../services/operationsAssets';
import { AssetTabs, formatDate } from './OperationsAssetsList';
import './assets.css';

type DetailState<T> = { status: 'loading' } | { status: 'error' } | { status: 'not-found' } | { status: 'ready'; data: T };
type HistoryState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AssetPage<AssetTrip> };
type ChangeState = { status: 'idle' | 'saving' | 'saved' | 'conflict' | 'error'; message?: string };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function AssetHistory({ kind, assetId }: { kind: AssetKind; assetId: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    void loadAssetHistory(kind, assetId, page).then(data => { if (current) setState({ status: 'ready', data }); })
      .catch(() => { if (current) setState({ status: 'error' }); });
    return () => { current = false; };
  }, [kind, assetId, page, revision]);
  return <section className="card asset-section"><h2>Trip history</h2>
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load trip history."
      onRetry={() => setRevision(value => value + 1)} />}
    {state.status === 'ready' && state.data.items.length === 0 && <ListResultState status="empty" message="No trips recorded." />}
    {state.status === 'ready' && state.data.items.length > 0 && <><div className="operations-table-scroll">
      <table className="operations-table"><thead><tr><th scope="col">Trip #</th><th scope="col">Plate</th>
        <th scope="col">Actual Driver</th><th scope="col">Opened</th><th scope="col">Closed</th>
        <th scope="col">Tonnage</th><th scope="col">Status</th></tr></thead>
        <tbody>{state.data.items.map(trip => <tr key={trip.trip_id}>
          <td><Link to={`/operations/trips/${trip.trip_id}`}>{trip.trip_number}</Link></td>
          <td>{trip.plate}</td><td>{trip.driver_name}</td><td>{formatDate(trip.opened_at)}</td>
          <td>{formatDate(trip.closed_at)}</td><td>{trip.tonnage === null ? '—' : `${trip.tonnage.toFixed(2)} t`}</td>
          <td>{trip.status}</td>
        </tr>)}</tbody></table></div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={setPage} />
    </>}
  </section>;
}

function useDetail<T>(id: string, loader: (id: string) => Promise<T | null>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<DetailState<T>>({ status: 'loading' });
  const refresh = useCallback(async () => {
    const data = await loader(id);
    setState(data ? { status: 'ready', data } : { status: 'not-found' });
  }, [id, loader]);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    void loader(id).then(data => { if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' }); })
      .catch(() => { if (current) setState({ status: 'error' }); });
    return () => { current = false; };
  }, [id, loader, revision]);
  return { state, refresh, retry: () => setRevision(value => value + 1) };
}

function useChange(refresh: () => Promise<void>) {
  const [state, setState] = useState<ChangeState>({ status: 'idle' });
  const inFlight = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: 'saving' });
    try {
      const result = await action();
      await refresh();
      setState({ status: 'saved', message: result === null ? 'Record no longer exists.' : 'Authoritative details refreshed.' });
    } catch (error) {
      let refreshFailed = false;
      try { await refresh(); } catch { refreshFailed = true; }
      if (error instanceof OperationsAssetError) {
        setState({ status: error.kind === 'stale' || error.kind === 'open-trip' || error.kind === 'relationship'
          ? 'conflict' : 'error', message: refreshFailed ? `${error.message} Reload this record before retrying.` : error.message });
      } else setState({ status: 'error', message: 'Unable to save this change. Reload before retrying.' });
    } finally { inFlight.current = false; }
  };
  return { state, run };
}

function ChangeMessage({ state }: { state: ChangeState }) {
  if (state.status === 'idle') return null;
  return <p role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'message error-message' : 'message'}>
    {state.status === 'saving' ? 'Saving and refreshing authoritative details…' : state.message}
  </p>;
}

function TruckMasterForm({ truck, run, saving }: { truck: TruckDetail; run: (action: () => Promise<unknown>) => void; saving: boolean }) {
  const [truckType, setTruckType] = useState(truck.truck_type ?? '');
  const [capacity, setCapacity] = useState(truck.capacity?.toString() ?? '');
  const [ownerName, setOwnerName] = useState(truck.owner_name ?? '');
  const [ownerContact, setOwnerContact] = useState(truck.owner_contact ?? '');
  const [reason, setReason] = useState('record_correction');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(() => updateTruckMaster(truck.truck_id, truck.updated_at, { truckType, capacity, ownerName, ownerContact, reason }));
  };
  return <form className="card asset-section asset-form" onSubmit={submit}><h2>Vehicle master data</h2>
    <div className="asset-form-grid">
      <label>Truck type<input value={truckType} maxLength={200} onChange={event => setTruckType(event.currentTarget.value)} /></label>
      <label>Capacity (tonnes)<input type="number" min="0.01" max="200" step="0.01" value={capacity}
        onChange={event => setCapacity(event.currentTarget.value)} /></label>
      <label>Owner name<input value={ownerName} maxLength={255} onChange={event => setOwnerName(event.currentTarget.value)} /></label>
      <label>Owner contact<input value={ownerContact} maxLength={100} onChange={event => setOwnerContact(event.currentTarget.value)} /></label>
      <label>Audit reason<select value={reason} onChange={event => setReason(event.currentTarget.value)}>
        <option value="record_correction">Record correction</option><option value="ownership_update">Ownership update</option>
        <option value="vehicle_specification_update">Vehicle specification update</option>
      </select></label>
    </div><button className="button" type="submit" disabled={saving || truck.open_trips > 0}>Save vehicle data</button>
  </form>;
}

function PlateForm({ truck, run, saving }: { truck: TruckDetail; run: (action: () => Promise<unknown>) => void; saving: boolean }) {
  const [plate, setPlate] = useState(truck.plate);
  return <form className="card asset-section asset-form" onSubmit={event => {
    event.preventDefault(); run(() => correctTruckPlate(truck.truck_id, truck.updated_at, plate));
  }}><h2>Correct truck plate</h2><p className="muted">Audited identity correction. Historical trip and Waybill snapshots are unchanged.</p>
    <label>Corrected plate<input required maxLength={32} value={plate} onChange={event => setPlate(event.currentTarget.value)} /></label>
    <button className="button secondary" type="submit" disabled={saving || truck.open_trips > 0 || plate.trim() === truck.plate}>Correct plate</button>
  </form>;
}

function RegularDriverForm({ truck, run, saving }: { truck: TruckDetail; run: (action: () => Promise<unknown>) => void; saving: boolean }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [candidates, setCandidates] = useState<DriverRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    let current = true;
    if (search.trim().length < 2) { setCandidates([]); setStatus('idle'); return () => { current = false; }; }
    const timer = setTimeout(() => {
      setStatus('loading');
      void loadDrivers({ search, active: 'active' }, 1).then(page => {
        if (current) { setCandidates(page.items); setStatus('idle'); }
      }).catch(() => { if (current) setStatus('error'); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [search]);
  return <form className="card asset-section asset-form" onSubmit={event => {
    event.preventDefault();
    if (selected) run(() => setRegularDriver(truck.truck_id, truck.updated_at, selected));
  }}><h2>Change Regular Driver</h2>
    <p className="muted">Future defaults only; historical actual drivers remain unchanged.</p>
    <label>Search active drivers by name or phone<input type="search" maxLength={200} value={search}
      onChange={event => { setSearch(event.currentTarget.value); setSelected(''); }} /></label>
    {status === 'loading' && <p role="status">Searching drivers…</p>}
    {status === 'error' && <p role="alert">Driver search failed. Try again.</p>}
    {candidates.length > 0 && <fieldset><legend>Choose Regular Driver (first 25 matches)</legend>
      {candidates.map(driver => <label key={driver.driver_id} className="asset-radio">
        <input type="radio" name="regular-driver" value={driver.driver_id} checked={selected === driver.driver_id}
          onChange={() => setSelected(driver.driver_id)} />{driver.name} · {driver.phone}
      </label>)}
    </fieldset>}
    <button className="button secondary" type="submit" disabled={saving || truck.open_trips > 0 || !selected
      || selected === truck.regular_driver.driver_id}>Set Regular Driver</button>
  </form>;
}

function DriverMasterForm({ driver, run, saving }: { driver: DriverDetail; run: (action: () => Promise<unknown>) => void; saving: boolean }) {
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone);
  const [email, setEmail] = useState(driver.email ?? '');
  const [licenseNumber, setLicenseNumber] = useState(driver.license_number ?? '');
  const [reason, setReason] = useState('record_correction');
  return <form className="card asset-section asset-form" onSubmit={event => {
    event.preventDefault(); run(() => updateDriverMaster(driver.driver_id, driver.updated_at,
      { name, phone, email, licenseNumber, reason }));
  }}><h2>Driver master data</h2><div className="asset-form-grid">
      <label>Full name<input required maxLength={200} value={name} onChange={event => setName(event.currentTarget.value)} /></label>
      <label>Phone<input required maxLength={40} value={phone} onChange={event => setPhone(event.currentTarget.value)} /></label>
      <label>Email<input type="email" maxLength={254} value={email} onChange={event => setEmail(event.currentTarget.value)} /></label>
      <label>Licence number<input maxLength={100} value={licenseNumber} onChange={event => setLicenseNumber(event.currentTarget.value)} /></label>
      <label>Audit reason<select value={reason} onChange={event => setReason(event.currentTarget.value)}>
        <option value="record_correction">Record correction</option><option value="contact_update">Contact update</option>
      </select></label>
    </div><button className="button" type="submit" disabled={saving || driver.open_trips > 0}>Save driver data</button>
  </form>;
}

export function OperationsTruckDetailView({ state, change, onRetry, onRun }: {
  state: DetailState<TruckDetail>; change: ChangeState; onRetry: () => void;
  onRun: (action: () => Promise<unknown>) => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load truck." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Truck not found</h1><Link to="/operations/trucks-drivers/trucks">Back to Trucks</Link></section>;
  const truck = state.data;
  const saving = change.status === 'saving';
  return <div className="asset-page"><AssetTabs /><Link to="/operations/trucks-drivers/trucks">← Trucks</Link>
    <header><p className="eyebrow">Truck master record</p><h1>{truck.plate}</h1></header><ChangeMessage state={change} />
    <section className="card asset-section"><h2>Overview</h2><dl className="asset-facts">
      <Field label="Status">{truck.is_active ? 'Active' : 'Inactive'}</Field>
      <Field label="Type">{truck.truck_type ?? '—'}</Field>
      <Field label="Capacity">{truck.capacity === null ? '—' : `${truck.capacity.toFixed(2)} ${truck.capacity_unit ?? 'tonnes'}`}</Field>
      <Field label="Owner">{truck.owner_name ?? '—'}</Field><Field label="Owner contact">{truck.owner_contact ?? '—'}</Field>
      <Field label="Regular Driver"><Link to={`/operations/trucks-drivers/drivers/${truck.regular_driver.driver_id}`}>
        {truck.regular_driver.name}</Link>{!truck.regular_driver.is_active && ' (inactive)'}</Field>
      <Field label="Registered">{formatDate(truck.registered_at)}</Field><Field label="Trips">{truck.total_trips}</Field>
      <Field label="Open trips">{truck.open_trips}</Field>
    </dl></section>
    {truck.open_trips > 0 && <p className="message" role="status">Master-data and status changes are blocked while this truck has an open trip.</p>}
    <TruckMasterForm key={`master-${truck.updated_at}`} truck={truck} run={onRun} saving={saving} />
    <PlateForm key={`plate-${truck.updated_at}`} truck={truck} run={onRun} saving={saving} />
    <RegularDriverForm key={`regular-${truck.updated_at}`} truck={truck} run={onRun} saving={saving} />
    <form className="card asset-section asset-form" onSubmit={event => {
      event.preventDefault(); onRun(() => setTruckActive(truck.truck_id, truck.updated_at, !truck.is_active));
    }}><h2>{truck.is_active ? 'Deactivate' : 'Reactivate'} truck</h2>
      <p className="muted">Audited status change. Deactivation does not remove historical records.</p>
      <button className="button secondary" type="submit" disabled={saving || truck.open_trips > 0}>
        {truck.is_active ? 'Deactivate truck' : 'Reactivate truck'}</button>
    </form>
    <AssetHistory kind="truck" assetId={truck.truck_id} />
  </div>;
}

export function OperationsDriverDetailView({ state, change, onRetry, onRun }: {
  state: DetailState<DriverDetail>; change: ChangeState; onRetry: () => void;
  onRun: (action: () => Promise<unknown>) => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load driver." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Driver not found</h1><Link to="/operations/trucks-drivers/drivers">Back to Drivers</Link></section>;
  const driver = state.data;
  const saving = change.status === 'saving';
  return <div className="asset-page"><AssetTabs /><Link to="/operations/trucks-drivers/drivers">← Drivers</Link>
    <header><p className="eyebrow">Driver master record</p><h1>{driver.name}</h1></header><ChangeMessage state={change} />
    <section className="card asset-section"><h2>Overview</h2><dl className="asset-facts">
      <Field label="Status">{driver.is_active ? 'Active' : 'Inactive'}</Field>
      <Field label="Phone">{driver.phone}</Field><Field label="Email">{driver.email ?? '—'}</Field>
      <Field label="Licence">{driver.license_number ?? '—'}</Field>
      <Field label="Registered">{formatDate(driver.registered_at)}</Field>
      <Field label="Actual trips">{driver.total_trips}</Field><Field label="Open trips">{driver.open_trips}</Field>
      <Field label="Regular Trucks">{driver.regular_trucks} ({driver.active_regular_trucks} active)</Field>
    </dl>{driver.regular_truck_preview.length > 0 && <ul className="asset-related">
      {driver.regular_truck_preview.map(truck => <li key={truck.truck_id}><Link to={`/operations/trucks-drivers/trucks/${truck.truck_id}`}>
        {truck.plate}</Link>{!truck.is_active && ' (inactive)'}</li>)}
    </ul>}{driver.regular_trucks > 10 && <Link to={`/operations/trucks-drivers/trucks?regularDriver=${driver.driver_id}`}>
      View all Regular Trucks</Link>}</section>
    {driver.open_trips > 0 && <p className="message" role="status">Master-data and status changes are blocked while this driver has an open trip.</p>}
    <DriverMasterForm key={driver.updated_at} driver={driver} run={onRun} saving={saving} />
    <form className="card asset-section asset-form" onSubmit={event => {
      event.preventDefault(); onRun(() => setDriverActive(driver.driver_id, driver.updated_at, !driver.is_active));
    }}><h2>{driver.is_active ? 'Deactivate' : 'Reactivate'} driver</h2>
      <p className="muted">Reassign all active Regular Trucks before deactivating this driver.</p>
      <button className="button secondary" type="submit" disabled={saving || driver.open_trips > 0
        || (driver.is_active && driver.active_regular_trucks > 0)}>
        {driver.is_active ? 'Deactivate driver' : 'Reactivate driver'}</button>
    </form>
    <AssetHistory kind="driver" assetId={driver.driver_id} />
  </div>;
}

export function OperationsTruckDetail() {
  const { truckId = '' } = useParams();
  const { state, refresh, retry } = useDetail(truckId, loadTruckDetail);
  const change = useChange(refresh);
  return <OperationsTruckDetailView state={state} change={change.state} onRetry={retry} onRun={change.run} />;
}

export function OperationsDriverDetail() {
  const { driverId = '' } = useParams();
  const { state, refresh, retry } = useDetail(driverId, loadDriverDetail);
  const change = useChange(refresh);
  return <OperationsDriverDetailView state={state} change={change.state} onRetry={retry} onRun={change.run} />;
}
