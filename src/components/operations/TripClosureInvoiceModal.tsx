import React from 'react';
import { X, Printer, Download, Truck, User, MapPin, Scale } from 'lucide-react';
import { TripClosureInvoice } from '../../types';
import { PlateDisplay } from '../common/PlateDisplay';

interface TripClosureInvoiceModalProps {
  invoice: TripClosureInvoice | null;
  onClose: () => void;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

/** Download a self-contained HTML receipt that can be reopened or printed to PDF. */
export const downloadTripClosureInvoice = (invoice: TripClosureInvoice) => {
  const openedAt = new Date(invoice.opened_at).toLocaleString();
  const closedAt = new Date(invoice.closed_at).toLocaleString();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoice_number)}</title>
<style>body{font-family:Arial,sans-serif;color:#0f172a;max-width:760px;margin:40px auto;padding:0 24px}header{display:flex;justify-content:space-between;border-bottom:2px solid #0f766e;padding-bottom:16px;margin-bottom:24px}h1{font-size:22px;margin:0 0 6px}.muted{color:#64748b;font-size:13px}.badge{color:#047857;font-weight:700;border:1px solid #86efac;background:#ecfdf5;padding:6px 10px;border-radius:999px;height:max-content}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}.card{border:1px solid #cbd5e1;border-radius:8px;padding:14px}.label{display:block;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:6px}.value{font-size:15px;font-weight:700}.total{background:#ecfdf5;border:1px solid #86efac;border-radius:8px;padding:16px;margin-top:18px;font-size:18px;font-weight:700}@media print{body{margin:0}}</style></head>
<body><header><div><h1>Trip Closure Invoice</h1><div class="muted">${escapeHtml(invoice.invoice_number)} · Waybill ${escapeHtml(invoice.trip_number)}</div></div><div class="badge">VERIFIED &amp; CLOSED</div></header>
<div class="grid"><div class="card"><span class="label">Truck</span><div class="value">${escapeHtml(invoice.truck_registration)}</div><div class="muted">${escapeHtml(invoice.truck_type || 'Registered truck')} · ${invoice.truck_capacity_tonnes || 0}T capacity</div><div class="muted">Owner: ${escapeHtml(invoice.truck_owner_name || 'Owner on file')}</div></div>
<div class="card"><span class="label">Driver</span><div class="value">${escapeHtml(invoice.driver_name)}</div><div class="muted">${escapeHtml(invoice.driver_phone || 'Phone on file')}</div><div class="muted">License: ${escapeHtml(invoice.driver_license || 'On file')}</div></div></div>
<div class="card"><span class="label">Route</span><div class="value">${escapeHtml(invoice.loading_site_name)} → ${escapeHtml(invoice.offloading_site_name)}</div><div class="muted">Opened: ${escapeHtml(openedAt)}</div><div class="muted">Closed: ${escapeHtml(closedAt)}</div></div>
<div class="total">Verified delivery: ${invoice.quantity_tonnes.toFixed(2)} tonnes</div></body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${invoice.invoice_number}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const TripClosureInvoiceModal: React.FC<TripClosureInvoiceModalProps> = ({ invoice, onClose }) => {
  if (!invoice) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="card"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(720px, calc(100vw - 2rem))', maxHeight: '90vh', overflowY: 'auto', padding: 0 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.08em' }}>TRIP CLOSURE INVOICE</span>
            <h3 style={{ margin: '0.2rem 0 0', fontSize: '1.1rem' }}>{invoice.invoice_number}</h3>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose} aria-label="Close invoice">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700 }}>WAYBILL</span>
              <strong style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>{invoice.trip_number}</strong>
            </div>
            <span className="badge badge-closed">VERIFIED & CLOSED</span>
          </div>

          <div className="grid-2">
            <div style={{ padding: '0.9rem', backgroundColor: '#F8FAFC', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 800, marginBottom: '0.55rem' }}><Truck size={14} /> TRUCK SNAPSHOT</div>
              <PlateDisplay plate={invoice.truck_registration} size="sm" />
              <div style={{ marginTop: '0.55rem', fontSize: '0.78rem' }}>{invoice.truck_type || 'Registered truck'}</div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{invoice.truck_owner_name || 'Owner on file'} • {invoice.truck_capacity_tonnes || 0}T capacity</div>
            </div>
            <div style={{ padding: '0.9rem', backgroundColor: '#F8FAFC', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 800, marginBottom: '0.55rem' }}><User size={14} /> DRIVER SNAPSHOT</div>
              <strong style={{ display: 'block', fontSize: '0.9rem' }}>{invoice.driver_name}</strong>
              <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{invoice.driver_phone || 'Phone on file'}</div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>License: {invoice.driver_license || 'On file'}</div>
            </div>
          </div>

          <div style={{ padding: '0.9rem', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}><MapPin size={15} color="var(--brand-primary)" /><div><span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>ROUTE</span><strong style={{ fontSize: '0.78rem' }}>{invoice.loading_site_name}</strong><span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>to {invoice.offloading_site_name}</span></div></div>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}><Scale size={15} color="#059669" /><div><span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>VERIFIED DELIVERY</span><strong style={{ fontSize: '0.9rem', color: '#047857' }}>{invoice.quantity_tonnes.toFixed(2)} tonnes</strong><span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Closed {new Date(invoice.closed_at).toLocaleString()}</span></div></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => downloadTripClosureInvoice(invoice)}><Download size={15} /> Download Invoice</button>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> Print Invoice</button>
          </div>
        </div>
      </div>
    </div>
  );
};
