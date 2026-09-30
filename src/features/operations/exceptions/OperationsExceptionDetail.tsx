import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListResultState } from '../../../components/data/ListResultState';
import { loadExceptionDetail, resolveException, RESOLUTION_CODES, startExceptionReview,
  type ExceptionDetail, type ResolutionCode } from '../services/operationsExceptions';
import { exceptionLabel, formatExceptionDate } from './OperationsExceptionsRegister';
import './exceptions.css';

export type ExceptionDetailState = { status: 'loading' } | { status: 'error' } | { status: 'not-found' }
  | { status: 'ready'; data: ExceptionDetail };

function officerName(value: { display_name: string | null; officer_id: string } | null) {
  return value?.display_name?.trim() || (value ? `Officer ${value.officer_id.slice(0, 8)}` : '—');
}

export function OperationsExceptionDetailView({ state, busy, code, message, onCodeChange, onReview, onResolve, onRetry }: {
  state: ExceptionDetailState; busy: boolean; code: ResolutionCode | ''; message: string;
  onCodeChange: (value: ResolutionCode) => void; onReview: () => void; onResolve: () => void; onRetry: () => void;
}) {
  if (state.status === 'loading') return <ListResultState status="loading" />;
  if (state.status === 'error') return <ListResultState status="error" message="Unable to load Exception detail." onRetry={onRetry} />;
  if (state.status === 'not-found') return <section className="card"><h1>Exception not found</h1>
    <Link to="/operations/exceptions">Back to Exceptions</Link></section>;
  const item = state.data;
  return <div className="operations-exceptions-page">
    <header><Link to="/operations/exceptions">← Exceptions</Link>
      <p className="eyebrow">Operational problem management</p><h1>Exception {item.exception_id.slice(0, 8)}</h1></header>
    {message && <p role={message.startsWith('Conflict') ? 'status' : 'alert'} className="card exception-message">{message}</p>}
    <section className="card exception-detail-section"><h2>Context</h2><dl className="exception-detail-grid">
      <div><dt>Type</dt><dd>{exceptionLabel(item.exception_type)}</dd></div>
      <div><dt>Status</dt><dd>{exceptionLabel(item.status)}</dd></div>
      <div><dt>Blocks operations</dt><dd>{item.blocks_operations ? 'Yes, until resolved' : 'No'}</dd></div>
      <div><dt>Related trip</dt><dd>{item.trip_id ? <Link to={`/operations/trips/${item.trip_id}`}>{item.trip_number ?? item.trip_id.slice(0, 8)}</Link> : '—'}</dd></div>
      <div><dt>Truck</dt><dd>{item.truck_registration ?? '—'}</dd></div>
      <div><dt>Actual trip driver</dt><dd>{item.driver_name ?? '—'}</dd></div>
      <div><dt>Loading site</dt><dd>{item.loading_site_name ?? '—'}</dd></div>
      <div><dt>Offloading site</dt><dd>{item.offloading_site_name ?? '—'}</dd></div>
      <div><dt>Reported</dt><dd>{formatExceptionDate(item.created_at)} by {officerName(item.reporter)}</dd></div>
      <div><dt>Review started</dt><dd>{item.review_started_at ? `${formatExceptionDate(item.review_started_at)} by ${officerName(item.reviewer)}` : '—'}</dd></div>
      <div><dt>Resolved</dt><dd>{item.resolved_at ? `${formatExceptionDate(item.resolved_at)} by ${officerName(item.resolver)}` : '—'}</dd></div>
      <div><dt>Resolution outcome</dt><dd>{item.resolution_code ? exceptionLabel(item.resolution_code) : '—'}</dd></div>
    </dl></section>
    <section className="card exception-detail-section"><h2>Lifecycle</h2>
      <ol className="exception-lifecycle"><li>Open</li><li>{item.review_started_at ? 'In Review' : 'In Review — not started'}</li>
        <li>{item.resolved_at ? 'Resolved' : 'Resolved — pending'}</li></ol>
      <p className="muted">Resolution records the outcome only. It does not alter the related trip or other records.</p>
      {item.status === 'open' && <button className="button" type="button" disabled={busy} onClick={onReview}>
        {busy ? 'Updating…' : 'Start review'}</button>}
      {item.status === 'in_review' && <div className="exception-resolve-actions">
        <label>Resolution outcome<select value={code} onChange={event => onCodeChange(event.currentTarget.value as ResolutionCode)}>
          <option value="">Select an outcome</option>
          {RESOLUTION_CODES.map(value => <option key={value} value={value}>{exceptionLabel(value)}</option>)}</select></label>
        <button className="button" type="button" disabled={busy || !code} onClick={onResolve}>
          {busy ? 'Updating…' : 'Resolve exception'}</button>
      </div>}
      {item.status === 'resolved' && <p role="status">This exception is resolved and cannot be reopened.</p>}
    </section>
    <section className="card exception-detail-section"><h2>Lifecycle history</h2>
      {!item.history.length ? <p>No lifecycle events available.</p> : <ol className="exception-history">
        {item.history.map((entry, index) => <li key={`${entry.occurred_at}-${index}`}>
          <time dateTime={entry.occurred_at}>{formatExceptionDate(entry.occurred_at)}</time>
          {' · '}{entry.from_status ? `${exceptionLabel(entry.from_status)} → ` : ''}{exceptionLabel(entry.to_status)}
          {' · '}{officerName(entry.actor)}
        </li>)}
      </ol>}
    </section>
  </div>;
}

export function OperationsExceptionDetail() {
  const { exceptionId } = useParams();
  const [state, setState] = useState<ExceptionDetailState>({ status: 'loading' });
  const [code, setCode] = useState<ResolutionCode | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    if (!exceptionId) { setState({ status: 'not-found' }); return; }
    void loadExceptionDetail(exceptionId).then(data => {
      if (current) setState(data ? { status: 'ready', data } : { status: 'not-found' });
    }).catch(() => { if (current) setState({ status: 'error' }); });
    return () => { current = false; };
  }, [exceptionId, revision]);
  const transition = async (next: 'review' | 'resolve') => {
    if (submitting.current || state.status !== 'ready') return;
    if (next === 'resolve' && !code) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      let result;
      if (next === 'review') result = await startExceptionReview(state.data.exception_id, state.data.updated_at);
      else {
        if (!code) return;
        result = await resolveException(state.data.exception_id, state.data.updated_at, code);
      }
      if (!result.ok) setMessage(result.code === 'STALE_EXCEPTION' || result.code === 'INVALID_TRANSITION'
        ? 'Conflict: exception changed. Authoritative state has been reloaded.' : 'Exception no longer available.');
      refresh();
    } catch {
      setMessage('Unable to update Exception. Try again.');
      refresh();
    } finally { submitting.current = false; setBusy(false); }
  };
  return <OperationsExceptionDetailView state={state} busy={busy} code={code} message={message}
    onCodeChange={setCode} onReview={() => void transition('review')}
    onResolve={() => void transition('resolve')} onRetry={refresh} />;
}
