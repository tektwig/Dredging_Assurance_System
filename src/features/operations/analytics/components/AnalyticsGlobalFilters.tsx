import { useEffect, useState } from 'react';
import type {
  AnalyticsFilters, AnalyticsOption, AnalyticsOptionKind, AnalyticsOptionPage, AnalyticsPeriod,
} from '../../services/operationsAnalytics';

const selectorFields: Array<{ kind: AnalyticsOptionKind; key: keyof AnalyticsFilters; label: string }> = [
  { kind: 'loading_site', key: 'loading_site_id', label: 'Loading Site' },
  { kind: 'offloading_site', key: 'offloading_site_id', label: 'Offloading Site' },
  { kind: 'truck', key: 'truck_id', label: 'Truck' },
  { kind: 'driver', key: 'driver_id', label: 'Driver' },
];

function dateSpan(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function SearchableOption({ kind, field, value, selected, page, loading, error, onSearch, onSelect, onRetry }: {
  kind: AnalyticsOptionKind; field: string; value: string; selected: AnalyticsOption | null;
  page: AnalyticsOptionPage | null; loading: boolean; error: string; onSearch: (kind: AnalyticsOptionKind, search: string) => void | (() => void);
  onSelect: (kind: AnalyticsOptionKind, option: AnalyticsOption | null) => void; onRetry: (kind: AnalyticsOptionKind) => void;
}) {
  const [search, setSearch] = useState('');
  useEffect(() => {
    let cancelRequest: (() => void) | undefined;
    const timer = window.setTimeout(() => { cancelRequest = onSearch(kind, search) || undefined; }, 250);
    return () => { window.clearTimeout(timer); cancelRequest?.(); };
  }, [kind, onSearch, search]);

  const items = page?.items ?? [];
  const selectedIsListed = items.some(option => option.id === value);
  return <div className="analytics-filter-entity">
    <label htmlFor={`analytics-${kind}-search`}>Search {field.toLowerCase()}</label>
    <input id={`analytics-${kind}-search`} type="search" value={search}
      onChange={event => setSearch(event.currentTarget.value)} autoComplete="off" />
    <label htmlFor={`analytics-${kind}-select`}>{field}</label>
    <select id={`analytics-${kind}-select`} value={value}
      onChange={event => {
        const option = items.find(item => item.id === event.currentTarget.value)
          ?? (selected?.id === event.currentTarget.value ? selected : null);
        onSelect(kind, option);
      }}>
      <option value="">All {field.toLowerCase()}s</option>
      {selected && !selectedIsListed && <option value={selected.id}>{selected.label}{selected.is_active ? '' : ' (inactive)'}</option>}
      {items.map(option => <option key={option.id} value={option.id}>
        {option.label}{option.is_active ? '' : ' (inactive)'}
      </option>)}
    </select>
    {loading && <p className="muted small" role="status">Loading {field.toLowerCase()} options…</p>}
    {error && <div className="analytics-option-error" role="alert">
      <span>{error}</span><button type="button" className="button secondary" onClick={() => onRetry(kind)}>Retry</button>
    </div>}
    {page?.hasMore && <p className="muted small">More matches are available; refine the search.</p>}
  </div>;
}

export function AnalyticsGlobalFilters({ filters, options, selectedOptions, optionsLoading, optionsError,
  today, onChange, onSearchOptions, onSelectOption, onRetryOptions, onReset }: {
  filters: AnalyticsFilters;
  options: Partial<Record<AnalyticsOptionKind, AnalyticsOptionPage>>;
  selectedOptions: Partial<Record<AnalyticsOptionKind, AnalyticsOption>>;
  optionsLoading: Partial<Record<AnalyticsOptionKind, boolean>>;
  optionsError: Partial<Record<AnalyticsOptionKind, string>>;
  today: string;
  onChange: (filters: AnalyticsFilters) => void;
  onSearchOptions: (kind: AnalyticsOptionKind, search: string) => void | (() => void);
  onSelectOption: (kind: AnalyticsOptionKind, option: AnalyticsOption | null) => void;
  onRetryOptions: (kind: AnalyticsOptionKind) => void;
  onReset: () => void;
}) {
  const [draftFrom, setDraftFrom] = useState(filters.date_from ?? '');
  const [draftTo, setDraftTo] = useState(filters.date_to ?? '');
  useEffect(() => {
    setDraftFrom(filters.date_from ?? '');
    setDraftTo(filters.date_to ?? '');
  }, [filters.date_from, filters.date_to]);

  const validDraft = Boolean(draftFrom && draftTo && draftFrom <= draftTo
    && dateSpan(draftFrom, draftTo) <= 90 && draftTo <= today);
  const periodLabels: Record<AnalyticsPeriod, string> = {
    '7_days': '7 Days', '30_days': '30 Days', '90_days': '90 Days', custom: 'Custom',
  };

  return <section className="card analytics-filters" aria-labelledby="analytics-filters-title">
    <div className="analytics-panel-title">
      <div><p className="eyebrow">Global filters</p><h2 id="analytics-filters-title">Filter Analytics</h2></div>
      <button type="button" className="button secondary" onClick={onReset}>Clear filters</button>
    </div>
    <div className="analytics-filter-grid">
      <div className="analytics-filter-entity">
        <label htmlFor="analytics-period">Date Range</label>
        <select id="analytics-period" value={filters.period}
          onChange={event => onChange({ ...filters, period: event.currentTarget.value as AnalyticsPeriod })}>
          {(Object.keys(periodLabels) as AnalyticsPeriod[]).map(period =>
            <option key={period} value={period}>{periodLabels[period]}</option>)}
        </select>
        {filters.period !== 'custom' && <p className="muted small">Dates are resolved using Africa/Lagos operational days.</p>}
      </div>
      {filters.period === 'custom' && <div className="analytics-custom-range">
        <label htmlFor="analytics-date-from">From date</label>
        <input id="analytics-date-from" type="date" max={today} value={draftFrom}
          onChange={event => setDraftFrom(event.currentTarget.value)} />
        <label htmlFor="analytics-date-to">To date</label>
        <input id="analytics-date-to" type="date" max={today} value={draftTo}
          onChange={event => setDraftTo(event.currentTarget.value)} />
        <button type="button" className="button" disabled={!validDraft}
          onClick={() => onChange({ ...filters, date_from: draftFrom, date_to: draftTo })}>Apply dates</button>
        {!validDraft && <p className="muted small" role="status">Choose a complete range of up to 90 past operational days.</p>}
      </div>}
      {selectorFields.map(({ kind, key, label }) => <SearchableOption key={kind} kind={kind} field={label}
        value={String(filters[key] ?? '')} selected={selectedOptions[kind] ?? null}
        page={options[kind] ?? null} loading={Boolean(optionsLoading[kind])} error={optionsError[kind] ?? ''}
        onSearch={onSearchOptions} onSelect={onSelectOption} onRetry={onRetryOptions} />)}
    </div>
  </section>;
}
