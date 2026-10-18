import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import {
  loadOperationsDashboard,
  loadOperationsDashboardQueueHealth,
  type DashboardActionCategory,
  type DashboardPreview,
  type OperationsDashboardActivity,
  type OperationsDashboardData,
  type OperationsDashboardQueueHealth,
  type OperationsQueueMetrics,
} from '../services/operationsDashboard';
import { useRealtimeTrips } from '../../../hooks/useRealtimeTrips';
import { NotificationToastContainer } from '../../../components/common/NotificationToast';
import './dashboard.css';

export type OperationsDashboardLoadState =
  | { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsDashboardData };
export type OperationsDashboardQueueHealthLoadState =
  | { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsDashboardQueueHealth };

const activityLabels: Record<OperationsDashboardActivity['event_type'], string> = {
  trip_opened: 'Trip Opened',
  trip_closed: 'Trip Closed',
  trip_cancelled: 'Trip Cancelled',
  exception_raised: 'Exception Raised',
  exception_resolved: 'Exception Resolved',
  waybill_issued: 'Waybill Record Created',
  pdf_ready: 'Legacy Waybill PDF Ready',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function handleTableScrollKey(event: KeyboardEvent<HTMLDivElement>): void {
  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!direction) return;
  const region = event.currentTarget;
  const nextScrollLeft = Math.max(0, Math.min(region.scrollWidth - region.clientWidth,
    region.scrollLeft + direction * 48));
  if (nextScrollLeft === region.scrollLeft) return;
  event.preventDefault();
  region.scrollLeft = nextScrollLeft;
}

function value(item: DashboardPreview, key: string): string {
  return typeof item[key] === 'string' ? item[key] as string : '';
}

function categoryItem(category: string, item: DashboardPreview): string {
  if (category === 'exception') return `${value(item, 'exception_type').replace(/_/g, ' ')}${value(item, 'trip_number') ? ` · ${value(item, 'trip_number')}` : ''}${value(item, 'truck_registration') ? ` · ${value(item, 'truck_registration')}` : ''}`;
  return `${value(item, 'waybill_number')} · ${value(item, 'trip_number')}`;
}

function ActionCard({ title, target, category, kind }: {
  title: string; target: string; category: DashboardActionCategory; kind: 'exception' | 'pdf' | 'email';
}) {
  return <article className="card operations-action-card">
    <div className="operations-action-heading">
      <h3>{title}</h3><span className="operations-count" aria-label={`${category.count} items`}>{category.count}</span>
    </div>
    {category.items.length === 0 ? <p className="muted small">No items requiring attention.</p> :
      <ul className="operations-preview-list">{category.items.map(item => {
        const key = value(item, 'exception_id') || value(item, 'document_id')
          || value(item, 'notification_id');
        const timestamp = value(item, 'created_at') || value(item, 'failed_at');
        return <li key={key}>
          <span>{categoryItem(kind, item)}</span>
          {timestamp && <time dateTime={timestamp}>{formatDate(timestamp)}</time>}
        </li>;
      })}</ul>}
    <Link className="operations-module-link" to={target}>View module <span aria-hidden="true">→</span></Link>
  </article>;
}

function queueStatusLabel(status: OperationsQueueMetrics['latest_status']): string {
  if (status === null) return 'No recorded job status';
  if (status === 'ready') return 'Completed';
  if (status === 'provider_accepted') return 'Provider accepted';
  if (status === 'unknown') return 'Unrecognized status';
  return status.replace(/_/g, ' ');
}

function QueueMetricsCard({ title, metrics, completedLabel }: {
  title: string; metrics: OperationsQueueMetrics; completedLabel: string;
}) {
  const rows = [
    ['Pending', metrics.pending_total, 'pending'],
    ['Due pending', metrics.due_pending, 'due'],
    ['Processing total', metrics.processing_total, 'processing'],
    ['Currently processing', metrics.active_processing, 'active'],
    ['Expired or missing lease', metrics.expired_processing_leases, 'expired'],
    ['Failed', metrics.failed, 'failed'],
    ...(title === 'Notifications' ? [
      ['Blocked: missing driver email', metrics.blocked_missing_email, 'blocked'] as const,
      ['Blocked: company recipient configuration', metrics.blocked_configuration, 'blocked'] as const,
    ] : []),
    [completedLabel, metrics.completed, 'completed'],
    ['Unrecognized status', metrics.unexpected_status, 'unknown'],
  ] as const;
  return <article className="card operations-queue-card">
    <h3>{title}</h3>
    <dl className="operations-queue-metrics">
      {rows.map(([label, count, status]) => <div className={`operations-queue-metric queue-status--${status}`} key={label}>
        <dt>{label}</dt><dd>{count}</dd>
      </div>)}
    </dl>
    <p className="operations-queue-latest">
      Latest current job status: <strong>{queueStatusLabel(metrics.latest_status)}</strong>
      {metrics.latest_updated_at && <> · <time dateTime={metrics.latest_updated_at}>{formatDate(metrics.latest_updated_at)}</time></>}
    </p>
  </article>;
}

