import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import {
  loadOperationsDashboard,
  type DashboardActionCategory,
  type DashboardPreview,
  type OperationsDashboardActivity,
  type OperationsDashboardData,
} from '../services/operationsDashboard';
import { useRealtimeTrips } from '../../../hooks/useRealtimeTrips';
import { NotificationToastContainer } from '../../../components/common/NotificationToast';
import './dashboard.css';

export type OperationsDashboardLoadState =
  | { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OperationsDashboardData };

const activityLabels: Record<OperationsDashboardActivity['event_type'], string> = {
  trip_opened: 'Trip Opened',
  trip_closed: 'Trip Closed',
  trip_cancelled: 'Trip Cancelled',
  exception_raised: 'Exception Raised',
  exception_resolved: 'Exception Resolved',
  waybill_issued: 'Waybill Issued',
  pdf_ready: 'PDF Ready',
  payment_status_changed: 'Payment Status Changed',
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

function value(item: DashboardPreview, key: string): string {
  return typeof item[key] === 'string' ? item[key] as string : '';
}

function categoryItem(category: string, item: DashboardPreview): string {
  if (category === 'exception') return `${value(item, 'exception_type').replace(/_/g, ' ')}${value(item, 'trip_number') ? ` · ${value(item, 'trip_number')}` : ''}${value(item, 'truck_registration') ? ` · ${value(item, 'truck_registration')}` : ''}`;
  if (category === 'payment') return `${value(item, 'trip_number')} · ${value(item, 'truck_registration')} · ${value(item, 'driver_name')}`;
  return `${value(item, 'invoice_number')} · ${value(item, 'trip_number')}`;
}

function ActionCard({ title, target, category, kind }: {
  title: string; target: string; category: DashboardActionCategory; kind: 'exception' | 'pdf' | 'email' | 'payment';
}) {
  return <article className="operations-action-card">
    <div className="operations-action-heading">
      <h3>{title}</h3><span className="operations-count" aria-label={`${category.count} items`}>{category.count}</span>
    </div>
    {category.items.length === 0 ? <p className="muted small">No items requiring attention.</p> :
      <ul className="operations-preview-list">{category.items.map(item => {
        const key = value(item, 'exception_id') || value(item, 'document_id')
          || value(item, 'notification_id') || value(item, 'payment_id');
        const timestamp = value(item, 'created_at') || value(item, 'failed_at');
        return <li key={key}>
          <span>{categoryItem(kind, item)}</span>
          {timestamp && <time dateTime={timestamp}>{formatDate(timestamp)}</time>}
        </li>;
      })}</ul>}
    <Link className="operations-module-link" to={target}>View module <span aria-hidden="true">→</span></Link>
  </article>;
}

function DashboardContent({ data }: { data: OperationsDashboardData }) {
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
        <div className="operations-table-scroll"><table className="operations-table">
          <thead><tr><th scope="col">Trip #</th><th scope="col">Truck</th><th scope="col">Driver</th>
            <th scope="col">Loading Site</th><th scope="col">Opened At</th><th scope="col">Duration</th><th scope="col">Status</th></tr></thead>
          <tbody>{data.openTrips.items.map(trip => <tr key={trip.trip_id}>
            <td>{trip.trip_number}</td><td>{trip.truck_registration}</td><td>{trip.driver_name}</td>
            <td>{trip.loading_site_name}</td><td><time dateTime={trip.opened_at}>{formatDate(trip.opened_at)}</time></td>
            <td>{formatDuration(trip.duration_seconds)}</td><td><span className="operations-open-badge">Open</span></td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="operations-dashboard-section">
      <div className="operations-section-heading"><div><p className="eyebrow">Safe operational queues</p><h2>Action Required</h2></div></div>
      <div className="operations-action-grid">
        <ActionCard title="Unresolved Exceptions" target="/operations/exceptions" kind="exception" category={actions.unresolvedExceptions} />
        <ActionCard title="Failed Waybill PDFs" target="/operations/waybills-payouts" kind="pdf" category={actions.failedWaybillPdfs} />
        <ActionCard title="Failed Waybill Email Delivery" target="/operations/waybills-payouts" kind="email" category={actions.failedWaybillEmails} />
        <ActionCard title="Payment Details Required" target="/operations/waybills-payouts" kind="payment" category={actions.paymentDetailsRequired} />
      </div>
    </section>

    <section className="card operations-dashboard-section">
      <div className="operations-section-heading"><div><p className="eyebrow">Chronological feed</p><h2>Recent Activity</h2></div></div>
      <p className="muted small">Showing up to 20 recent events as of {formatDate(data.activity.as_of)}.</p>
      {data.activity.items.length === 0 ? <ListResultState status="empty" message="No recent operational activity." /> :
        <div className="operations-table-scroll"><table className="operations-table operations-activity-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Trip</th>
            <th scope="col">Truck</th><th scope="col">Officer / Site</th></tr></thead>
          <tbody>{data.activity.items.map(event => <tr key={event.event_id}>
            <td><time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time></td>
            <td>{activityLabels[event.event_type]}{event.payment_status ? ` · ${event.payment_status.replace(/_/g, ' ')}` : ''}</td>
            <td>{event.trip_number ?? '—'}</td><td>{event.truck_registration ?? '—'}</td>
            <td>{event.officer_name || 'System'}{event.site_name ? ` · ${event.site_name}` : ''}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}

export function OperationsDashboardView({ state, onRetry }: {
  state: OperationsDashboardLoadState;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load the Operations dashboard." onRetry={onRetry} />;
  return <DashboardContent data={state.data} />;
}

export function OperationsDashboard() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<OperationsDashboardLoadState>({ status: 'loading' });

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

  return (
    <>
      <OperationsDashboardView state={state} onRetry={() => setRevision(value => value + 1)} />
      <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
