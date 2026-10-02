import { useCallback, useEffect, useState } from 'react';
import { ListResultState } from '../../../components/data/ListResultState';
import {
  loadOperationsAnalytics, loadOperationsAnalyticsOptions,
  type AnalyticsFilters, type AnalyticsOption, type AnalyticsOptionKind, type AnalyticsOptionPage,
  type OperationsAnalyticsData, type PerformanceDimension, type PerformanceMetric,
} from '../services/operationsAnalytics';
import { AnalyticsGlobalFilters } from './components/AnalyticsGlobalFilters';
import {
  AnalyticsKpiGrid, AnalyticsPerformance, AnalyticsStatusDistribution, AnalyticsTrends, AnalyticsVariance,
} from './components/AnalyticsVisualizations';
import './analytics.css';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsAnalyticsData };

function todayInLagos(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })
    .format(new Date(value));
}

export function OperationsAnalyticsView({ state, filters, options, selectedOptions, optionsLoading, optionsError,
  today, dimension, metric, onChangeFilters, onSearchOptions, onSelectOption, onRetryOptions,
  onResetFilters, onDimension, onMetric, onRetry }: {
  state: LoadState; filters: AnalyticsFilters;
  options: Partial<Record<AnalyticsOptionKind, AnalyticsOptionPage>>;
  selectedOptions: Partial<Record<AnalyticsOptionKind, AnalyticsOption>>;
  optionsLoading: Partial<Record<AnalyticsOptionKind, boolean>>;
  optionsError: Partial<Record<AnalyticsOptionKind, string>>;
  today: string; dimension: PerformanceDimension; metric: PerformanceMetric;
  onChangeFilters: (filters: AnalyticsFilters) => void;
  onSearchOptions: (kind: AnalyticsOptionKind, search: string) => void | (() => void);
  onSelectOption: (kind: AnalyticsOptionKind, option: AnalyticsOption | null) => void;
  onRetryOptions: (kind: AnalyticsOptionKind) => void;
  onResetFilters: () => void;
  onDimension: (dimension: PerformanceDimension) => void;
  onMetric: (metric: PerformanceMetric) => void;
  onRetry: () => void;
}) {
  const readyData = state.status === 'ready' ? state.data : null;
  return <main className="operations-analytics-page">
    <header className="analytics-page-header">
      <div><p className="eyebrow">Operational patterns</p><h1>Analytics Centre</h1>
        <p className="muted">Explore trip activity, performance, status mix, and descriptive tonnage variance over time.</p></div>
      {readyData && <p className="analytics-as-of">As of {formatTimestamp(readyData.as_of)}<br />
        {readyData.range_start} to {readyData.range_end} · {readyData.time_zone}</p>}
    </header>

    <AnalyticsGlobalFilters key={filters.period === 'custom' ? 'custom' : 'preset'} filters={filters}
      options={options} selectedOptions={selectedOptions} optionsLoading={optionsLoading} optionsError={optionsError}
      today={today} onChange={onChangeFilters} onSearchOptions={onSearchOptions} onSelectOption={onSelectOption}
      onRetryOptions={onRetryOptions} onReset={onResetFilters} />

    {state.status === 'loading' && <ListResultState status="loading" />}
    {state.status === 'error' && <ListResultState status="error" message="Unable to load Operations Analytics." onRetry={onRetry} />}
    {readyData && <div className="analytics-results">
      <AnalyticsKpiGrid data={readyData} />
      <AnalyticsTrends data={readyData} />
      <AnalyticsPerformance data={readyData} dimension={dimension} metric={metric}
        onDimension={onDimension} onMetric={onMetric} />
      <AnalyticsStatusDistribution data={readyData} />
      <AnalyticsVariance data={readyData} />
      <p className="muted small analytics-footnote">Each measure uses its stated event-date cohort. Variance is Actual Tonnage minus Estimated Tonnage for paired closed trips only.</p>
    </div>}
  </main>;
}

export function OperationsAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>({ period: '30_days' });
  const [dimension, setDimension] = useState<PerformanceDimension>('truck');
  const [metric, setMetric] = useState<PerformanceMetric>('trips');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [options, setOptions] = useState<Partial<Record<AnalyticsOptionKind, AnalyticsOptionPage>>>({});
  const [selectedOptions, setSelectedOptions] = useState<Partial<Record<AnalyticsOptionKind, AnalyticsOption>>>({});
  const [optionsLoading, setOptionsLoading] = useState<Partial<Record<AnalyticsOptionKind, boolean>>>({});
  const [optionsError, setOptionsError] = useState<Partial<Record<AnalyticsOptionKind, string>>>({});

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void loadOperationsAnalytics(filters, dimension, metric).then(data => {
      if (active) setState({ status: 'ready', data });
    }).catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [filters, dimension, metric, revision]);

  const searchOptions = useCallback((kind: AnalyticsOptionKind, search: string) => {
    let active = true;
    setOptionsLoading(current => ({ ...current, [kind]: true }));
    setOptionsError(current => ({ ...current, [kind]: '' }));
    void loadOperationsAnalyticsOptions(kind, search, kind === 'loading_site' || kind === 'offloading_site' ? 100 : 50)
      .then(page => { if (active) setOptions(current => ({ ...current, [kind]: page })); })
      .catch(error => {
        if (active) setOptionsError(current => ({ ...current, [kind]: error instanceof Error ? error.message : 'Unable to load options.' }));
      })
      .finally(() => { if (active) setOptionsLoading(current => ({ ...current, [kind]: false })); });
    return () => { active = false; };
  }, []);

  const changePeriod = (next: AnalyticsFilters) => {
    if (next.period === 'custom' && !next.date_from) {
      const currentData = state.status === 'ready' ? state.data : null;
      const end = currentData?.range_end ?? todayInLagos();
      const start = currentData?.range_start ?? shiftDate(end, -29);
      setFilters({ ...next, date_from: start, date_to: end });
      return;
    }
    if (next.period !== 'custom') {
      const preset = { ...next };
      delete preset.date_from;
      delete preset.date_to;
      setFilters(preset);
      return;
    }
    setFilters(next);
  };

  const selectOption = (kind: AnalyticsOptionKind, option: AnalyticsOption | null) => {
    setSelectedOptions(current => {
      const next = { ...current };
      if (option) next[kind] = option;
      else delete next[kind];
      return next;
    });
    const key: Record<AnalyticsOptionKind, 'loading_site_id' | 'offloading_site_id' | 'truck_id' | 'driver_id'> = {
      loading_site: 'loading_site_id', offloading_site: 'offloading_site_id', truck: 'truck_id', driver: 'driver_id',
    };
    setFilters(current => {
      const next = { ...current };
      if (option) next[key[kind]] = option.id;
      else delete next[key[kind]];
      return next;
    });
  };

  const resetFilters = () => {
    setFilters({ period: '30_days' });
    setSelectedOptions({});
  };

  return <OperationsAnalyticsView state={state} filters={filters} options={options} selectedOptions={selectedOptions}
    optionsLoading={optionsLoading} optionsError={optionsError} today={todayInLagos()}
    dimension={dimension} metric={metric} onChangeFilters={changePeriod} onSearchOptions={searchOptions}
    onSelectOption={selectOption} onRetryOptions={kind => searchOptions(kind, '')} onResetFilters={resetFilters}
    onDimension={setDimension} onMetric={setMetric} onRetry={() => setRevision(value => value + 1)} />;
}