function QueueHealthSection({ state, onRetry }: {
  state: OperationsDashboardQueueHealthLoadState; onRetry: () => void;
}) {
  return <section className="card operations-dashboard-section" aria-labelledby="operations-queue-health-title">
    <div className="operations-section-heading">
      <div><p className="eyebrow">Pipeline snapshot</p><h2 id="operations-queue-health-title">Waybill Queue Health</h2></div>
      <div className="operations-queue-actions">
        <Link className="operations-module-link" to="/operations/waybills">View Waybills <span aria-hidden="true">→</span></Link>
        <button className="operations-queue-refresh" type="button" onClick={onRetry} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Refreshing…' : 'Refresh queue status'}
        </button>
      </div>
    </div>
    {state.status === 'loading' ? <ListResultState status="loading" /> :
      state.status === 'error' ? <ListResultState status="error" message="Unable to load queue health." onRetry={onRetry} /> : <>
        <p className="muted small operations-queue-observed">Server snapshot observed <time dateTime={state.data.as_of}>{formatDate(state.data.as_of)}</time>.</p>
        <div className="operations-queue-grid">
          <QueueMetricsCard title="PDF generation" metrics={state.data.pdf} completedLabel="Completed" />
          <QueueMetricsCard title="Notifications" metrics={state.data.notifications} completedLabel="Provider accepted" />
        </div>
        {state.data.pdf.pending_total === 0 && state.data.pdf.processing_total === 0 && state.data.pdf.failed === 0
          && state.data.notifications.pending_total === 0 && state.data.notifications.processing_total === 0
          && state.data.notifications.failed === 0
          ? <p className="operations-queue-empty">No pending, processing, or failed jobs are currently recorded.</p> : null}
        <p className="muted small operations-queue-explanation">
          Due pending is included in Pending. Expired or missing leases are included in Processing; active and expired leases partition that total.
          “Provider accepted” is the persisted provider acceptance state, not confirmed email delivery.
        </p>
        <p className="operations-queue-worker-note">Queue status does not establish whether a worker is running or healthy. An empty queue alone is not evidence of worker health.</p>
      </>}
  </section>;
}

