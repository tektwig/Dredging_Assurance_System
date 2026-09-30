import { useEffect, useState } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import { loadDrivers, loadTrucks, type AssetFilters, type AssetPage, type DriverRow, type TruckRow } from '../services/operationsAssets';
import './assets.css';

type ListState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AssetPage<T> };
const initialFilters: AssetFilters = { search: '', active: 'all' };

export function AssetTabs() {
  return <nav className="asset-tabs" aria-label="Trucks and drivers">
    <NavLink to="/operations/trucks-drivers/trucks" className={({ isActive }) => isActive ? 'asset-tab active' : 'asset-tab'}>Trucks</NavLink>
    <NavLink to="/operations/trucks-drivers/drivers" className={({ isActive }) => isActive ? 'asset-tab active' : 'asset-tab'}>Drivers</NavLink>
  </nav>;
}

function Filters({ kind, filters, onChange, regularDriverId }: {
  kind: 'truck' | 'driver'; filters: AssetFilters; onChange: (next: AssetFilters) => void;
  regularDriverId?: string | null;
}) {
  return <form className="asset-filters card" aria-label={`${kind} filters`} onSubmit={event => event.preventDefault()}>
    <label>Search {kind === 'truck' ? 'plate' : 'name or phone'}
      <input type="search" value={filters.search} maxLength={kind === 'truck' ? 64 : 200}
        onChange={event => onChange({ ...filters, search: event.currentTarget.value })} />
    </label>
    <label>Status<select value={filters.active} onChange={event => onChange({ ...filters, active: event.currentTarget.value as AssetFilters['active'] })}>
      <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
    </select></label>
    <button className="button secondary" type="button" disabled={!filters.search && filters.active === 'all'}
      onClick={() => onChange({ ...initialFilters })}>Clear filters</button>
    {regularDriverId && <Link to="/operations/trucks-drivers/trucks">Clear Regular Driver filter</Link>}
  </form>;
}

export function OperationsTrucksListView({ state, filters, page, onFiltersChange, onPageChange, onRetry, regularDriverId }: {
  state: ListState<TruckRow>; filters: AssetFilters; page: number; onFiltersChange: (next: AssetFilters) => void;
  onPageChange: (page: number) => void; onRetry: () => void; regularDriverId?: string | null;
}) {
  return <div className="asset-page"><AssetTabs /><header><p className="eyebrow">System-wide master data</p><h1>Trucks</h1></header>
    <Filters kind="truck" filters={filters} onChange={onFiltersChange} regularDriverId={regularDriverId} />
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load trucks." onRetry={onRetry} />}
    {state.status === 'ready' && state.data.items.length === 0 && <ListResultState status="empty" message="No trucks match these filters." />}
    {state.status === 'ready' && state.data.items.length > 0 && <><div className="operations-table-scroll card">
      <table className="operations-table"><thead><tr><th scope="col">Plate</th><th scope="col">Type</th><th scope="col">Capacity</th>
        <th scope="col">Regular Driver</th><th scope="col">Status</th><th scope="col">Registered</th>
        <th scope="col">Trips</th><th scope="col">Open</th><th scope="col">Last Activity</th></tr></thead>
        <tbody>{state.data.items.map(truck => <tr key={truck.truck_id}>
          <td><Link to={`/operations/trucks-drivers/trucks/${truck.truck_id}`}>{truck.plate}</Link></td>
          <td>{truck.truck_type ?? '—'}</td><td>{truck.capacity === null ? '—' : `${truck.capacity.toFixed(2)} ${truck.capacity_unit ?? 'tonnes'}`}</td>
          <td><Link to={`/operations/trucks-drivers/drivers/${truck.regular_driver_id}`}>{truck.regular_driver_name}</Link></td>
          <td>{truck.is_active ? 'Active' : 'Inactive'}</td><td>{formatDate(truck.registered_at)}</td>
          <td>{truck.total_trips}</td><td>{truck.open_trips}</td><td>{formatDate(truck.last_trip_at)}</td>
        </tr>)}</tbody></table></div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={onPageChange} />
    </>}
  </div>;
}

export function OperationsDriversListView({ state, filters, page, onFiltersChange, onPageChange, onRetry }: {
  state: ListState<DriverRow>; filters: AssetFilters; page: number; onFiltersChange: (next: AssetFilters) => void;
  onPageChange: (page: number) => void; onRetry: () => void;
}) {
  return <div className="asset-page"><AssetTabs /><header><p className="eyebrow">System-wide master data</p><h1>Drivers</h1></header>
    <Filters kind="driver" filters={filters} onChange={onFiltersChange} />
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load drivers." onRetry={onRetry} />}
    {state.status === 'ready' && state.data.items.length === 0 && <ListResultState status="empty" message="No drivers match these filters." />}
    {state.status === 'ready' && state.data.items.length > 0 && <><div className="operations-table-scroll card">
      <table className="operations-table"><thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th>
        <th scope="col">Regular Trucks</th><th scope="col">Status</th><th scope="col">Registered</th>
        <th scope="col">Trips</th><th scope="col">Open</th><th scope="col">Last Activity</th></tr></thead>
        <tbody>{state.data.items.map(driver => <tr key={driver.driver_id}>
          <td><Link to={`/operations/trucks-drivers/drivers/${driver.driver_id}`}>{driver.name}</Link></td>
          <td>{driver.phone}</td><td>{driver.email ?? '—'}</td><td>{driver.regular_trucks}</td>
          <td>{driver.is_active ? 'Active' : 'Inactive'}</td><td>{formatDate(driver.registered_at)}</td>
          <td>{driver.total_trips}</td><td>{driver.open_trips}</td><td>{formatDate(driver.last_trip_at)}</td>
        </tr>)}</tbody></table></div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={onPageChange} />
    </>}
  </div>;
}

export function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(value)) : '—';
}

export function OperationsTrucksList() {
  const [query] = useSearchParams();
  const regularDriverId = query.get('regularDriver');
  const [filters, setFilters] = useState<AssetFilters>({ ...initialFilters });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ListState<TruckRow>>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      void loadTrucks(filters, page, regularDriverId ?? undefined).then(data => { if (current) setState({ status: 'ready', data }); })
        .catch(() => { if (current) setState({ status: 'error' }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, regularDriverId, revision]);
  useEffect(() => {
    if (state.status === 'ready' && page > Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize)))
      setPage(Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize)));
  }, [state, page]);
  return <OperationsTrucksListView state={state} filters={filters} page={page} regularDriverId={regularDriverId}
    onFiltersChange={next => { setFilters(next); setPage(1); }} onPageChange={setPage} onRetry={() => setRevision(value => value + 1)} />;
}

export function OperationsDriversList() {
  const [filters, setFilters] = useState<AssetFilters>({ ...initialFilters });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ListState<DriverRow>>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      void loadDrivers(filters, page).then(data => { if (current) setState({ status: 'ready', data }); })
        .catch(() => { if (current) setState({ status: 'error' }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, revision]);
  useEffect(() => {
    if (state.status === 'ready' && page > Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize)))
      setPage(Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize)));
  }, [state, page]);
  return <OperationsDriversListView state={state} filters={filters} page={page}
    onFiltersChange={next => { setFilters(next); setPage(1); }} onPageChange={setPage} onRetry={() => setRevision(value => value + 1)} />;
}
