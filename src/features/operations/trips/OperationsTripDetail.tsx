import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { TripClosureInvoiceModal } from '../../../components/operations/TripClosureInvoiceModal';
import type { TripClosureInvoice } from '../../../types';
import {
  cancelOperationsTripAndRefresh,
  loadOperationsTripDetail,
  type OperationsTripDetail,
  type OperationsTripDetailRecord,
} from '../services/operationsTrips';
import './trips.css';

export type OperationsTripDetailLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; data: OperationsTripDetail };
export type CancellationState = 'idle' | 'submitting' | 'error' | 'conflict' | 'denied';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

function roleLabel(role: string | null): string {
  return role ? role.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : '';
}

function officerLabel(officer: OperationsTripDetailRecord['loading_officer']): string {
  if (!officer) return 'Unavailable';
  const name = officer.display_name?.trim() || 'Officer';
  const role = roleLabel(officer.role);
  return role ? `${name} · ${role}` : name;
}

function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="trip-detail-value"><dt>{label}</dt><dd>{children}</dd></div>;
}

function LifecycleStep({ title, state, children }: {
  title: string;
  state: 'complete' | 'current' | 'upcoming' | 'cancelled';
  children?: ReactNode;
}) {
  return <article className={`trip-lifecycle-step trip-lifecycle-${state}`}>
    <p className="eyebrow">{state === 'complete' ? 'Complete' : state === 'current' ? 'Current state' : state === 'cancelled' ? 'Cancelled' : 'Upcoming'}</p>
    <h3>{title}</h3>{children}
  </article>;
}

function Lifecycle({ data, onViewInvoice }: { data: OperationsTripDetail; onViewInvoice?: () => void }) {
  const trip = data.trip;
  const cancelled = trip.status === 'cancelled';
  const closed = trip.status === 'closed';
  return <section className="card trip-detail-section">
    <p className="eyebrow">Authoritative lifecycle</p><h2>Trip lifecycle</h2>
    <div className="trip-lifecycle">
      <LifecycleStep title="Loading" state="complete">
        <p>{trip.loading_site_name}</p>
        <p><time dateTime={trip.opened_at}>{formatDate(trip.opened_at)}</time></p>
        <p className="muted small">{officerLabel(trip.loading_officer)}</p>
      </LifecycleStep>
      <LifecycleStep title="Open Trip" state={trip.status === 'open' ? 'current' : 'complete'}>
        <p>{trip.trip_number}</p><p className="muted small">Current status: {trip.status.replace(/\b\w/g, letter => letter.toUpperCase())}</p>
      </LifecycleStep>
      {cancelled ? <LifecycleStep title="Trip Cancelled" state="cancelled">
        <p><time dateTime={trip.cancelled_at ?? ''}>{formatDate(trip.cancelled_at)}</time></p>
        <p className="muted small">{officerLabel(trip.cancelled_officer)}</p>
      </LifecycleStep> : <>
        <LifecycleStep title="Offloading" state={closed ? 'complete' : 'upcoming'}>
          {closed ? <><p>{trip.offloading_site_name ?? 'Offloading site unavailable'}</p>
            <p><time dateTime={trip.closed_at ?? ''}>{formatDate(trip.closed_at)}</time></p>
            <p className="muted small">{officerLabel(trip.offloading_officer)}</p></> : <p className="muted">Not yet recorded</p>}
        </LifecycleStep>
        <LifecycleStep title="Closed" state={closed ? 'complete' : 'upcoming'}>
          {closed ? <><p>{trip.quantity_tonnes?.toFixed(2)} tonnes</p>
            <p><time dateTime={trip.closed_at ?? ''}>{formatDate(trip.closed_at)}</time></p></> : <p className="muted">Not yet closed</p>}
        </LifecycleStep>
        <LifecycleStep title="Waybill" state={data.waybill ? 'complete' : closed ? 'current' : 'upcoming'}>
          {data.waybill ? <><p>{data.waybill.invoice_number}</p>
            <p><time dateTime={data.waybill.issued_at}>{formatDate(data.waybill.issued_at)}</time></p>
            <p className="muted small">PDF: {data.waybill.pdf_status ?? 'Ready'}</p>
            {onViewInvoice && <button type="button" className="button secondary small" style={{ marginTop: '0.4rem', fontSize: '0.78rem', padding: '0.25rem 0.55rem' }} onClick={onViewInvoice}>📄 View / Download Invoice</button>}
          </> : (closed && onViewInvoice) ? <>
            <p className="muted">Ready for invoice view</p>
            <button type="button" className="button secondary small" style={{ marginTop: '0.4rem', fontSize: '0.78rem', padding: '0.25rem 0.55rem' }} onClick={onViewInvoice}>📄 View / Download Invoice</button>
          </> : <p className="muted">Not issued</p>}
        </LifecycleStep>
        <LifecycleStep title="Payout" state={data.payout ? 'complete' : closed ? 'current' : 'upcoming'}>
          {data.payout ? <><p>Status: {data.payout.status.replace(/_/g, ' ')}</p>
            <p className="muted small">Created {formatDate(data.payout.created_at)}</p>
            {data.payout.payment_ready_at && <p className="muted small">Ready {formatDate(data.payout.payment_ready_at)}</p>}
            {data.payout.paid_at && <p className="muted small">Paid {formatDate(data.payout.paid_at)}</p>}</> : <p className="muted">Not available</p>}
        </LifecycleStep>
      </>}
    </div>
  </section>;
}