function DashboardContent({ data, queueHealthState, onQueueHealthRetry }: {
  data: OperationsDashboardData;
  queueHealthState: OperationsDashboardQueueHealthLoadState;
  onQueueHealthRetry: () => void;
}) {
  const summary = data.summary;
  const kpis = [
    ['Trips Opened Today', summary.tripsOpenedToday],
    ['Trips Closed Today', summary.tripsClosedToday],
    ['Open Trips', summary.openTrips],
    ['Tonnage Today', summary.tonnageToday.toFixed(2)],
    ['Trucks Processed Today', summary.trucksProcessedToday],
    ['Exceptions Requiring Attention', summary.exceptionsRequiringAttention],
  ] as const;
  const actions = summary.actionRequired;
  return <div className="operations-dashboard">
    <header className="operations-dashboard-header">
      <div><p className="eyebrow">System-wide oversight</p><h1>Operations Dashboard</h1></div>
      <p className="muted">Today is based on the Africa/Lagos operational day.</p>
    </header>

    <section className="operations-kpi-grid" aria-label="Operational summary">
      {kpis.map(([label, metric]) => <article className="operations-kpi card" key={label}>
        <p>{label}</p><strong>{metric}</strong>
      </article>)}
    </section>

    <section className="card operations-dashboard-section">
      <div className="operations-section-heading"><div><p className="eyebrow">Live queue</p><h2>Open Trips Requiring Attention</h2></div>
        <Link className="operations-module-link" to="/operations/trips">View Trips <span aria-hidden="true">→</span></Link>
      </div>
      <p className="muted small">Oldest open trips first. Durations are calculated by the server as of {formatDate(data.openTrips.as_of)}.</p>
      {data.openTrips.items.length === 0 ? <ListResultState status="empty" message="There are no open trips." /> :
        <div className="operations-table-scroll" role="region" aria-label="Open trips table" tabIndex={0} onKeyDown={handleTableScrollKey}><table className="operations-table">
          <thead><tr><th scope="col">Trip #</th><th scope="col">Truck</th><th scope="col">Driver</th>
            <th scope="col">Loading Site</th><th scope="col">Opened At</th><th scope="col">Duration</th><th scope="col">Status</th></tr></thead>
          <tbody>{data.openTrips.items.map(trip => <tr key={trip.trip_id}>
            <td>{trip.trip_number}</td><td>{trip.truck_registration}</td><td>{trip.driver_name}</td>
            <td>{trip.loading_site_name}</td><td><time dateTime={trip.opened_at}>{formatDate(trip.opened_at)}</time></td>
            <td>{formatDuration(trip.duration_seconds)}</td><td><span className="operations-open-badge">Open</span></td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="card operations-dashboard-section">
      <div className="operations-section-heading"><div><p className="eyebrow">Safe operational queues</p><h2>Action Required</h2></div></div>
      <div className="operations-action-grid">
        <ActionCard title="Unresolved Exceptions" target="/operations/exceptions" kind="exception" category={actions.unresolvedExceptions} />
        <ActionCard title="Failed Waybill PDFs" target="/operations/waybills" kind="pdf" category={actions.failedWaybillPdfs} />
        <ActionCard title="Failed Waybill Email Delivery" target="/operations/waybills" kind="email" category={actions.failedWaybillEmails} />
      </div>
    </section>

    <QueueHealthSection state={queueHealthState} onRetry={onQueueHealthRetry} />

    <section className="card operations-dashboard-section">
      <div className="operations-section-heading"><div><p className="eyebrow">Chronological feed</p><h2>Recent Activity</h2></div></div>
      <p className="muted small">Showing up to 20 recent events as of {formatDate(data.activity.as_of)}.</p>
      {data.activity.items.length === 0 ? <ListResultState status="empty" message="No recent operational activity." /> :
        <div className="operations-table-scroll" role="region" aria-label="Recent activity table" tabIndex={0} onKeyDown={handleTableScrollKey}><table className="operations-table operations-activity-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Trip</th>
            <th scope="col">Truck</th><th scope="col">Officer / Site</th></tr></thead>
          <tbody>{data.activity.items.map(event => <tr key={event.event_id}>
            <td><time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time></td>
            <td>{activityLabels[event.event_type]}</td>
            <td>{event.trip_number ?? '—'}</td><td>{event.truck_registration ?? '—'}</td>
            <td>{event.officer_name || 'System'}{event.site_name ? ` · ${event.site_name}` : ''}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}

export function OperationsDashboardView({ state, onRetry,
  queueHealthState = { status: 'loading' }, onQueueHealthRetry = () => undefined }: {
  state: OperationsDashboardLoadState;
  onRetry: () => void;
  queueHealthState?: OperationsDashboardQueueHealthLoadState;
  onQueueHealthRetry?: () => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load the Operations dashboard." onRetry={onRetry} />;
  return <DashboardContent data={state.data} queueHealthState={queueHealthState}
    onQueueHealthRetry={onQueueHealthRetry} />;
}

export function OperationsDashboard() {
  const [revision, setRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [state, setState] = useState<OperationsDashboardLoadState>({ status: 'loading' });
  const [queueHealthState, setQueueHealthState] = useState<OperationsDashboardQueueHealthLoadState>({ status: 'loading' });

  const { toasts, dismissToast } = useRealtimeTrips({
    channelName: 'operations-dashboard-trips-realtime',
    onTripChange: () => setRevision(value => value + 1),
    showToasts: true,
  });

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    void loadOperationsDashboard().then(data => {
      if (current) setState({ status: 'ready', data });
    }).catch(() => {
      if (current) setState({ status: 'error' });
    });
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    let current = true;
    setQueueHealthState({ status: 'loading' });
    void loadOperationsDashboardQueueHealth().then(data => {
      if (current) setQueueHealthState({ status: 'ready', data });
    }).catch(() => {
      if (current) setQueueHealthState({ status: 'error' });
    });
    return () => { current = false; };
  }, [revision, queueRevision]);

  return (
    <>
      <OperationsDashboardView state={state} onRetry={() => setRevision(value => value + 1)}
        queueHealthState={queueHealthState} onQueueHealthRetry={() => setQueueRevision(value => value + 1)} />
      <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
