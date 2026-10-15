import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { PaginationControls } from '../../../components/data/PaginationControls';
import {
  downloadWaybill, downloadWaybillCopy, loadDeliveryHistory, loadWaybillBankDetailAudit,
  loadWaybillBankSubmissionForReview, loadWaybillCopyManagementState, loadWaybillDetail,
  resendWaybill, retryWaybillDelivery, submitWaybillBankDetails, verifyWaybillBankSubmission,
  type BankDetailAuditEvent, type BankDetailReview, type DeliveryAttempt, type DeliveryStatus,
  type Page, type WaybillCopyManagementState, type WaybillDetail, type WaybillPdfCopyKind,
} from '../services/operationsWaybills';
import { formatLagosDate } from './OperationsWaybillsRegister';
import './waybills.css';

type State = { status: 'loading' } | { status: 'error' } | { status: 'not-found' } | { status: 'ready'; data: WaybillDetail };
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? '—'}</dd></div>;
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

type CopyManagementLoad = { status: 'loading' | 'error' }
  | { status: 'ready'; data: WaybillCopyManagementState; audit: BankDetailAuditEvent[]; auditError: boolean };

function copyStatusLabel(status: WaybillCopyManagementState['driver_pdf_status'], held: boolean): string {
  if (held) return 'Bank Details Required';
  if (status === 'blocked_missing_bank_details') return 'Bank Details Required';
  if (status === 'blocked_bank_details_unverified') return 'Awaiting bank verification';
  if (status === 'not_available') return 'Not available';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function auditLabel(event: BankDetailAuditEvent['event_type']): string {
  const labels: Record<BankDetailAuditEvent['event_type'], string> = {
    submitted: 'Details submitted', correction_submitted: 'Correction submitted',
    review_viewed: 'Submission reviewed', verified: 'Details verified',
    correction_verified: 'Correction verified', rejected: 'Submission rejected',
  };
  return labels[event];
}

function WaybillCopyManagementPanel({ invoiceId, invoiceNumber, onActionError }: {
  invoiceId: string; invoiceNumber: string; onActionError: (message: string) => void;
}) {
  const [load, setLoad] = useState<CopyManagementLoad>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [showBankForm, setShowBankForm] = useState(false);
  const [review, setReview] = useState<BankDetailReview | null>(null);
  const [rejectionReason, setRejectionReason] = useState('mismatch');
  const reload = () => setRevision(value => value + 1);

  useEffect(() => {
    let active = true;
    setLoad({ status: 'loading' });
    void Promise.allSettled([
      loadWaybillCopyManagementState(invoiceId),
      loadWaybillBankDetailAudit(invoiceId),
    ]).then(([management, audit]) => {
      if (!active) return;
      if (management.status === 'rejected') setLoad({ status: 'error' });
      else setLoad({ status: 'ready', data: management.value,
        audit: audit.status === 'fulfilled' ? audit.value : [], auditError: audit.status === 'rejected' });
    });
    return () => { active = false; };
  }, [invoiceId, revision]);

  async function downloadCopy(kind: WaybillPdfCopyKind) {
    setBusy(`download-${kind}`); setNotice(''); onActionError('');
    try {
      await downloadWaybillCopy(invoiceId, invoiceNumber, kind);
      setNotice(`${kind === 'driver' ? 'Driver' : 'Company'} PDF downloaded.`);
    } catch {
      const message = `Unable to download the ${kind} PDF. Refresh the status and try again.`;
      setNotice(message); onActionError(message);
    } finally { setBusy(''); }
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy('submit'); setNotice(''); onActionError('');
    try {
      await submitWaybillBankDetails(invoiceId, bankName, accountName, accountNumber);
      setBankName(''); setAccountName(''); setAccountNumber(''); setShowBankForm(false); setReview(null);
      setNotice('Bank details submitted for review.'); reload();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to submit bank details.';
      setNotice(message); onActionError(message);
    } finally { setBusy(''); }
  }

  async function openReview(submissionId: string) {
    if (busy) return;
    setBusy('review'); setNotice(''); setReview(null); onActionError('');
    try {
      const result = await loadWaybillBankSubmissionForReview(submissionId);
      if (!result) {
        setNotice('This submission is no longer pending. The latest status has been refreshed.');
        reload();
      } else if (result.invoice_number !== invoiceNumber) {
        throw new Error('Submission does not match this Waybill');
      } else { setReview(result); reload(); }
    } catch {
      const message = 'Unable to load the pending bank submission. Refresh and try again.';
      setNotice(message); onActionError(message);
    } finally { setBusy(''); }
  }

  async function decideSubmission(approved: boolean) {
    if (load.status !== 'ready' || !load.data.pending_bank_submission_id || busy) return;
    setBusy(approved ? 'verify' : 'reject'); setNotice(''); onActionError('');
    try {
      const result = await verifyWaybillBankSubmission(load.data.pending_bank_submission_id,
        approved, approved ? null : rejectionReason);
      setReview(null);
      setNotice(result === 'corrected' ? 'Correction verified. A new Company PDF version is queued; earlier documents remain unchanged.'
        : result === 'verified' ? 'Bank details verified. Company PDF generation is queued.' : 'Bank submission rejected.');
      reload();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to record the bank detail decision.';
      setNotice(message); onActionError(message);
    } finally { setBusy(''); }
  }

  const canSubmitDetails = load.status === 'ready' && !load.data.pending_bank_submission_id
    && ['missing', 'rejected', 'verified'].includes(load.data.bank_verification_state);
  const pendingId = load.status === 'ready' ? load.data.pending_bank_submission_id : null;
  const showingCorrection = load.status === 'ready' && load.data.latest_bank_snapshot_version !== null;

  return <section className="card waybill-section waybill-copy-management" aria-labelledby="waybill-copy-heading">
    <div className="waybill-copy-heading-row"><div><h2 id="waybill-copy-heading">Waybill PDF copies</h2>
      <p className="muted">Driver and company documents are generated and managed independently.</p></div>
      <button className="button secondary" type="button" disabled={load.status === 'loading'} onClick={reload}>
        {load.status === 'error' ? 'Retry status' : 'Refresh copy status'}
      </button>
    </div>
    {load.status === 'loading' && <p role="status" aria-live="polite">Loading PDF copy status…</p>}
    {load.status === 'error' && <p role="alert">Unable to load secure PDF copy status or bank audit history. Retry to continue.</p>}
    {load.status === 'ready' && <>
      <div className="waybill-copy-grid">
        {(['driver', 'company'] as const).map(kind => {
          const status = kind === 'driver' ? load.data.driver_pdf_status : load.data.company_pdf_status;
          const readyAt = kind === 'driver' ? load.data.driver_pdf_ready_at : load.data.company_pdf_ready_at;
          const held = kind === 'company' && load.data.company_pdf_held_for_missing_bank_details;
          const label = copyStatusLabel(status, held);
          return <article className="waybill-copy-card" key={kind}>
            <h3>{kind === 'driver' ? 'Driver PDF' : 'Company PDF'}</h3>
            <p>Status: <strong>{label}</strong></p>
            {readyAt && status === 'ready' && <p className="muted">Ready: {formatLagosDate(readyAt)}</p>}
            {kind === 'company' && held && <p role="status">Verified bank details are required before this copy can be generated.</p>}
            {kind === 'company' && status === 'blocked_bank_details_unverified' && <p role="status">The submission is awaiting verification; the driver copy remains independent.</p>}
            {status === 'pending' && <p className="muted">Waiting for PDF generation.</p>}
            {status === 'processing' && <p className="muted">PDF generation is in progress.</p>}
            {status === 'failed' && <p role="status">Generation failed. The status will update if processing is retried.</p>}
            <button className="button secondary" type="button" disabled={status !== 'ready' || busy !== ''}
              onClick={() => void downloadCopy(kind)}>
              {busy === `download-${kind}` ? 'Preparing download…' : `Download ${kind === 'driver' ? 'Driver' : 'Company'} PDF`}
            </button>
          </article>;
        })}
      </div>

      <section className="waybill-bank-workflow" aria-labelledby="waybill-bank-heading">
        <h3 id="waybill-bank-heading">Company copy bank details</h3>
        <p>Verification and corrections are audited. Each verified correction creates a new Company PDF version; previous snapshots and files are preserved.</p>
        <p>Verification state: <strong>{load.data.bank_verification_state.replace(/_/g, ' ')}</strong>
          {load.data.latest_bank_snapshot_version !== null && <> · Verified version {load.data.latest_bank_snapshot_version}</>}</p>
        {pendingId && <div className="waybill-bank-pending">
          <p role="status">{load.data.bank_verification_state === 'correction_pending'
            ? 'A banking correction is awaiting review.' : 'A bank detail submission is awaiting review.'}</p>
          <button className="button secondary" type="button" disabled={busy !== ''}
            onClick={() => void openReview(pendingId)}>{busy === 'review' ? 'Loading submission…' : 'Review pending bank details'}</button>
        </div>}
        {canSubmitDetails && !showBankForm && <button className="button secondary" type="button"
          onClick={() => setShowBankForm(true)}>
          {showingCorrection ? 'Submit bank-detail correction' : 'Enter bank details'}
        </button>}
        {showBankForm && canSubmitDetails && <form className="waybill-action-form waybill-bank-form" onSubmit={event => void submitDetails(event)}>
          <h4>{showingCorrection ? 'Submit a versioned correction' : 'Submit company payment details'}</h4>
          <label htmlFor="waybill-bank-name">Bank name<input id="waybill-bank-name" value={bankName} maxLength={200}
            autoComplete="off" required onChange={event => setBankName(event.currentTarget.value)} /></label>
          <label htmlFor="waybill-account-name">Account name<input id="waybill-account-name" value={accountName}
            maxLength={200} autoComplete="off" required onChange={event => setAccountName(event.currentTarget.value)} /></label>
          <label htmlFor="waybill-account-number">Account number<input id="waybill-account-number" value={accountNumber}
            type="text" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" autoComplete="off" required
            onChange={event => setAccountNumber(event.currentTarget.value.replace(/\D/g, '').slice(0, 10))} /></label>
          <div className="waybill-bank-actions">
            <button className="button" type="submit" disabled={busy !== ''}>{busy === 'submit' ? 'Submitting…' : 'Submit for verification'}</button>
            <button className="button secondary" type="button" disabled={busy !== ''}
              onClick={() => { setShowBankForm(false); setBankName(''); setAccountName(''); setAccountNumber(''); }}>Cancel</button>
          </div>
        </form>}
        {review && <div className="waybill-bank-review" aria-labelledby="waybill-bank-review-heading">
          <h4 id="waybill-bank-review-heading">Authorized bank-detail review</h4>
          <dl><div><dt>Bank name</dt><dd>{review.bank_name}</dd></div>
            <div><dt>Account name</dt><dd>{review.account_name}</dd></div>
            <div><dt>Account number</dt><dd>{review.account_number}</dd></div>
            <div><dt>Submitted</dt><dd>{formatLagosDate(review.submitted_at)}</dd></div>
            <div><dt>Submitted by</dt><dd>{review.submitted_by}</dd></div></dl>
          <div className="waybill-bank-actions">
            <button className="button" type="button" disabled={busy !== ''} onClick={() => void decideSubmission(true)}>
              {busy === 'verify' ? 'Verifying…' : 'Verify bank details'}</button>
            <label htmlFor="waybill-rejection-reason">Rejection reason<select id="waybill-rejection-reason"
              value={rejectionReason} onChange={event => setRejectionReason(event.currentTarget.value)}>
              <option value="mismatch">Details do not match</option><option value="invalid_account_name">Invalid account name</option>
              <option value="invalid_account_number">Invalid account number</option><option value="unsupported_bank">Unsupported bank</option>
            </select></label>
            <button className="button secondary" type="button" disabled={busy !== ''} onClick={() => void decideSubmission(false)}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject submission'}</button>
          </div>
        </div>}
      </section>

      <section className="waybill-bank-audit" aria-labelledby="waybill-bank-audit-heading">
        <h3 id="waybill-bank-audit-heading">Bank-detail audit history</h3>
        {load.auditError && <p role="alert">Unable to load audit history. Refresh the page to retry.</p>}
        {!load.auditError && load.audit.length === 0 && <p className="muted">No bank-detail events recorded.</p>}
        {load.audit.length > 0 && <ol>{load.audit.map((event, index) => <li key={`${event.actor_id}-${event.occurred_at}-${index}`}>
          <strong>{auditLabel(event.event_type)}</strong> · {formatLagosDate(event.occurred_at)} · Actor {event.actor_id}
          {event.reason_code && <> · {event.reason_code}</>}
        </li>)}</ol>}
      </section>
    </>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
  </section>;
}

export function OperationsWaybillDetailView({ state, history, historyError, historyPage, onHistoryPageChange, onRetry, onDownload, onRefresh, onActionError }: {
  state: State; history: Page<DeliveryAttempt> | null; historyError: boolean; historyPage: number;
  onHistoryPageChange: (page: number) => void; onRetry: () => void;
  onDownload: (detail: WaybillDetail) => void; onRefresh: () => void; onActionError: (message: string) => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load Waybill detail." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Waybill not found</h1>
    <Link to="/operations/waybills">Back to Waybills</Link></section>;
  const { waybill, document, delivery } = state.data;
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
    <WaybillCopyManagementPanel invoiceId={waybill.id} invoiceNumber={waybill.waybill_number} onActionError={onActionError} />
    <section className="card waybill-section"><h2>Historical Waybill PDF</h2><p>Status: {document.status}</p>
      {document.ready_at && <p>Ready: {formatLagosDate(document.ready_at)}</p>}
      <button className="button secondary" type="button" disabled={document.status !== 'ready'}
        onClick={() => onDownload(state.data)}>Download private PDF</button></section>
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
  const [history, setHistory] = useState<Page<DeliveryAttempt> | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' }); setHistory(null); setHistoryError(false);
    if (!waybillId) { setState({ status: 'not-found' }); return; }
    void loadWaybillDetail(waybillId).then(data => {
      if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' });
    }).catch(() => { if (current) setState({ status: 'error' }); });
    void loadDeliveryHistory(waybillId, historyPage).then(data => { if (current) setHistory(data); })
      .catch(() => { if (current) setHistoryError(true); });
    return () => { current = false; };
  }, [waybillId, historyPage, revision]);
  return <>{message && <p role="alert">{message}</p>}
    <OperationsWaybillDetailView state={state} history={history} historyError={historyError} historyPage={historyPage}
      onHistoryPageChange={setHistoryPage} onRetry={refresh} onRefresh={refresh} onActionError={setMessage}
      onDownload={detail => { setMessage(''); void downloadWaybill(detail)
        .catch(() => setMessage('Unable to download private Waybill PDF.')); }} /></>;
}
