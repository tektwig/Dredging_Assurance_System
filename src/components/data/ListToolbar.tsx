import type { ListFilters } from '../../types/listQuery';

export type ListStatusOption = { label: string; value: string };

export function ListToolbar({ filters, onChange, statusOptions = [], showDateRange = false }: {
  filters: ListFilters;
  onChange: (filters: ListFilters) => void;
  statusOptions?: readonly ListStatusOption[];
  showDateRange?: boolean;
}) {
  const hasFilters = Boolean(filters.search || filters.status || filters.dateFrom || filters.dateTo);
  const update = (key: keyof ListFilters, value: string) => onChange({ ...filters, [key]: value });

  return <div className="list-toolbar" role="group" aria-label="List filters">
    <div className="list-toolbar-field">
      <label htmlFor="list-search">Search</label>
      <input id="list-search" type="search" value={filters.search}
        onChange={event => update('search', event.currentTarget.value)} />
    </div>
    {statusOptions.length > 0 && <div className="list-toolbar-field">
      <label htmlFor="list-status">Status</label>
      <select id="list-status" value={filters.status}
        onChange={event => update('status', event.currentTarget.value)}>
        <option value="">All statuses</option>
        {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>}
    {showDateRange && <>
      <div className="list-toolbar-field">
        <label htmlFor="list-date-from">From date</label>
        <input id="list-date-from" type="date" value={filters.dateFrom}
          onChange={event => update('dateFrom', event.currentTarget.value)} />
      </div>
      <div className="list-toolbar-field">
        <label htmlFor="list-date-to">To date</label>
        <input id="list-date-to" type="date" value={filters.dateTo}
          onChange={event => update('dateTo', event.currentTarget.value)} />
      </div>
    </>}
    <button className="button secondary" type="button" disabled={!hasFilters}
      onClick={() => onChange({ search: '', status: '', dateFrom: '', dateTo: '' })}>
      Clear filters
    </button>
  </div>;
}
