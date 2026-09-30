import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import {
  completeOperationsPayment, downloadWaybill, loadDeliveryHistory, loadWaybillDetail,
  markOperationsPaymentPaid, resendWaybill, retryWaybillDelivery,
  type DeliveryAttempt, type Page, type WaybillDetail,
} from '../services/operationsWaybills';
import { formatLagosDate } from './OperationsWaybillsRegister';
import './waybills.css';

type State = { status: 'loading' } | { status: 'error' } | { status: 'not-found' } | { status: 'ready'; data: WaybillDetail };
type Audience = 'driver' | 'finance';

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? '—'}</dd></div>;
}

function ResendForm({ detail, onDone, onError }: { detail: WaybillDetail; onDone: () => void; onError: (message: string) => void }) {
  const [audience, setAudience] = useState<Audience>('driver');
  const [reason, setReason] = useState(detail.delivery.driver === 'failed' ? 'DELIVERY_UNCONFIRMED' : 'DRIVER_REQUEST');
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const currentStatus = audience === 'driver' ? detail.delivery.driver : detail.delivery.internal;
  const risk = currentStatus === 'failed';
  const eligible = detail.document.status === 'ready' && (audience !== 'driver' || detail.invoice.driver_email_available);
  const resetRequest = () => { requestId.current = crypto.randomUUID(); setDuplicateConfirmed(false); setError(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !eligible || risk && !duplicateConfirmed) return;
    setBusy(true); setError('');
    try {
      await resendWaybill(detail.invoice.id, audience, requestId.current, reason, duplicateConfirmed);
      requestId.current = crypto.randomUUID(); onDone();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to resend Waybill';
      setError(message); onError(message);
      if (message.includes('changed') || message.includes('conflicts')) onDone();
    }
    finally { setBusy(false); }
  };
  const retry = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await retryWaybillDelivery(detail.invoice.id, audience, 'DELIVERY_UNCONFIRMED'); onDone(); }
    catch (failure) { const message = failure instanceof Error ? failure.message : 'Unable to retry delivery';
      setError(message); onError(message); }
    finally { setBusy(false); }
  };
  return <form className="waybill-action-form" onSubmit={event => void submit(event)}>
    <h3>Controlled resend</h3>
    <p className="muted">Creates a separate audited delivery attempt using the existing PDF and immutable recipient snapshot.</p>
    <label>Audience<select value={audience} onChange={event => {
      const selected = event.currentTarget.value as Audience;
      setAudience(selected);
      setReason((selected === 'driver' ? detail.delivery.driver : detail.delivery.internal) === 'failed'
        ? 'DELIVERY_UNCONFIRMED' : selected === 'driver' ? 'DRIVER_REQUEST' : 'INTERNAL_REQUEST');
      resetRequest();
    }}><option value="driver">Driver</option><option value="finance">Internal Operations / Finance</option></select></label>
    <label>Reason code<select value={reason} onChange={event => { setReason(event.currentTarget.value); resetRequest(); }}>
      {risk ? <><option value="DELIVERY_UNCONFIRMED">Delivery unconfirmed</option>
        <option value="CORRECTIVE_RESEND">Corrective resend</option></>
        : <><option value="DRIVER_REQUEST">Driver request</option><option value="INTERNAL_REQUEST">Internal request</option>
          <option value="CORRECTIVE_RESEND">Corrective resend</option></>}
    </select></label>
    {risk && <><p className="waybill-warning">A previous delivery failed. Provider acceptance may be uncertain.
      Try the same delivery within its safe retry window. Outside that window, a new resend may duplicate delivery.</p>
      <label className="waybill-checkbox"><input type="checkbox" checked={duplicateConfirmed}
        onChange={event => setDuplicateConfirmed(event.currentTarget.checked)} />
        I understand a new delivery could duplicate a message already accepted by the provider.</label>
      <button className="button secondary" type="button" disabled={busy} onClick={() => void retry()}>Retry existing attempt safely</button>
    </>}
    {!eligible && <p role="status">{detail.document.status !== 'ready' ? 'Ready PDF required.' : 'Driver email not available in the Waybill snapshot.'}</p>}
    {detail.document.status === 'ready' && currentStatus === null &&
      <p role="status">Initial delivery not queued. Resend becomes available after the initial delivery is processed.</p>}
    {currentStatus === 'pending' &&
      <p role="status">Delivery pending. Resend becomes available after this delivery is processed.</p>}
    {currentStatus === 'processing' &&
      <p role="status">Delivery processing. Resend becomes available after this delivery is processed.</p>}
    {error && <p role="alert">{error}</p>}
    <button className="button" type="submit" disabled={busy || !eligible || risk && !duplicateConfirmed
      || currentStatus === 'pending' || currentStatus === 'processing' || currentStatus === null}>
      {busy ? 'Submitting…' : 'Create resend attempt'}</button>
  </form>;
}

