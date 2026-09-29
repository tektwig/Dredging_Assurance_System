import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import {
  loadOperationsTrips,
  OPERATIONS_TRIPS_PAGE_SIZE,
  type OperationsTripFilters,
  type OperationsTripsPage,
  type OperationsTripStatus,
} from '../services/operationsTrips';
import './trips.css';

export type OperationsTripsLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: OperationsTripsPage };

export const EMPTY_TRIP_FILTERS: OperationsTripFilters = {
  search: '', status: '', dateFrom: '', dateTo: '', truck: '', driver: '', loadingSite: '', offloadingSite: '',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

function formatTonnage(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} t`;
}

function statusLabel(status: OperationsTripStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

function TripFilters({ filters, onChange }: {
  filters: OperationsTripFilters;
  onChange: (value: OperationsTripFilters) => void;
}) {
  const update = (key: keyof OperationsTripFilters, value: string) => onChange({ ...filters, [key]: value });
  const hasFilters = Object.values(filters).some(Boolean);
  return <form className="trip-filter-panel" aria-label="Trip register filters" onSubmit={event => event.preventDefault()}>
    <div className="trip-filter-grid">
      <div className="trip-filter-field trip-filter-search">
        <label htmlFor="trip-search">Search trip number, plate or driver</label>
        <input id="trip-search" type="search" value={filters.search}
          onChange={event => update('search', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-status">Status</label>
        <select id="trip-status" value={filters.status}
          onChange={event => update('status', event.currentTarget.value as OperationsTripFilters['status'])}>
          <option value="">All statuses</option>
          <option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-date-from">Opened from (Lagos date)</label>
        <input id="trip-date-from" type="date" value={filters.dateFrom}
          onChange={event => update('dateFrom', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-date-to">Opened to (inclusive)</label>
        <input id="trip-date-to" type="date" value={filters.dateTo}
          onChange={event => update('dateTo', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-truck-filter">Truck plate contains</label>
        <input id="trip-truck-filter" value={filters.truck}
          onChange={event => update('truck', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-driver-filter">Driver name contains</label>
        <input id="trip-driver-filter" value={filters.driver}
          onChange={event => update('driver', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-loading-site-filter">Loading site contains</label>
        <input id="trip-loading-site-filter" value={filters.loadingSite}
          onChange={event => update('loadingSite', event.currentTarget.value)} />
      </div>
      <div className="trip-filter-field">
        <label htmlFor="trip-offloading-site-filter">Offloading site contains</label>
        <input id="trip-offloading-site-filter" value={filters.offloadingSite}
          onChange={event => update('offloadingSite', event.currentTarget.value)} />
      </div>
    </div>
    <button className="button secondary" type="button" disabled={!hasFilters}
      onClick={() => onChange({ ...EMPTY_TRIP_FILTERS })}>Clear filters</button>
  </form>;
}

export function OperationsTripsRegisterView({ state, filters, page, onFiltersChange, onPageChange, onRetry }: {
  state: OperationsTripsLoadState;
  filters: OperationsTripFilters;
  page: number;
  onFiltersChange: (filters: OperationsTripFilters) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}) {
  return <div className="operations-trips-page">
    <header className="operations-trips-header">
      <div><p className="eyebrow">System-wide register</p><h1>Trips</h1></div>
      <p className="muted">Search, filters, and pagination are applied server-side. Dates use Africa/Lagos opened-at days.</p>
    </header>
    <TripFilters filters={filters} onChange={onFiltersChange} />
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load the trip register." onRetry={onRetry} />}
    {state.status === 'ready' && state.data.items.length === 0 && <ListResultState status="empty" message="No trips match these filters." />}
    {state.status === 'ready' && state.data.items.length > 0 && <>
      <div className="operations-table-scroll card trip-register-table">
        <table className="operations-table">
          <thead><tr><th scope="col">Trip #</th><th scope="col">Plate</th><th scope="col">Driver</th>
            <th scope="col">Loading Site</th><th scope="col">Opened At</th><th scope="col">Offloading Site</th>
            <th scope="col">Closed At</th><th scope="col">Tonnage</th><th scope="col">Status</th></tr></thead>
          <tbody>{state.data.items.map(trip => <tr key={trip.trip_id}>
            <td><Link to={`/operations/trips/${trip.trip_id}`}>{trip.trip_number}</Link></td>
            <td>{trip.truck_registration}</td><td>{trip.driver_name}</td><td>{trip.loading_site_name}</td>
            <td><time dateTime={trip.opened_at}>{formatDate(trip.opened_at)}</time></td>
            <td>{trip.offloading_site_name ?? '—'}</td>
            <td>{trip.closed_at ? <time dateTime={trip.closed_at}>{formatDate(trip.closed_at)}</time> : '—'}</td>
            <td>{formatTonnage(trip.quantity_tonnes)}</td>
            <td><span className={`trip-status-badge trip-status-${trip.status}`}>{statusLabel(trip.status)}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={onPageChange} />
    </>}
  </div>;
}

export function OperationsTripsRegister() {
  const [filters, setFilters] = useState<OperationsTripFilters>({ ...EMPTY_TRIP_FILTERS });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<OperationsTripsLoadState>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      void loadOperationsTrips(filters, page, OPERATIONS_TRIPS_PAGE_SIZE).then(data => {
        if (current) setState({ status: 'ready', data });
      }).catch(() => {
        if (current) setState({ status: 'error' });
      });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, revision]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const lastPage = Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [state, page]);

  const changeFilters = (next: OperationsTripFilters) => {
    setFilters(next);
    setPage(1);
  };

  return <OperationsTripsRegisterView state={state} filters={filters} page={page}
    onFiltersChange={changeFilters} onPageChange={setPage} onRetry={() => setRevision(value => value + 1)} />;
}
