import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import { EXCEPTION_STATUSES, EXCEPTION_TYPES, loadExceptions,
  type ExceptionFilters, type ExceptionPage } from '../services/operationsExceptions';
import './exceptions.css';

export const EMPTY_EXCEPTION_FILTERS: ExceptionFilters = {
  search: '', status: '', type: '', dateFrom: '', dateTo: '', tripId: '', truckId: '',
};
export type ExceptionsState = { status: 'loading' | 'error' } | { status: 'ready'; data: ExceptionPage };
export const exceptionLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
export const formatExceptionDate = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));

export function OperationsExceptionsRegisterView({ state, filters, page, onFiltersChange, onPageChange, onRetry }: {
  state: ExceptionsState; filters: ExceptionFilters; page: number;
  onFiltersChange: (value: ExceptionFilters) => void; onPageChange: (value: number) => void; onRetry: () => void;
}) {
  const change = (key: keyof ExceptionFilters, value: string) => onFiltersChange({ ...filters, [key]: value });
  return <div className="operations-exceptions-page">
    <header><p className="eyebrow">System-wide problem management</p><h1>Exceptions</h1></header>
    <form className="exception-filters card" aria-label="Exception register filters" onSubmit={event => event.preventDefault()}>
      <label>Search exception ID, trip, plate or driver<input type="search" value={filters.search}
        onChange={event => change('search', event.currentTarget.value)} /></label>
      <label>Status<select value={filters.status} onChange={event => change('status', event.currentTarget.value)}>
        <option value="">All statuses</option>{EXCEPTION_STATUSES.map(status =>
          <option key={status} value={status}>{exceptionLabel(status)}</option>)}</select></label>
      <label>Type<select value={filters.type} onChange={event => change('type', event.currentTarget.value)}>
        <option value="">All types</option>{EXCEPTION_TYPES.map(type =>
          <option key={type} value={type}>{exceptionLabel(type)}</option>)}</select></label>
      <label>Created from (Lagos)<input type="date" value={filters.dateFrom}
        onChange={event => change('dateFrom', event.currentTarget.value)} /></label>
      <label>Created to (inclusive)<input type="date" value={filters.dateTo}
        onChange={event => change('dateTo', event.currentTarget.value)} /></label>
      <label>Trip ID<input value={filters.tripId} onChange={event => change('tripId', event.currentTarget.value)} /></label>
      <label>Truck ID<input value={filters.truckId} onChange={event => change('truckId', event.currentTarget.value)} /></label>
      <button className="button secondary" type="button" disabled={!Object.values(filters).some(Boolean)}
        onClick={() => onFiltersChange({ ...EMPTY_EXCEPTION_FILTERS })}>Clear filters</button>
    </form>
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load Exceptions." onRetry={onRetry} />}
    {state.status === 'ready' && !state.data.items.length && <ListResultState status="empty" message="No Exceptions match these filters." />}
    {state.status === 'ready' && state.data.items.length > 0 && <>
      <div className="operations-table-scroll card"><table className="operations-table">
        <thead><tr><th>Exception</th><th>Type</th><th>Related Trip</th><th>Truck</th><th>Driver</th>
          <th>Status</th><th>Blocks Operations</th><th>Created At</th><th>Updated At</th></tr></thead>
        <tbody>{state.data.items.map(item => <tr key={item.exception_id}>
          <td><Link to={`/operations/exceptions/${item.exception_id}`}>{item.exception_id.slice(0, 8)}</Link></td>
          <td>{exceptionLabel(item.exception_type)}</td><td>{item.trip_number ?? '—'}</td>
          <td>{item.truck_registration ?? '—'}</td><td>{item.driver_name ?? '—'}</td>
          <td>{exceptionLabel(item.status)}</td><td>{item.blocks_operations ? 'Yes' : 'No'}</td>
          <td><time dateTime={item.created_at}>{formatExceptionDate(item.created_at)}</time></td>
          <td><time dateTime={item.updated_at}>{formatExceptionDate(item.updated_at)}</time></td>
        </tr>)}</tbody>
      </table></div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={onPageChange} />
    </>}
  </div>;
}

export function OperationsExceptionsRegister() {
  const [filters, setFilters] = useState<ExceptionFilters>({ ...EMPTY_EXCEPTION_FILTERS });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ExceptionsState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      void loadExceptions(filters, page).then(data => { if (current) setState({ status: 'ready', data }); })
        .catch(() => { if (current) setState({ status: 'error' }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, revision]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const lastPage = Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [state, page]);
  return <OperationsExceptionsRegisterView state={state} filters={filters} page={page}
    onFiltersChange={value => { setFilters(value); setPage(1); }} onPageChange={setPage}
    onRetry={() => setRevision(value => value + 1)} />;
}