function TripOverview({ trip }: { trip: OperationsTripDetailRecord }) {
  return <section className="card trip-detail-section">
    <div className="trip-detail-heading"><div><p className="eyebrow">Trip record</p><h2>{trip.trip_number}</h2></div>
      <span className={`trip-status-badge trip-status-${trip.status}`}>{trip.status[0].toUpperCase() + trip.status.slice(1)}</span>
    </div>
    <dl className="trip-detail-grid">
      <DetailValue label="Truck plate">{trip.truck_registration}</DetailValue>
      <DetailValue label="Driver at loading">{trip.driver_name}</DetailValue>
      <DetailValue label="Loading site">{trip.loading_site_name}</DetailValue>
      <DetailValue label="Opened at">{formatDate(trip.opened_at)}</DetailValue>
      <DetailValue label="Loading officer">{officerLabel(trip.loading_officer)}</DetailValue>
      <DetailValue label="Offloading site">{trip.offloading_site_name ?? '—'}</DetailValue>
      <DetailValue label="Closed at">{formatDate(trip.closed_at)}</DetailValue>
      <DetailValue label="Estimated tonnage">{trip.estimated_quantity_tonnes === null
        ? '—' : `${trip.estimated_quantity_tonnes.toFixed(2)} tonnes`}</DetailValue>
      <DetailValue label="Tonnage">{trip.quantity_tonnes === null ? '—' : `${trip.quantity_tonnes.toFixed(2)} tonnes`}</DetailValue>
      <DetailValue label="Offloading officer">{officerLabel(trip.offloading_officer)}</DetailValue>
    </dl>
  </section>;
}