function PayoutForm({ detail, onDone, onError }: { detail: WaybillDetail; onDone: () => void; onError: (message: string) => void }) {
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payment = detail.payment;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (payment.status === 'pending' && !window.confirm('Confirm this payout was paid? This cannot be reversed.')) return;
    setBusy(true); setError('');
    try {
      if (payment.status === 'payment_details_required') {
        await completeOperationsPayment(payment.id, payment.updated_at, accountName, accountNumber, bankName);
        setAccountName(''); setAccountNumber(''); setBankName('');
      } else if (payment.status === 'pending') {
        await markOperationsPaymentPaid(payment.id, payment.updated_at, reference);
        setReference('');
      }
      onDone();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to update payout';
      setError(message); onError(message);
      onDone();
    } finally { setBusy(false); }
  };
  if (payment.status === 'paid') return null;
  return <form className="waybill-action-form" onSubmit={event => void submit(event)}>
    {payment.status === 'payment_details_required' ? <>
      <h3>Complete payment details</h3><p className="muted">Only this payout is updated. Driver master banking and Waybill remain unchanged.</p>
      <label>Account name<input required maxLength={200} autoComplete="off" value={accountName}
        onChange={event => setAccountName(event.currentTarget.value)} /></label>
      <label>Account number<input required pattern="[0-9]{10}" inputMode="numeric" maxLength={10}
        autoComplete="off" value={accountNumber} onChange={event => setAccountNumber(event.currentTarget.value)} /></label>
      <label>Bank name<input required maxLength={200} autoComplete="off" value={bankName}
        onChange={event => setBankName(event.currentTarget.value)} /></label>
      <button className="button" type="submit" disabled={busy}>Complete payout details</button>
    </> : <><h3>Mark payout paid</h3>
      <label>Payment reference<input required maxLength={200} value={reference}
        onChange={event => setReference(event.currentTarget.value)} /></label>
      <button className="button" type="submit" disabled={busy}>Confirm paid</button></>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function OperationsWaybillDetailView({ state, history, historyError, historyPage, onHistoryPageChange, onRetry, onDownload, onRefresh, onActionError }: {
  state: State; history: Page<DeliveryAttempt> | null; historyError: boolean; historyPage: number;
  onHistoryPageChange: (page: number) => void; onRetry: () => void;
  onDownload: (detail: WaybillDetail) => void; onRefresh: () => void; onActionError: (message: string) => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load Waybill detail." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Waybill not found</h1>
    <Link to="/operations/waybills-payouts">Back to Waybills</Link></section>;
  const { invoice, document, payment, delivery } = state.data;
  return <div className="operations-waybills-page">
    <header><Link to="/operations/waybills-payouts">← Waybills &amp; Payouts</Link>
      <p className="eyebrow">Immutable Waybill</p><h1>{invoice.invoice_number}</h1>
      <p>Trip <Link to={`/operations/trips/${invoice.trip_id}`}>{invoice.trip_number}</Link> · Issued {formatLagosDate(invoice.issued_at)}</p></header>
    <section className="card waybill-section"><h2>Waybill snapshot</h2><dl className="waybill-detail-grid">
      <DetailField label="Truck">{invoice.truck_registration}</DetailField><DetailField label="Type">{invoice.truck_type}</DetailField>
      <DetailField label="Capacity">{invoice.truck_capacity_tonnes === null ? '—' : `${invoice.truck_capacity_tonnes.toFixed(2)} t`}</DetailField>
      <DetailField label="Owner">{invoice.truck_owner_name}</DetailField><DetailField label="Driver">{invoice.driver_name}</DetailField>
      <DetailField label="Phone">{invoice.driver_phone}</DetailField><DetailField label="License">{invoice.driver_license}</DetailField>
      <DetailField label="Loading site">{invoice.loading_site_name}</DetailField>
      <DetailField label="Loading officer">{invoice.loading_officer_name}</DetailField>
      <DetailField label="Opened">{formatLagosDate(invoice.opened_at)}</DetailField>
      <DetailField label="Offloading site">{invoice.offloading_site_name}</DetailField>
      <DetailField label="Offloading officer">{invoice.offloading_officer_name}</DetailField>
      <DetailField label="Closed">{formatLagosDate(invoice.closed_at)}</DetailField>
      <DetailField label="Tonnage">{invoice.quantity_tonnes.toFixed(2)} t</DetailField>
      <DetailField label="Closure account name">{invoice.closure_account_name}</DetailField>
      <DetailField label="Closure account number">{invoice.closure_account_number}</DetailField>
      <DetailField label="Closure bank">{invoice.closure_bank_name}</DetailField>
    </dl></section>
    <section className="card waybill-section"><h2>PDF</h2><p>Status: {document.status}</p>
      {document.ready_at && <p>Ready: {formatLagosDate(document.ready_at)}</p>}
      <button className="button secondary" type="button" disabled={document.status !== 'ready'}
        onClick={() => onDownload(state.data)}>Download private PDF</button></section>
    <section className="card waybill-section"><h2>Delivery</h2>
      <p>Driver: {delivery.driver ?? 'not queued'} · Internal: {delivery.internal ?? 'not queued'}</p>
      <ResendForm detail={state.data} onDone={onRefresh} onError={onActionError} />
      <h3>Delivery history</h3>
      {!history && (historyError ? <ListResultState status="error" message="Unable to load delivery history." onRetry={onRetry} />
        : <p role="status">Loading delivery history…</p>)}
      {history && !history.items.length && <p>No delivery attempts yet.</p>}
      {history && history.items.length > 0 && <><div className="operations-table-scroll"><table className="operations-table">
        <thead><tr><th>Created</th><th>Audience</th><th>Sequence</th><th>Status</th><th>Attempts</th><th>Sent</th><th>Reason</th></tr></thead>
        <tbody>{history.items.map(attempt => <tr key={attempt.notification_id}>
          <td>{formatLagosDate(attempt.created_at)}</td><td>{attempt.audience === 'finance' ? 'Internal' : 'Driver'}</td>
          <td>{attempt.sequence}</td><td>{attempt.status}</td><td>{attempt.attempts}</td>
          <td>{formatLagosDate(attempt.sent_at)}</td><td>{attempt.requested_reason_code ?? 'Original delivery'}</td>
        </tr>)}</tbody></table></div>
        <PaginationControls page={historyPage} pageSize={history.pageSize} totalCount={history.totalCount} onPageChange={onHistoryPageChange} />
      </>}
    </section>
    <section className="card waybill-section"><h2>Payout</h2><p>Status: {payment.status.replace(/_/g,' ')}</p>
      <dl className="waybill-detail-grid"><DetailField label="Account name">{payment.account_name}</DetailField>
        <DetailField label="Account number">{payment.account_number}</DetailField>
        <DetailField label="Bank">{payment.bank_name}</DetailField>
        <DetailField label="Ready">{formatLagosDate(payment.payment_ready_at)}</DetailField>
        <DetailField label="Paid">{formatLagosDate(payment.paid_at)}</DetailField>
        <DetailField label="Payment reference">{payment.payment_reference}</DetailField></dl>
      <PayoutForm detail={state.data} onDone={onRefresh} onError={onActionError} /></section>
  </div>;
}

export function OperationsWaybillDetail() {
  const { invoiceId } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [history, setHistory] = useState<Page<DeliveryAttempt> | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' }); setHistory(null); setHistoryError(false);
    if (!invoiceId) { setState({ status: 'not-found' }); return; }
    void loadWaybillDetail(invoiceId).then(data => {
      if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' });
    }).catch(() => { if (current) setState({ status: 'error' }); });
    void loadDeliveryHistory(invoiceId, historyPage).then(data => { if (current) setHistory(data); })
      .catch(() => { if (current) setHistoryError(true); });
    return () => { current = false; };
  }, [invoiceId, historyPage, revision]);
  return <>{message && <p role="alert">{message}</p>}
    <OperationsWaybillDetailView state={state} history={history} historyError={historyError} historyPage={historyPage}
      onHistoryPageChange={setHistoryPage} onRetry={refresh} onRefresh={refresh}
      onActionError={setMessage}
      onDownload={detail => { setMessage(''); void downloadWaybill(detail)
        .catch(() => setMessage('Unable to download private Waybill PDF.')); }} /></>;
}
