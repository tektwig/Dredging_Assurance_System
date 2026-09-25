import React from 'react';
import { X, Printer, Truck, User, MapPin, Scale } from 'lucide-react';
import { TripClosureInvoice } from '../../types';
import { PlateDisplay } from '../common/PlateDisplay';

interface TripClosureInvoiceModalProps {
  invoice: TripClosureInvoice | null;
  onClose: () => void;
}

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
            <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> Print Invoice</button>
          </div>
        </div>
      </div>
    </div>
  );
};