export function OperationsTripDetailView({ state, cancellationState = 'idle', cancellationReason = '',
  onRetry, onOpenCancellation, onCloseCancellation, onReasonChange, onCancel }: {
  state: OperationsTripDetailLoadState;
  cancellationState?: CancellationState;
  cancellationReason?: string;
  onRetry: () => void;
  onOpenCancellation?: () => void;
  onCloseCancellation?: () => void;
  onReasonChange?: (reason: string) => void;
  onCancel?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [activeInvoice, setActiveInvoice] = useState<TripClosureInvoice | null>(null);

  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load this trip." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Trip not found</h1>
    <p className="muted">The trip may have been removed from this view.</p><Link to="/operations/trips">Back to Trips</Link></section>;

  const { trip, waybill } = state.data;
  const submitting = cancellationState === 'submitting';

  const handleOpenInvoice = () => {
    const inv: TripClosureInvoice = {
      id: waybill?.invoice_number || `INV-${trip.trip_number}`,
      invoice_number: waybill?.invoice_number || `INV-${trip.trip_number}`,
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      truck_id: trip.truck_id || '',
      truck_registration: trip.truck_registration,
      truck_type: 'Commercial Tipper',
      truck_capacity_tonnes: 30,
      truck_owner_name: 'DredgeOps Fleet',
      driver_id: trip.driver_id || '',
      driver_name: trip.driver_name,
      driver_phone: (trip as any).driver_phone || (waybill as any)?.driver_phone || undefined,
      driver_email: (trip as any).driver_email || (waybill as any)?.driver_email || undefined,
      driver_license: 'DL-7492-LG',
      loading_site_id: trip.loading_site_id || '',
      loading_site_name: trip.loading_site_name,
      offloading_site_id: trip.offloading_site_id || '',
      offloading_site_name: trip.offloading_site_name || 'Offloading Site',
      quantity_tonnes: trip.quantity_tonnes || 30,
      opened_at: trip.opened_at,
      closed_at: trip.closed_at || trip.opened_at,
      bank_name: (waybill as any)?.bank_name || (trip as any)?.bank_name || undefined,
      account_name: (waybill as any)?.account_name || (trip as any)?.account_name || undefined,
      account_number: (waybill as any)?.account_number || (trip as any)?.account_number || undefined,
    };
    setActiveInvoice(inv);
  };

  return <div className="operations-trip-detail-page">
    <nav className="trip-breadcrumb" aria-label="Breadcrumb"><Link to="/operations/trips">Trips</Link><span aria-hidden="true">/</span><span>{trip.trip_number}</span></nav>
    <header className="operations-trips-header">
      <div><p className="eyebrow">Read-only lifecycle record</p><h1>Trip detail</h1></div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {(trip.status === 'closed' || Boolean(waybill)) && (
          <button
            type="button"
            className="button secondary"
            onClick={handleOpenInvoice}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            📄 View Commercial Invoice
          </button>
        )}
        {trip.status === 'open' && onOpenCancellation && <button className="button secondary trip-cancel-open"
          type="button" onClick={onOpenCancellation}>Cancel open trip</button>}
      </div>
    </header>
    {cancellationState === 'conflict' && <p className="message trip-conflict" role="status">Trip status changed while cancellation was in progress. The latest trip state is shown.</p>}
    {cancellationState === 'error' && <p className="message error-message" role="alert">Cancellation did not complete. The latest trip state is shown; retry only if it remains open.</p>}
    {cancellationState === 'denied' && <p className="message error-message" role="alert">You are not authorized to cancel this trip. The latest trip state is shown.</p>}
    <TripOverview trip={trip} />
    <Lifecycle data={state.data} onViewInvoice={(trip.status === 'closed' || Boolean(waybill)) ? handleOpenInvoice : undefined} />
    <section className="card trip-detail-section">
      <p className="eyebrow">Related records</p><h2>Exceptions</h2>
      {state.data.exceptions.length === 0 ? <ListResultState status="empty" message="No related exceptions." /> :
        <div className="operations-table-scroll"><table className="operations-table">
          <thead><tr><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Raised</th><th scope="col">Resolved</th></tr></thead>
          <tbody>{state.data.exceptions.map(exception => <tr key={exception.exception_id}>
            <td>{exception.exception_type.replace(/_/g, ' ')}</td><td>{exception.status.replace(/_/g, ' ')}</td>
            <td><time dateTime={exception.raised_at}>{formatDate(exception.raised_at)}</time></td>
            <td>{exception.resolved_at ? <time dateTime={exception.resolved_at}>{formatDate(exception.resolved_at)}</time> : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    {trip.status === 'cancelled' && <p className="muted small">Cancellation is recorded as a separate terminal lifecycle state; closure, Waybill and payout steps are not implied.</p>}
    {cancellationState === 'submitting' && <p className="muted small" role="status">Refreshing authoritative trip state…</p>}
    {onCancel && onCloseCancellation && onReasonChange && <CancellationDialog
      cancellationState={cancellationState} cancellationReason={cancellationReason} submitting={submitting}
      onClose={onCloseCancellation} onReasonChange={onReasonChange} onSubmit={onCancel} />}

    {/* Commercial Invoice Modal */}
    <TripClosureInvoiceModal
      invoice={activeInvoice}
      onClose={() => setActiveInvoice(null)}
    />
  </div>;
}

function CancellationDialog({ cancellationState, cancellationReason, submitting, onClose, onReasonChange, onSubmit }: {
  cancellationState: CancellationState;
  cancellationReason: string;
  submitting: boolean;
  onClose: () => void;
  onReasonChange: (reason: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (cancellationState !== 'submitting' && cancellationState !== 'idle') return null;
  return <div className="trip-modal-backdrop">
    <form className="trip-cancel-dialog card" role="dialog" aria-modal="true" aria-labelledby="trip-cancel-title" onSubmit={onSubmit}>
      <h2 id="trip-cancel-title">Cancel open trip?</h2>
      <p>This is a controlled, audited action. Closed and cancelled trips cannot be changed.</p>
      <label htmlFor="trip-cancel-reason">Reason (required)</label>
      <textarea id="trip-cancel-reason" required maxLength={2000} rows={4} value={cancellationReason}
        disabled={submitting} onChange={event => onReasonChange(event.currentTarget.value)} />
      <div className="actions">
        <button className="button secondary" type="button" disabled={submitting} onClick={onClose}>Keep trip open</button>
        <button className="button" type="submit" disabled={submitting || !cancellationReason.trim()}>
          {submitting ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
      </div>
    </form>
  </div>;
}

export function OperationsTripDetail() {
  const { tripId = '' } = useParams();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<OperationsTripDetailLoadState>({ status: 'loading' });
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationState, setCancellationState] = useState<CancellationState>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const cancellationInFlight = useRef(false);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    void loadOperationsTripDetail(tripId).then(data => {
      if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' });
    }).catch(() => {
      if (current) setState({ status: 'error' });
    });
    return () => { current = false; };
  }, [tripId, revision]);

  const closeCancellation = () => {
    if (cancellationState === 'submitting') return;
    setDialogOpen(false);
    setCancellationReason('');
    setCancellationState('idle');
  };
  const handleCancel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cancellationInFlight.current || !cancellationReason.trim()) return;
    cancellationInFlight.current = true;
    setCancellationState('submitting');
    try {
      const result = await cancelOperationsTripAndRefresh(tripId, cancellationReason);
      setState(result.trip ? { status: 'ready', data: result.trip } : { status: 'not-found' });
      if (result.outcome === 'cancelled') {
        setDialogOpen(false);
        setCancellationReason('');
        setCancellationState('idle');
      } else {
        setCancellationState(result.outcome === 'failed' ? 'error' : result.outcome);
      }
    } catch {
      setCancellationState('error');
      setRevision(value => value + 1);
    } finally {
      cancellationInFlight.current = false;
    }
  };

  return <OperationsTripDetailView state={state} cancellationState={dialogOpen ? cancellationState : 'idle'}
    cancellationReason={cancellationReason} onRetry={() => setRevision(value => value + 1)}
    onOpenCancellation={state.status === 'ready' && state.data.trip.status === 'open'
      ? () => { setDialogOpen(true); setCancellationState('idle'); } : undefined}
    onCloseCancellation={dialogOpen ? closeCancellation : undefined}
    onReasonChange={dialogOpen ? setCancellationReason : undefined}
    onCancel={dialogOpen ? handleCancel : undefined} />;
}
