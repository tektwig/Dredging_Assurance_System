import { useCallback, useEffect, useState } from 'react';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import { DEFAULT_PAGE_SIZE } from '../../../types/listQuery';
import { downloadReport, exportOperationsReport, loadOperationsReport, OPERATIONS_REPORT_KINDS,
  reportColumnsFor, type OperationsReportKind, type OperationsReportPage, type ReportFilters } from '../services/operationsReports';
import './reports.css';

const labels: Record<OperationsReportKind, string> = {
  trips: 'Trips', performance: 'Performance', waybills: 'Waybills & Payouts', exceptions: 'Exceptions',
};

function lagosToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
}

function lastThirtyDays() {
  const end = lagosToday();
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  return { date_from: startDate.toISOString().slice(0, 10), date_to: end };
}

function initialFilters(kind: OperationsReportKind): ReportFilters {
  const dates = lastThirtyDays();
  if (kind === 'trips') return { ...dates, basis: 'opened' };
  if (kind === 'performance') return { ...dates, dimension: 'truck' };
  return dates;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && Number.isFinite(Date.parse(value)) && /T/.test(value)) {
    return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(value));
  }
  return String(value);
}

function Filters({ kind, filters, change }: { kind: OperationsReportKind; filters: ReportFilters; change: (key: string, value: string | boolean) => void }) {
  const dateRange = kind !== 'trips' || filters.basis !== 'open';
  return <div className="card operations-report-filters" aria-label={`${labels[kind]} filters`}>
    {kind === 'trips' && <label>Trip event
      <select value={String(filters.basis ?? 'opened')} onChange={event => change('basis', event.currentTarget.value)}>
        <option value="opened">Opened</option><option value="closed">Closed</option>
        <option value="cancelled">Cancelled</option><option value="open">Currently open</option>
      </select>
    </label>}
    {kind === 'performance' && <>
      <label>Group by<select value={String(filters.dimension ?? 'truck')} onChange={event => change('dimension', event.currentTarget.value)}>
        <option value="truck">Truck</option><option value="driver">Driver</option><option value="site">Site</option>
      </select></label>
      {filters.dimension === 'site' && <label>Site activity
        <select value={String(filters.direction ?? 'loading')} onChange={event => change('direction', event.currentTarget.value)}>
          <option value="loading">Loading</option><option value="offloading">Offloading</option>
        </select>
      </label>}
    </>}
    {dateRange && <>
      <label>From<input type="date" value={String(filters.date_from ?? '')} onChange={event => change('date_from', event.currentTarget.value)} /></label>
      <label>To<input type="date" value={String(filters.date_to ?? '')} onChange={event => change('date_to', event.currentTarget.value)} /></label>
    </>}
    {kind === 'trips' && <>
      <label>Status<select value={String(filters.status ?? '')} onChange={event => change('status', event.currentTarget.value)}>
        <option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option>
      </select></label>
      <label>Truck ID<input value={String(filters.truck_id ?? '')} onChange={event => change('truck_id', event.currentTarget.value)} /></label>
      <label>Driver ID<input value={String(filters.driver_id ?? '')} onChange={event => change('driver_id', event.currentTarget.value)} /></label>
      <label>Loading Site ID<input value={String(filters.loading_site_id ?? '')} onChange={event => change('loading_site_id', event.currentTarget.value)} /></label>
      <label>Offloading Site ID<input value={String(filters.offloading_site_id ?? '')} onChange={event => change('offloading_site_id', event.currentTarget.value)} /></label>
    </>}
    {kind === 'performance' && filters.dimension !== 'site' && <>
      {filters.dimension === 'truck' && <label>Truck ID<input value={String(filters.truck_id ?? '')} onChange={event => change('truck_id', event.currentTarget.value)} /></label>}
      {filters.dimension === 'driver' && <label>Driver ID<input value={String(filters.driver_id ?? '')} onChange={event => change('driver_id', event.currentTarget.value)} /></label>}
    </>}
    {kind === 'performance' && filters.dimension === 'site' && <label>Site ID<input value={String(filters.site_id ?? '')} onChange={event => change('site_id', event.currentTarget.value)} /></label>}
    {kind === 'waybills' && <>
      <label>PDF status<select value={String(filters.pdf_status ?? '')} onChange={event => change('pdf_status', event.currentTarget.value)}>
        <option value="">All</option>{['pending', 'processing', 'ready', 'failed'].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Delivery status<select value={String(filters.delivery_status ?? '')} onChange={event => change('delivery_status', event.currentTarget.value)}>
        <option value="">All</option>{['pending', 'processing', 'sent', 'failed', 'not_queued', 'not_applicable'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
      </select></label>
      <label>Payout status<select value={String(filters.payout_status ?? '')} onChange={event => change('payout_status', event.currentTarget.value)}>
        <option value="">All</option>{['payment_details_required', 'pending', 'paid'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
      </select></label>
    </>}
    {kind === 'exceptions' && <>
      <label>Type<select value={String(filters.exception_type ?? '')} onChange={event => change('exception_type', event.currentTarget.value)}>
        <option value="">All types</option>{['unknown_truck', 'invalid_driver', 'open_trip_conflict', 'offloading_mismatch', 'invalid_state', 'dispute']
          .map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
      </select></label>
      <label>Status<select value={String(filters.status ?? '')} onChange={event => change('status', event.currentTarget.value)}>
        <option value="">All statuses</option>{['open', 'in_review', 'resolved'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
      </select></label>
      <label>Blocking<select value={String(filters.blocks_operations ?? '')} onChange={event =>
        change('blocks_operations', event.currentTarget.value === '' ? '' : event.currentTarget.value === 'true')}>
        <option value="">All</option><option value="true">Blocking</option><option value="false">Non-blocking</option>
      </select></label>
    </>}
    <button type="button" className="button secondary" onClick={() => {
      const defaults = initialFilters(kind);
      Object.keys({ ...filters, ...defaults }).forEach(key => change(key, defaults[key] ?? ''));
    }}>Clear filters</button>
  </div>;
}

function ReportTable({ kind, page }: { kind: OperationsReportKind; page: OperationsReportPage }) {
  const columns = reportColumnsFor(kind);
  return <div className="table-scroll"><table><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{page.items.map((row, index) => <tr key={String(row.trip_id ?? row.waybill_id ?? row.entity_id ?? `${row.exception_type}-${row.status}-${index}`)}>
      {columns.map(([key]) => <td key={key}>{formatValue(row[key])}</td>)}
    </tr>)}</tbody></table></div>;
}

export function OperationsReportsView({ kind, onKindChange, filters, changeFilter, state, page, onPageChange, onRetry,
  exporting, exportError, onExport }: {
  kind: OperationsReportKind; onKindChange: (kind: OperationsReportKind) => void; filters: ReportFilters;
  changeFilter: (key: string, value: string | boolean) => void;
  state: { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsReportPage };
  page: number; onPageChange: (page: number) => void; onRetry: () => void; exporting: boolean;
  exportError: string; onExport: (format: 'csv' | 'xlsx') => void;
}) {
  return <main className="operations-reports-page"><header><p className="eyebrow">Operational reporting</p><h1>Reports</h1></header>
    <div className="report-tabs" role="tablist" aria-label="Report categories">
      {OPERATIONS_REPORT_KINDS.map(value => <button key={value} type="button" role="tab" aria-selected={kind === value}
        onClick={() => onKindChange(value)}>{labels[value]}</button>)}
    </div>
    <Filters key={kind} kind={kind} filters={filters} change={changeFilter} />
    <section aria-label={`${labels[kind]} results`}>
      {state.status === 'loading' ? <ListResultState status="loading" /> : state.status === 'error'
        ? <ListResultState status="error" message="Unable to load report results." onRetry={onRetry} /> : <>
        <div className="report-summary" aria-label="Report summary">{Object.entries(state.data.summary).map(([key, value]) =>
          <div className="card" key={key}><span>{key.replace(/_/g, ' ')}</span><strong>{value.toLocaleString('en-NG')}</strong></div>)}</div>
        {state.data.items.length === 0 ? <p className="empty-state">No report results match these filters.</p> : <ReportTable kind={kind} page={state.data} />}
        <PaginationControls page={page} pageSize={DEFAULT_PAGE_SIZE} totalCount={state.data.totalCount} onPageChange={onPageChange} />
      </>}
    </section>
    <div className="report-export-actions"><button className="button secondary" type="button" disabled={exporting} onClick={() => onExport('csv')}>{exporting ? 'Preparing…' : 'Export CSV'}</button>
      <button className="button secondary" type="button" disabled={exporting} onClick={() => onExport('xlsx')}>{exporting ? 'Preparing…' : 'Export Excel'}</button>
      {exportError && <p role="alert">{exportError}</p>}</div>
  </main>;
}

export function OperationsReports() {
  const [kind, setKind] = useState<OperationsReportKind>('trips');
  const [filters, setFilters] = useState<ReportFilters>(() => initialFilters('trips'));
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsReportPage }>({ status: 'loading' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const load = useCallback(() => {
    let active = true;
    setState({ status: 'loading' });
    void loadOperationsReport(kind, filters, page).then(data => {
      if (active) setState({ status: 'ready', data });
    }).catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [kind, filters, page]);
  useEffect(() => load(), [load]);
  const changeFilter = (key: string, value: string | boolean) => {
    setFilters(current => {
      const next = { ...current };
      if (value === '' || value === false && key !== 'blocks_operations') delete next[key]; else next[key] = value;
      if (key === 'dimension') { delete next.site_id; delete next.truck_id; delete next.driver_id; delete next.direction; if (value === 'site') next.direction = 'loading'; }
      if (key === 'basis' && value === 'open') { delete next.date_from; delete next.date_to; }
      if (key === 'basis' && value !== 'open' && !next.date_from) Object.assign(next, lastThirtyDays());
      return next;
    });
    setPage(1);
  };
  const changeKind = (nextKind: OperationsReportKind) => { setKind(nextKind); setFilters(initialFilters(nextKind)); setPage(1); setExportError(''); };
  const exportFile = async (format: 'csv' | 'xlsx') => {
    if (exporting) return;
    setExporting(true); setExportError('');
    try { await downloadReport(await exportOperationsReport(kind, filters, format)); }
    catch (error) { setExportError(error instanceof Error ? error.message : 'Unable to export report'); }
    finally { setExporting(false); }
  };
  return <OperationsReportsView kind={kind} onKindChange={changeKind} filters={filters} changeFilter={changeFilter}
    state={state} page={page} onPageChange={setPage} onRetry={() => void load()} exporting={exporting}
    exportError={exportError} onExport={format => void exportFile(format)} />;
}
