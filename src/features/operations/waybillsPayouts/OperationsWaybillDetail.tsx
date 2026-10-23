import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import {
  downloadWaybillCopy, loadDeliveryHistory, loadWaybillCopyManagementState,
  loadWaybillDetail, resendWaybill, retryWaybillDelivery, saveWaybillCompanyBankDetails,
  type DeliveryAttempt, type DeliveryStatus,
  type Page, type SecurePdfStatus, type WaybillCopyManagementState, type WaybillDetail,
} from '../services/operationsWaybills';
import { formatLagosDate } from './OperationsWaybillsRegister';
import './waybills.css';

type State = { status: 'loading' } | { status: 'error' } | { status: 'not-found' } | { status: 'ready'; data: WaybillDetail };
type CopyState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: WaybillCopyManagementState };
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? '—'}</dd></div>;
}

function secureCopyStatusLabel(status: SecurePdfStatus): string {
  if (status === 'blocked_missing_bank_details') return 'Bank Details Required';
  if (status === 'blocked_bank_details_unverified') return 'Bank Details Unverified';
  if (status === 'not_available') return 'Not Available';
  return status[0].toUpperCase() + status.slice(1);
}

function BankDetailsEntry({ waybillId, onSaved }: { waybillId: string; onSaved: () => void }) {
  const requestId = useRef(crypto.randomUUID());
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedBankName = bankName.trim();
    const normalizedAccountName = accountName.trim();
    const normalizedAccountNumber = accountNumber.trim();
    if (!normalizedBankName || normalizedBankName.length > 200) {
      setError('Enter a valid bank name.');
      return;
    }
    if (!/^[0-9]{10}$/.test(normalizedAccountNumber)) {
      setError('Account number must contain exactly 10 digits.');
      return;
    }
    if (!normalizedAccountName || normalizedAccountName.length > 200) {
      setError('Enter a valid account name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveWaybillCompanyBankDetails(waybillId, requestId.current,
        normalizedBankName, normalizedAccountName, normalizedAccountNumber);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save Waybill bank details.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="waybill-action-form" onSubmit={submit} aria-label="Enter Company Waybill bank details">
    <h3>Enter Bank Details</h3>
    <p className="muted">These details are stored privately and used only for the Company Waybill copy.</p>
    <label>Bank Name<input autoComplete="off" maxLength={200} required value={bankName}
      onChange={event => setBankName(event.currentTarget.value)} /></label>
    <label>Account Number<input autoComplete="off" inputMode="numeric" pattern="[0-9]{10}"
      maxLength={10} required value={accountNumber}
      onChange={event => setAccountNumber(event.currentTarget.value)} /></label>
    <label>Account Name<input autoComplete="off" maxLength={200} required value={accountName}
      onChange={event => setAccountName(event.currentTarget.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button className="button" type="submit" disabled={busy}>
      {busy ? 'Saving bank details…' : 'Save bank details'}
    </button>
  </form>;
}

function DeliveryRecovery({ detail, audience, status, onDone, onError }: {
  detail: WaybillDetail; audience: 'driver' | 'client'; status: DeliveryStatus;
  onDone: () => void; onError: (message: string) => void;
}) {
  const [reason, setReason] = useState('DELIVERY_UNCONFIRMED');
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [error, setError] = useState('');
  const blockedEmail = audience === 'driver' && status === 'blocked_missing_email';
  const blockedConfiguration = audience === 'client' && status === 'blocked_configuration';
  const isFailed = status === 'failed';
  const canResend = detail.document.status === 'ready' && isFailed;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); onDone(); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to update this delivery.';
      setError(message); onError(message); onDone();
    } finally { setBusy(false); }
  }

  const retry = () => run(() => retryWaybillDelivery(detail.waybill.id, audience, 'DELIVERY_UNCONFIRMED'));
  const submitResend = (event: FormEvent) => {
    event.preventDefault();
    if (!canResend || !duplicateConfirmed) return;
    void run(async () => {
      await resendWaybill(detail.waybill.id, audience, requestId.current, reason, true);
      requestId.current = crypto.randomUUID(); setDuplicateConfirmed(false);
    });
  };

  return <section className="waybill-delivery-card">
    <h3>{audience === 'driver' ? 'Driver delivery' : 'Parent company delivery'}</h3>
    <p>Status: <strong>{status?.replace(/_/g, ' ') ?? 'not queued'}</strong></p>
    {status === 'sent' && <p className="muted">The email provider accepted the message. This does not confirm mailbox delivery.</p>}
    {blockedEmail && <>
      <p role="status">The driver delivery is blocked because no email address was recorded at closure. The original Waybill and delivery record are preserved.</p>
      <Link to={`/operations/trucks-drivers/drivers/${detail.waybill.driver_id}`}>Correct the driver email</Link>
      <button className="button secondary" type="button" disabled={busy || !detail.waybill.driver_email_available}
        onClick={() => void retry()}>{busy ? 'Saving…' : 'Retry original driver delivery'}</button>
      {!detail.waybill.driver_email_available && <p className="muted">Add an email to the driver master record first.</p>}
    </>}
    {blockedConfiguration && <p role="status">Company delivery is blocked until the parent company email recipient is configured. No Finance Officer mailbox is used as a fallback.</p>}
    {status === 'pending' && <p role="status">Delivery is waiting for processing.</p>}
    {status === 'processing' && <p role="status">Delivery is currently processing.</p>}
    {isFailed && <>
      <p className="muted">Failure details are available to authorized service staff. Provider acceptance may be uncertain.</p>
      <button className="button secondary" type="button" disabled={busy || detail.document.status !== 'ready'}
        onClick={() => void retry()}>{busy ? 'Submitting…' : 'Retry existing delivery'}</button>
      <form className="waybill-action-form" onSubmit={submitResend}>
        <h4>Audited resend</h4>
        <label>Reason<select value={reason} onChange={event => setReason(event.currentTarget.value)}>
          <option value="DELIVERY_UNCONFIRMED">Delivery unconfirmed</option>
          <option value="CORRECTIVE_RESEND">Corrective resend</option>
        </select></label>
        <label className="waybill-checkbox"><input type="checkbox" checked={duplicateConfirmed}
          onChange={event => setDuplicateConfirmed(event.currentTarget.checked)} />
          I understand a new message could duplicate one already accepted by the provider.</label>
        <button className="button" type="submit" disabled={busy || !canResend || !duplicateConfirmed}>
          {busy ? 'Submitting…' : 'Create audited resend'}</button>
      </form>
    </>}
    {status === null && <p className="muted">No delivery record is available.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function OperationsWaybillDetailView({ state, copyState, history, historyError, historyPage, onHistoryPageChange, onRetry, onCopyDownload, onRefresh, onActionError }: {
  state: State; copyState: CopyState; history: Page<DeliveryAttempt> | null; historyError: boolean; historyPage: number;
  onHistoryPageChange: (page: number) => void; onRetry: () => void;
  onCopyDownload: (kind: 'driver' | 'company', detail: WaybillDetail) => void;
  onRefresh: () => void; onActionError: (message: string) => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load Waybill detail." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Waybill not found</h1>
    <Link to="/operations/waybills">Back to Waybills</Link></section>;
  const { waybill, delivery } = state.data;
  return <div className="operations-waybills-page">
    <header><Link to="/operations/waybills">← Back to Waybills</Link>
      <p className="eyebrow">Immutable Waybill</p><h1>{waybill.waybill_number}</h1>
      <p>Trip <Link to={`/operations/trips/${waybill.trip_id}`}>{waybill.trip_number}</Link> · Issued {formatLagosDate(waybill.issued_at)}</p></header>
    <section className="card waybill-section"><h2>Waybill snapshot</h2><dl className="waybill-detail-grid">
      <DetailField label="Truck">{waybill.truck_registration}</DetailField><DetailField label="Type">{waybill.truck_type}</DetailField>
      <DetailField label="Capacity">{waybill.truck_capacity_tonnes === null ? '—' : `${waybill.truck_capacity_tonnes.toFixed(2)} t`}</DetailField>
      <DetailField label="Owner">{waybill.truck_owner_name}</DetailField><DetailField label="Driver">{waybill.driver_name}</DetailField>
      <DetailField label="Phone">{waybill.driver_phone}</DetailField><DetailField label="License">{waybill.driver_license}</DetailField>
      <DetailField label="Loading site">{waybill.loading_site_name}</DetailField>
      <DetailField label="Loading officer">{waybill.loading_officer_name}</DetailField>
      <DetailField label="Opened">{formatLagosDate(waybill.opened_at)}</DetailField>
      <DetailField label="Offloading site">{waybill.offloading_site_name}</DetailField>
      <DetailField label="Offloading officer">{waybill.offloading_officer_name}</DetailField>
      <DetailField label="Closed">{formatLagosDate(waybill.closed_at)}</DetailField>
      <DetailField label="Tonnage">{waybill.quantity_tonnes.toFixed(2)} t</DetailField>
    </dl></section>
    <section className="card waybill-section" aria-labelledby="secure-waybill-copies-heading">
      <h2 id="secure-waybill-copies-heading">Secure PDF copies</h2>
      {copyState.status === 'loading' && <p role="status">Loading Driver and Company PDF statuses…</p>}
      {copyState.status === 'error' && <p role="alert">Secure PDF copy statuses are unavailable.</p>}
      {copyState.status === 'ready' && <div className="waybill-detail-grid">
        <div><h3>Driver PDF</h3>
          <p>Status: <strong>{secureCopyStatusLabel(copyState.data.driver_pdf_status)}</strong></p>
          {copyState.data.driver_pdf_ready_at && <p>Ready: {formatLagosDate(copyState.data.driver_pdf_ready_at)}</p>}
          <button className="button secondary" type="button" disabled={copyState.data.driver_pdf_status !== 'ready'}
            onClick={() => onCopyDownload('driver', state.data)}>Download Driver Copy</button>
        </div>
        <div><h3>Company PDF</h3>
          <p>Status: <strong>{secureCopyStatusLabel(copyState.data.company_pdf_status)}</strong></p>
          {copyState.data.company_pdf_ready_at && <p>Ready: {formatLagosDate(copyState.data.company_pdf_ready_at)}</p>}
          {copyState.data.company_pdf_held_for_missing_bank_details && <p role="status">Bank Details Required. Save the details to release the Company PDF for processing.</p>}
          <button className="button secondary" type="button" disabled={copyState.data.company_pdf_status !== 'ready'}
            onClick={() => onCopyDownload('company', state.data)}>Download Company Copy</button>
        </div>
      </div>}
      {copyState.status === 'ready'
        && ['blocked_missing_bank_details','blocked_bank_details_unverified'].includes(copyState.data.company_pdf_status)
        && copyState.data.latest_bank_snapshot_version === null
        && ['missing','rejected','pending_verification'].includes(copyState.data.bank_verification_state)
        && <BankDetailsEntry waybillId={waybill.id} onSaved={onRefresh} />}
    </section>
    <section className="card waybill-section"><h2>Delivery</h2>
      <p className="muted">Company and driver deliveries are tracked independently.</p>
      <DeliveryRecovery detail={state.data} audience="driver" status={delivery.driver} onDone={onRefresh} onError={onActionError} />
      <DeliveryRecovery detail={state.data} audience="client" status={delivery.company} onDone={onRefresh} onError={onActionError} />
      <h3>Delivery history</h3>
      {!history && (historyError ? <ListResultState status="error" message="Unable to load delivery history." onRetry={onRetry} />
        : <p role="status">Loading delivery history…</p>)}
      {history && !history.items.length && <p>No delivery attempts yet.</p>}
      {history && history.items.length > 0 && <><div className="operations-table-scroll"><table className="operations-table">
        <thead><tr><th>Created</th><th>Audience</th><th>Sequence</th><th>Status</th><th>Attempts</th><th>Accepted</th><th>Reason</th></tr></thead>
        <tbody>{history.items.map(attempt => <tr key={attempt.notification_id}>
          <td>{formatLagosDate(attempt.created_at)}</td><td>{attempt.audience === 'client' ? 'Parent company' : 'Driver'}</td>
          <td>{attempt.sequence}</td><td>{attempt.status.replace(/_/g, ' ')}</td><td>{attempt.attempts}</td>
          <td>{formatLagosDate(attempt.sent_at)}</td><td>{attempt.blocked_reason_code ?? attempt.requested_reason_code ?? 'Initial delivery'}</td>
        </tr>)}</tbody></table></div>
        <PaginationControls page={historyPage} pageSize={history.pageSize} totalCount={history.totalCount} onPageChange={onHistoryPageChange} />
      </>}
    </section>
  </div>;
}

export function OperationsWaybillDetail() {
  const { waybillId } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [copyState, setCopyState] = useState<CopyState>({ status: 'loading' });
  const [history, setHistory] = useState<Page<DeliveryAttempt> | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' }); setCopyState({ status: 'loading' }); setHistory(null); setHistoryError(false);
    if (!waybillId) { setState({ status: 'not-found' }); setCopyState({ status: 'error' }); return; }
    void loadWaybillDetail(waybillId).then(data => {
      if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' });
    }).catch(() => { if (current) setState({ status: 'error' }); });
    void loadWaybillCopyManagementState(waybillId).then(data => {
      if (current) setCopyState({ status: 'ready', data });
    }).catch(() => { if (current) setCopyState({ status: 'error' }); });
    void loadDeliveryHistory(waybillId, historyPage).then(data => { if (current) setHistory(data); })
      .catch(() => { if (current) setHistoryError(true); });
    return () => { current = false; };
  }, [waybillId, historyPage, revision]);
  return <>{message && <p role="alert">{message}</p>}
    <OperationsWaybillDetailView state={state} copyState={copyState} history={history} historyError={historyError} historyPage={historyPage}
      onHistoryPageChange={setHistoryPage} onRetry={refresh} onRefresh={refresh} onActionError={setMessage}
      onCopyDownload={(kind, detail) => { setMessage(''); void downloadWaybillCopy(detail.waybill.id, detail.waybill.waybill_number, kind)
        .catch(() => setMessage(`Unable to download secure ${kind} PDF copy.`)); }} /></>;
}
