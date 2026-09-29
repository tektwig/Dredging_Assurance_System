import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import { loadWaybills, type Page, type WaybillFilters, type WaybillRow } from '../services/operationsWaybills';
import './waybills.css';

export const EMPTY_WAYBILL_FILTERS: WaybillFilters = {
  search: '', quickFilter: '', dateFrom: '', dateTo: '', pdfStatus: '', deliveryStatus: '', payoutStatus: '',
};

export function formatLagosDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })
    .format(new Date(value)) : '—';
}

type State = { status: 'loading' | 'error' } | { status: 'ready'; data: Page<WaybillRow> };

export function OperationsWaybillsRegisterView({ state, filters, page, onFiltersChange, onPageChange, onRetry }: {
  state: State; filters: WaybillFilters; page: number;
  onFiltersChange: (filters: WaybillFilters) => void; onPageChange: (page: number) => void; onRetry: () => void;
}) {
  const update = (key: keyof WaybillFilters, value: string) => onFiltersChange({ ...filters, [key]: value });
  return <div className="operations-waybills-page">
    <header><p className="eyebrow">Closed trip lifecycle</p><h1>Waybills &amp; Payouts</h1>
      <p className="muted">Server-side register. Date filters use Africa/Lagos closed-at days.</p></header>
    <form className="card waybill-filters" aria-label="Waybill filters" onSubmit={event => event.preventDefault()}>
      <label>Search Waybill, trip, plate or driver<input type="search" value={filters.search}
        onChange={event => update('search', event.currentTarget.value)} /></label>
      <label>Quick filter<select value={filters.quickFilter} onChange={event => update('quickFilter', event.currentTarget.value)}>
        <option value="">All</option><option value="awaiting_payment">Awaiting Payment</option>
        <option value="paid">Paid</option><option value="payment_details_required">Payment Details Required</option>
        <option value="waybill_failed">Waybill Failed</option><option value="delivery_failed">Delivery Failed</option>
      </select></label>
      <label>Closed from<input type="date" value={filters.dateFrom} onChange={event => update('dateFrom', event.currentTarget.value)} /></label>
      <label>Closed to (inclusive)<input type="date" value={filters.dateTo} onChange={event => update('dateTo', event.currentTarget.value)} /></label>
      <label>PDF status<select value={filters.pdfStatus} onChange={event => update('pdfStatus', event.currentTarget.value)}>
        <option value="">All</option>{['pending','processing','ready','failed'].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Delivery status<select value={filters.deliveryStatus} onChange={event => update('deliveryStatus', event.currentTarget.value)}>
        <option value="">All</option>{['not_queued','pending','processing','sent','failed'].map(value => <option key={value} value={value}>{value.replace('_',' ')}</option>)}
      </select></label>
      <label>Payout status<select value={filters.payoutStatus} onChange={event => update('payoutStatus', event.currentTarget.value)}>
        <option value="">All</option>{['payment_details_required','pending','paid'].map(value => <option key={value} value={value}>{value.replace(/_/g,' ')}</option>)}
      </select></label>
      <button className="button secondary" type="button" disabled={!Object.values(filters).some(Boolean)}
        onClick={() => onFiltersChange({ ...EMPTY_WAYBILL_FILTERS })}>Clear filters</button>
    </form>
    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load Waybills." onRetry={onRetry} />}
    {state.status === 'ready' && !state.data.items.length && <ListResultState status="empty" message="No Waybills match these filters." />}
    {state.status === 'ready' && state.data.items.length > 0 && <>
      <div className="operations-table-scroll card"><table className="operations-table">
        <thead><tr><th>Waybill #</th><th>Trip #</th><th>Truck</th><th>Driver</th><th>Tonnage</th>
          <th>Waybill Status</th><th>Delivery Status</th><th>Payout Status</th><th>Closed At</th></tr></thead>
        <tbody>{state.data.items.map(row => <tr key={row.invoice_id}>
          <td><Link to={`/operations/waybills-payouts/${row.invoice_id}`}>{row.invoice_number}</Link></td>
          <td><Link to={`/operations/trips/${row.trip_id}`}>{row.trip_number}</Link></td>
          <td>{row.truck_registration}</td><td>{row.driver_name}</td><td>{row.quantity_tonnes.toFixed(2)} t</td>
          <td>Issued · PDF {row.pdf_status}</td>
          <td>Driver: {row.driver_delivery_status ?? 'not queued'}<br />Internal: {row.internal_delivery_status ?? 'not queued'}</td>
          <td>{row.payout_status.replace(/_/g,' ')}</td><td>{formatLagosDate(row.closed_at)}</td>
        </tr>)}</tbody>
      </table></div>
      <PaginationControls page={page} pageSize={state.data.pageSize} totalCount={state.data.totalCount} onPageChange={onPageChange} />
    </>}
  </div>;
}

export function OperationsWaybillsRegister() {
  const [filters, setFilters] = useState<WaybillFilters>({ ...EMPTY_WAYBILL_FILTERS });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      void loadWaybills(filters, page).then(data => { if (current) setState({ status: 'ready', data }); })
        .catch(() => { if (current) setState({ status: 'error' }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, revision]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const lastPage = Math.max(1, Math.ceil(state.data.totalCount / state.data.pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [state, page]);
  return <OperationsWaybillsRegisterView state={state} filters={filters} page={page}
    onFiltersChange={next => { setFilters(next); setPage(1); }} onPageChange={setPage}
    onRetry={() => setRevision(value => value + 1)} />;
}
