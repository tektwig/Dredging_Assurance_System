import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type {
  AnalyticsStatus, OperationsAnalyticsData, PerformanceDimension, PerformanceMetric,
} from '../../services/operationsAnalytics';

const COLORS = ['#125b59', '#d39e42', '#4978a4', '#8a6795', '#5a8b67', '#bf735b'];
const varianceColor = '#4978a4';

function tonnes(value: number | null): string {
  return value === null ? 'Unavailable' : `${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
}

function hours(seconds: number | null): string {
  return seconds === null ? 'No data' : `${(seconds / 3600).toLocaleString('en-NG', { maximumFractionDigits: 1 })} h`;
}

function percent(value: number | null): string {
  return value === null ? 'Unavailable' : `${(value * 100).toLocaleString('en-NG', { maximumFractionDigits: 1 })}%`;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function labelStatus(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function TableDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="analytics-data-details">
    <summary>View {title} data table</summary>
    <div className="analytics-table-scroll">{children}</div>
  </details>;
}

function KPI({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="card analytics-kpi">
    <p>{label}</p><strong>{value}</strong><span className="muted small">{detail}</span>
  </article>;
}

export function AnalyticsKpiGrid({ data }: { data: OperationsAnalyticsData }) {
  const kpi = data.kpis;
  return <section className="analytics-kpi-grid" aria-label="Analytics KPI summary">
    <KPI label="Total Trips" value={kpi.total_trips.toLocaleString('en-NG')} detail="Trips opened in the selected period" />
    <KPI label="Actual Tonnage" value={tonnes(kpi.actual_tonnage_tonnes)}
      detail={`${kpi.actual_tonnage_closed_trip_count.toLocaleString('en-NG')} closed trips with actual tonnage`} />
    <KPI label="Avg Tonnage / Trip" value={tonnes(kpi.average_tonnage_per_trip_tonnes)}
      detail={`${kpi.average_tonnage_trip_count.toLocaleString('en-NG')} closed trips with actual tonnage`} />
    <KPI label="Avg Turnaround Time" value={hours(kpi.average_turnaround_seconds)}
      detail={`${kpi.average_turnaround_trip_count.toLocaleString('en-NG')} trips with both opened and closed times`} />
    <KPI label="Avg Tonnage Variance" value={tonnes(kpi.average_tonnage_variance_tonnes)}
      detail={`${kpi.variance_trip_count.toLocaleString('en-NG')} paired trips · ${percent(kpi.estimate_coverage)} estimate coverage`} />
  </section>;
}

export function AnalyticsTrends({ data }: { data: OperationsAnalyticsData }) {
  return <section className="analytics-panel-grid" aria-label="Operational trends">
    <article className="card analytics-panel">
      <header><p className="eyebrow">Line chart · event counts</p><h2>Trips Opened vs Closed</h2>
        <p className="muted small">Each series is counted on its own event date: opened_at or closed_at.</p></header>
      <figure aria-labelledby="analytics-trips-trend-title">
        <figcaption id="analytics-trips-trend-title" className="visually-hidden">Daily trip openings and closures</figcaption>
        <div className="analytics-chart" role="img" aria-label="Line chart showing trips opened and closed by Africa/Lagos operational date">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.trips_trend} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Tooltip labelFormatter={value => typeof value === 'string' ? dateLabel(value) : String(value ?? '')} />
              <Legend />
              <Line type="linear" dataKey="opened" name="Opened" stroke="#125b59" strokeWidth={2} dot={false} />
              <Line type="linear" dataKey="closed" name="Closed" stroke="#d39e42" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <TableDetails title="daily trip trend"><table><caption>Trips opened and closed per operational date</caption>
        <thead><tr><th scope="col">Date (Africa/Lagos)</th><th scope="col">Opened</th><th scope="col">Closed</th></tr></thead>
        <tbody>{data.trips_trend.map(row => <tr key={row.date}><th scope="row">{dateLabel(row.date)}</th>
          <td>{row.opened}</td><td>{row.closed}</td></tr>)}</tbody>
      </table></TableDetails>
    </article>

    <article className="card analytics-panel">
      <header><p className="eyebrow">Line chart · paired trip cohort</p><h2>Estimated vs Actual Tonnage</h2>
        <p className="muted small">Both lines use closed trips with actual and estimated values. Paired sample: {data.variance.paired_trip_count.toLocaleString('en-NG')} of {data.kpis.actual_tonnage_closed_trip_count.toLocaleString('en-NG')} closed trips with actual tonnage ({percent(data.variance.estimate_coverage)} estimate coverage).</p></header>
      <figure aria-labelledby="analytics-tonnage-trend-title">
        <figcaption id="analytics-tonnage-trend-title" className="visually-hidden">Estimated and actual tonnage for trips with both values</figcaption>
        <div className="analytics-chart" role="img" aria-label="Line chart comparing estimated and actual tonnage for paired closed trips by operational date">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.tonnage_trend} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} />
              <YAxis tickFormatter={(value: number) => value.toLocaleString('en-NG')} />
              <Tooltip labelFormatter={value => typeof value === 'string' ? dateLabel(value) : String(value ?? '')}
                formatter={value => typeof value === 'number' ? tonnes(value)
                  : value === null ? 'Estimate unavailable' : 'Unavailable'} />
              <Legend />
              <Line type="linear" dataKey="estimated_tonnage_tonnes" name="Estimated" stroke="#125b59" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="linear" dataKey="actual_tonnage_tonnes" name="Actual" stroke="#d39e42" strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <TableDetails title="estimated and actual tonnage"><table><caption>Daily tonnage totals for closed trips with both values</caption>
        <thead><tr><th scope="col">Date (Africa/Lagos)</th><th scope="col">Estimated tonnes</th>
          <th scope="col">Actual tonnes</th><th scope="col">Paired trips</th></tr></thead>
        <tbody>{data.tonnage_trend.map(row => <tr key={row.date}><th scope="row">{dateLabel(row.date)}</th>
          <td>{tonnes(row.estimated_tonnage_tonnes)}</td><td>{tonnes(row.actual_tonnage_tonnes)}</td>
          <td>{row.paired_trip_count}</td></tr>)}</tbody>
      </table></TableDetails>
    </article>
  </section>;
}

const dimensionLabels: Record<PerformanceDimension, string> = {
  truck: 'Truck', driver: 'Driver', loading_site: 'Loading Site', offloading_site: 'Offloading Site',
};
const metricLabels: Record<PerformanceMetric, string> = {
  trips: 'Trips', actual_tonnage: 'Actual Tonnage', average_tonnage: 'Average Tonnage',
  average_turnaround: 'Average Turnaround Time',
};
const metricDataKeys: Record<PerformanceMetric, 'trip_count' | 'actual_tonnage_tonnes' | 'average_tonnage_tonnes' | 'average_turnaround_seconds'> = {
  trips: 'trip_count', actual_tonnage: 'actual_tonnage_tonnes',
  average_tonnage: 'average_tonnage_tonnes', average_turnaround: 'average_turnaround_seconds',
};

function metricValue(metric: PerformanceMetric, value: number | null): string {
  if (value === null) return 'No data';
  if (metric === 'trips') return value.toLocaleString('en-NG');
  if (metric === 'average_turnaround') return hours(value);
  return tonnes(value);
}

export function AnalyticsPerformance({ data, dimension, metric, onDimension, onMetric }: {
  data: OperationsAnalyticsData; dimension: PerformanceDimension; metric: PerformanceMetric;
  onDimension: (dimension: PerformanceDimension) => void; onMetric: (metric: PerformanceMetric) => void;
}) {
  const chartData = data.performance.items;
  const valueKey = metricDataKeys[metric];
  const formatAxis = (value: number) => metric === 'trips'
    ? value.toLocaleString('en-NG') : metric === 'average_turnaround'
      ? `${(value / 3600).toLocaleString('en-NG', { maximumFractionDigits: 0 })}h`
      : value.toLocaleString('en-NG', { maximumFractionDigits: 1 });
  return <article className="card analytics-panel">
    <header className="analytics-panel-title"><div><p className="eyebrow">Bar chart · Top 10</p><h2>Performance</h2>
      <p className="muted small">{data.performance.entity_count.toLocaleString('en-NG')} matching entities; showing up to 10.</p></div></header>
    <div className="analytics-chart-controls">
      <label>Compare<select value={dimension} onChange={event => onDimension(event.currentTarget.value as PerformanceDimension)}>
        {Object.entries(dimensionLabels).map(([value, label]) => <option key={value} value={value}>{label}s</option>)}
      </select></label>
      <label>Measure<select value={metric} onChange={event => onMetric(event.currentTarget.value as PerformanceMetric)}>
        {Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <p className="muted small">{dimension === 'offloading_site'
      ? 'Offloading-site cohort uses trips closed during the selected period.'
      : 'Truck, driver, and loading-site cohorts use trips opened during the selected period.'}</p>
    {chartData.length === 0 ? <p className="list-state" role="status">No performance results match these filters.</p> : <>
      <figure aria-labelledby="analytics-performance-title">
        <figcaption id="analytics-performance-title" className="visually-hidden">Top 10 {dimensionLabels[dimension].toLowerCase()} performance by {metricLabels[metric].toLowerCase()}</figcaption>
        <div className="analytics-chart analytics-chart-tall" role="img" aria-label={`Top ${chartData.length} ${dimensionLabels[dimension].toLowerCase()}s by ${metricLabels[metric].toLowerCase()}`}>
          <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 42)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 20, bottom: 4, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={formatAxis} />
              <YAxis type="category" dataKey="label" width={140} />
              <Tooltip formatter={value => metricValue(metric, typeof value === 'number' ? value : null)} />
              <Bar dataKey={valueKey} name={metricLabels[metric]} fill="#125b59" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <TableDetails title="performance"><table><caption>Top 10 entities and all returned comparison measures</caption>
        <thead><tr><th scope="col">{dimensionLabels[dimension]}</th><th scope="col">Trips opened</th><th scope="col">Trips closed</th>
          <th scope="col">Actual tonnes</th><th scope="col">Average tonnes / trip</th><th scope="col">Average turnaround</th></tr></thead>
        <tbody>{chartData.map(row => <tr key={row.entity_id}><th scope="row">{row.label}</th><td>{row.trip_count}</td>
          <td>{row.closed_trip_count}</td><td>{tonnes(row.actual_tonnage_tonnes)}</td>
          <td>{tonnes(row.average_tonnage_tonnes)}</td><td>{hours(row.average_turnaround_seconds)}</td></tr>)}</tbody>
      </table></TableDetails>
    </>}
  </article>;
}

function Donut({ title, data, selected, onSelect }: {
  title: string; data: AnalyticsStatus; selected: boolean; onSelect: () => void;
}) {
  return <button type="button" className={`analytics-distribution-choice${selected ? ' selected' : ''}`}
    aria-pressed={selected} onClick={onSelect}>
    <span>{title}</span><strong>{data.denominator.toLocaleString('en-NG')}</strong><small>records in cohort</small>
  </button>;
}

export function AnalyticsStatusDistribution({ data }: { data: OperationsAnalyticsData }) {
  const [selected, setSelected] = useState<'trip' | 'payout' | 'exception'>('trip');
  const configs = {
    trip: { label: 'Trip Status', data: data.status_distributions.trip,
      note: 'Current status of trips opened during the selected period.' },
    payout: { label: 'Payout Status', data: data.status_distributions.payout,
      note: 'Current status of payout records for trips closed during the selected period.' },
    exception: { label: 'Exception Status', data: data.status_distributions.exception,
      note: 'Current status of exceptions created during the selected period. Site and driver filters require a linked trip.' },
  } as const;
  const active = configs[selected];
  return <article className="card analytics-panel">
    <header><p className="eyebrow">Donut chart · current status</p><h2>Status Distribution</h2>
        <p className="muted small">{active.note} Denominator: {active.data.denominator.toLocaleString('en-NG')} matching records.</p></header>
    <div className="analytics-distribution-switcher" role="group" aria-label="Status distribution cohort">
      {(Object.keys(configs) as Array<keyof typeof configs>).map(key => <Donut key={key} title={configs[key].label}
        data={configs[key].data} selected={selected === key} onSelect={() => setSelected(key)} />)}
    </div>
    {active.data.denominator === 0 ? <p className="list-state" role="status">No {active.label.toLowerCase()} records match this cohort.</p> : <>
      <figure aria-labelledby="analytics-status-title">
        <figcaption id="analytics-status-title" className="visually-hidden">{active.label} across {active.data.denominator} records</figcaption>
        <div className="analytics-chart analytics-donut-chart" role="img" aria-label={`${active.label} donut chart; denominator ${active.data.denominator}`}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={active.data.slices} dataKey="count" nameKey="status" innerRadius={62} outerRadius={100}
                paddingAngle={2} label={({ name, percent: share }: { name?: string; percent?: number }) =>
                  `${labelStatus(name ?? '')} ${((share ?? 0) * 100).toFixed(0)}%`}>
                {active.data.slices.map((slice, index) => <Cell key={slice.status} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={value => `${typeof value === 'number' ? value : 0} records`} />
              <Legend formatter={(value: string) => labelStatus(value)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <TableDetails title={active.label.toLowerCase()}><table><caption>{active.label}; {active.note} Denominator: {active.data.denominator}</caption>
        <thead><tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col">Share of cohort</th></tr></thead>
        <tbody>{active.data.slices.map(slice => <tr key={slice.status}><th scope="row">{labelStatus(slice.status)}</th>
          <td>{slice.count}</td><td>{percent(slice.share)}</td></tr>)}</tbody>
      </table></TableDetails>
    </>}
  </article>;
}

export function AnalyticsVariance({ data }: { data: OperationsAnalyticsData }) {
  const daily = data.variance.daily;
  const trucks = data.variance.trucks;
  const coverage = percent(data.variance.estimate_coverage);
  return <section className="analytics-panel-grid" aria-label="Estimated versus actual tonnage variance">
    <article className="card analytics-panel">
      <header><p className="eyebrow">Variance = Actual − Estimated</p><h2>Signed Variance Over Time</h2>
        <p className="analytics-variance-summary">Aggregate variance: <strong>{tonnes(data.variance.total_variance_tonnes)}</strong></p>
        <p className="muted small">{data.variance.paired_trip_count.toLocaleString('en-NG')} paired trips · {coverage} estimate coverage. Positive means actual exceeded estimate; negative means actual was below estimate.</p></header>
      {data.variance.paired_trip_count === 0 ? <p className="list-state" role="status">No closed trips with both actual and estimated tonnage match this period.</p> : <>
        <figure aria-labelledby="analytics-variance-trend-title">
          <figcaption id="analytics-variance-trend-title" className="visually-hidden">Daily signed actual minus estimated tonnage</figcaption>
          <div className="analytics-chart" role="img" aria-label="Daily signed tonnage variance with a zero baseline">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={daily} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} />
                <YAxis tickFormatter={(value: number) => value.toLocaleString('en-NG', { maximumFractionDigits: 1 })} />
                <ReferenceLine y={0} stroke="#526975" />
                <Tooltip labelFormatter={value => typeof value === 'string' ? dateLabel(value) : String(value ?? '')}
                  formatter={value => typeof value === 'number' ? tonnes(value)
                    : value === null ? 'No paired trips' : 'Unavailable'} />
                <Bar dataKey="variance_tonnes" name="Signed variance" fill={varianceColor} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <TableDetails title="daily signed variance"><table><caption>Aggregate signed variance per close date</caption>
          <thead><tr><th scope="col">Date (Africa/Lagos)</th><th scope="col">Variance tonnes</th><th scope="col">Paired trips</th></tr></thead>
          <tbody>{daily.map(row => <tr key={row.date}><th scope="row">{dateLabel(row.date)}</th>
            <td>{tonnes(row.variance_tonnes)}</td><td>{row.paired_trip_count}</td></tr>)}</tbody>
        </table></TableDetails>
      </>}
    </article>
    <article className="card analytics-panel">
      <header><p className="eyebrow">Truck comparison · Top 10 by absolute average variance</p><h2>Average Signed Variance by Truck</h2>
        <p className="muted small">Bars show signed average tonnes per paired trip; rank uses the absolute average. No thresholds are applied.</p></header>
      {trucks.length === 0 ? <p className="list-state" role="status">No trucks have paired closed trips in this period.</p> : <>
        <figure aria-labelledby="analytics-variance-trucks-title">
          <figcaption id="analytics-variance-trucks-title" className="visually-hidden">Top 10 trucks by absolute average signed variance</figcaption>
          <div className="analytics-chart analytics-chart-tall" role="img" aria-label="Truck signed average variance, sorted by absolute magnitude, with a zero baseline">
            <ResponsiveContainer width="100%" height={Math.max(280, trucks.length * 42)}>
              <BarChart data={trucks} layout="vertical" margin={{ top: 8, right: 20, bottom: 4, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(value: number) => value.toLocaleString('en-NG', { maximumFractionDigits: 1 })} />
                <YAxis type="category" dataKey="label" width={140} />
                <ReferenceLine x={0} stroke="#526975" />
                <Tooltip formatter={value => tonnes(typeof value === 'number' ? value : 0)} />
                <Bar dataKey="average_variance_tonnes" name="Average signed variance" fill={varianceColor} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <TableDetails title="truck variance"><table><caption>Top 10 trucks by absolute average signed variance</caption>
          <thead><tr><th scope="col">Truck</th><th scope="col">Average signed variance</th>
            <th scope="col">Aggregate variance</th><th scope="col">Paired trips</th></tr></thead>
          <tbody>{trucks.map(row => <tr key={row.entity_id}><th scope="row">{row.label}</th>
            <td>{tonnes(row.average_variance_tonnes)}</td><td>{tonnes(row.total_variance_tonnes)}</td>
            <td>{row.paired_trip_count}</td></tr>)}</tbody>
        </table></TableDetails>
      </>}
    </article>
  </section>;
}
