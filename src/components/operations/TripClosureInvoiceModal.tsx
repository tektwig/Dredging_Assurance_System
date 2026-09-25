import React, { useState, useCallback } from 'react';
import { X, Printer, Download, Truck, User, MapPin, Scale, Eye, Shield, Calendar, Hash } from 'lucide-react';
import { TripClosureInvoice } from '../../types';
import { PlateDisplay } from '../common/PlateDisplay';
import jsPDF from 'jspdf';

interface TripClosureInvoiceModalProps {
  invoice: TripClosureInvoice | null;
  onClose: () => void;
}

/* ─── PDF GENERATION ──────────────────────────────────────────── */

const BRAND_TEAL  = [7, 118, 110] as const;   // #0F766E → header / accent
const DARK_NAVY   = [15, 23, 42] as const;     // #0F172A → body text
const MUTED_GRAY  = [100, 116, 139] as const;  // #64748B → secondary
const LIGHT_BG    = [248, 250, 252] as const;  // #F8FAFC → card bg
const BORDER_CLR  = [203, 213, 225] as const;  // #CBD5E1 → borders
const EMERALD     = [4, 120, 87] as const;     // #047857 → verified badge
const WHITE       = [255, 255, 255] as const;

/** Build a professional PDF and return the jsPDF instance. */
const buildInvoicePdf = (inv: TripClosureInvoice): jsPDF => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();   // 210
  const H   = doc.internal.pageSize.getHeight();  // 297
  const LM  = 18; // left margin
  const RM  = W - 18;  // right margin x
  const CW  = RM - LM; // content width

  const openedAt = new Date(inv.opened_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const closedAt = new Date(inv.closed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const issuedAt = new Date(inv.issued_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ─── HEADER BAND ──────────────────────
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(0, 0, W, 38, 'F');

  // Company name
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('DredgeOps Assurance', LM, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Sand & Aggregate Logistics Control System', LM, 23);

  // Invoice label on right
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', RM, 17, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Trip Closure — Delivery Verification', RM, 24, { align: 'right' });

  // Thin accent line below header
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 38, W, 1.2, 'F');

  let y = 48;

  // ─── INVOICE META ROW ────────────────
  const colWidth = CW / 3;

  const drawMetaBlock = (label: string, value: string, x: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED_GRAY);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...DARK_NAVY);
    doc.text(value, x, y + 5.5);
  };

  drawMetaBlock('INVOICE NO.', inv.invoice_number, LM);
  drawMetaBlock('WAYBILL REF', inv.trip_number, LM + colWidth);
  drawMetaBlock('DATE ISSUED', issuedAt, LM + colWidth * 2);

  y += 16;

  // Separator
  doc.setDrawColor(...BORDER_CLR);
  doc.setLineWidth(0.3);
  doc.line(LM, y, RM, y);
  y += 8;

  // ─── VERIFIED BADGE ─────────────────
  const badgeW = 50;
  const badgeH = 8;
  const badgeX = RM - badgeW;
  doc.setFillColor(236, 253, 245); // light emerald bg
  doc.setDrawColor(...EMERALD);
  doc.setLineWidth(0.4);
  doc.roundedRect(badgeX, y - 5, badgeW, badgeH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...EMERALD);
  doc.text('✓  VERIFIED & CLOSED', badgeX + badgeW / 2, y + 0.2, { align: 'center' });

  // ─── TRUCK & DRIVER SECTION ─────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_TEAL);
  doc.text('TRANSPORT DETAILS', LM, y);
  y += 8;

  // Two-column cards
  const cardW = (CW - 6) / 2;
  const cardH = 34;

  // Truck Card
  doc.setFillColor(...LIGHT_BG);
  doc.setDrawColor(...BORDER_CLR);
  doc.setLineWidth(0.3);
  doc.roundedRect(LM, y, cardW, cardH, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('TRUCK', LM + 5, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...DARK_NAVY);
  doc.text(inv.truck_registration, LM + 5, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED_GRAY);
  doc.text(inv.truck_type || 'Registered Truck', LM + 5, y + 19);
  doc.text(`Capacity: ${inv.truck_capacity_tonnes || 0} Tonnes`, LM + 5, y + 24);
  doc.text(`Owner: ${inv.truck_owner_name || 'On file'}`, LM + 5, y + 29);

  // Driver Card
  const driverX = LM + cardW + 6;
  doc.setFillColor(...LIGHT_BG);
  doc.roundedRect(driverX, y, cardW, cardH, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('DRIVER', driverX + 5, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...DARK_NAVY);
  doc.text(inv.driver_name, driverX + 5, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED_GRAY);
  doc.text(`Phone: ${inv.driver_phone || 'On file'}`, driverX + 5, y + 19);
  doc.text(`License: ${inv.driver_license || 'On file'}`, driverX + 5, y + 24);

  y += cardH + 10;

  // ─── ROUTE SECTION ──────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_TEAL);
  doc.text('ROUTE & TIMELINE', LM, y);
  y += 6;

  // Route card
  const routeH = 30;
  doc.setFillColor(...LIGHT_BG);
  doc.setDrawColor(...BORDER_CLR);
  doc.roundedRect(LM, y, CW, routeH, 2, 2, 'FD');

  // Origin
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('LOADING ORIGIN', LM + 5, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK_NAVY);
  doc.text(inv.loading_site_name, LM + 5, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED_GRAY);
  doc.text(`Dispatched: ${openedAt}`, LM + 5, y + 17.5);

  // Arrow
  const midX = LM + CW / 2;
  doc.setFillColor(...BRAND_TEAL);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND_TEAL);
  doc.text('→', midX, y + 13, { align: 'center' });

  // Destination
  const destX = midX + 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('OFFLOADING DESTINATION', destX, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK_NAVY);
  doc.text(inv.offloading_site_name, destX, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED_GRAY);
  doc.text(`Completed: ${closedAt}`, destX, y + 17.5);

  y += routeH + 10;

  // ─── DELIVERY TABLE ─────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_TEAL);
  doc.text('DELIVERY SUMMARY', LM, y);
  y += 6;

  // Table header
  const tableHeaderH = 9;
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(LM, y, CW, tableHeaderH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  doc.text('DESCRIPTION', LM + 5, y + 6);
  doc.text('QUANTITY', RM - 5, y + 6, { align: 'right' });
  y += tableHeaderH;

  // Row 1 — Delivered material
  const rowH = 10;
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...BORDER_CLR);
  doc.rect(LM, y, CW, rowH, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DARK_NAVY);
  doc.text('Sand / Aggregate — Verified Delivery', LM + 5, y + 6.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`${inv.quantity_tonnes.toFixed(2)} Tonnes`, RM - 5, y + 6.5, { align: 'right' });
  y += rowH;

  // Row 2 — Truck capacity
  doc.setFillColor(...LIGHT_BG);
  doc.rect(LM, y, CW, rowH, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('Truck Rated Capacity', LM + 5, y + 6.5);
  doc.text(`${inv.truck_capacity_tonnes || 0} Tonnes`, RM - 5, y + 6.5, { align: 'right' });
  y += rowH;

  // Row 3 — Variance
  const variancePct = inv.truck_capacity_tonnes
    ? (((inv.quantity_tonnes - inv.truck_capacity_tonnes) / inv.truck_capacity_tonnes) * 100).toFixed(1)
    : '0.0';
  doc.setFillColor(...WHITE);
  doc.rect(LM, y, CW, rowH, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('Load Variance', LM + 5, y + 6.5);
  doc.text(`${Number(variancePct) > 0 ? '+' : ''}${variancePct}%`, RM - 5, y + 6.5, { align: 'right' });
  y += rowH;

  // Total row
  const totalH = 12;
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(...EMERALD);
  doc.setLineWidth(0.5);
  doc.rect(LM, y, CW, totalH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...EMERALD);
  doc.text('TOTAL VERIFIED DELIVERY', LM + 5, y + 8);
  doc.text(`${inv.quantity_tonnes.toFixed(2)} Tonnes`, RM - 5, y + 8, { align: 'right' });
  y += totalH + 12;

  // ─── CERTIFICATION / NOTES ──────────
  doc.setDrawColor(...BORDER_CLR);
  doc.setLineWidth(0.3);
  doc.line(LM, y, RM, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...DARK_NAVY);
  doc.text('VERIFICATION CERTIFICATION', LM, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED_GRAY);
  const certLines = [
    'This invoice certifies that the above delivery has been verified at the offloading destination.',
    'Volume/weight was confirmed against the loading dispatch record and the truck\'s rated capacity.',
    'Any variance exceeding ±10% of the loaded quantity is automatically escalated for managerial triage.',
    `Document generated by DredgeOps Assurance System on ${issuedAt}.`,
  ];
  certLines.forEach((line) => {
    doc.text(line, LM, y);
    y += 4;
  });

  // ─── WATERMARK (diagonal, faded) ────
  doc.saveGraphicsState();
  doc.setGState(new (doc as any).GState({ opacity: 0.04 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(72);
  doc.setTextColor(...DARK_NAVY);
  // rotate and stamp
  const cx = W / 2;
  const cy = H / 2;
  doc.text('VERIFIED', cx, cy, { align: 'center', angle: 35 });
  doc.restoreGraphicsState();

  // ─── FOOTER ─────────────────────────
  const footerY = H - 14;
  doc.setDrawColor(...BORDER_CLR);
  doc.setLineWidth(0.3);
  doc.line(LM, footerY, RM, footerY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_GRAY);
  doc.text('DredgeOps Assurance System — Secure Trip Closure Invoice', LM, footerY + 5);
  doc.text(`Page 1 of 1  |  ${inv.invoice_number}`, RM, footerY + 5, { align: 'right' });

  return doc;
};

/** Build the PDF and return a blob URL for embedding. */
export const getInvoiceBlobUrl = (invoice: TripClosureInvoice): string => {
  const doc = buildInvoicePdf(invoice);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
};

/** Open the PDF in a new browser tab for viewing. */
export const viewTripClosureInvoice = (invoice: TripClosureInvoice) => {
  window.open(getInvoiceBlobUrl(invoice), '_blank');
};

/** Download the PDF directly. */
export const downloadTripClosureInvoice = (invoice: TripClosureInvoice) => {
  const doc = buildInvoicePdf(invoice);
  doc.save(`${invoice.invoice_number}.pdf`);
};

/* ─── MODAL COMPONENT ─────────────────────────────────────────── */

export const TripClosureInvoiceModal: React.FC<TripClosureInvoiceModalProps> = ({ invoice, onClose }) => {
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const openPdfPreview = useCallback(() => {
    if (!invoice) return;
    const url = getInvoiceBlobUrl(invoice);
    setPdfPreviewUrl(url);
  }, [invoice]);

  const closePdfPreview = useCallback(() => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null);
  }, [pdfPreviewUrl]);

  if (!invoice) return null;

  const openedAt = new Date(invoice.opened_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const closedAt = new Date(invoice.closed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const issuedAt = new Date(invoice.issued_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const variancePct = invoice.truck_capacity_tonnes
    ? (((invoice.quantity_tonnes - invoice.truck_capacity_tonnes) / invoice.truck_capacity_tonnes) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card closure-invoice-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(780px, calc(100vw - 2rem))',
          maxWidth: '780px',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 0,
          borderRadius: '12px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* ── HEADER ── */}
        <div style={{
          background: 'linear-gradient(135deg, #0F766E 0%, #065F46 100%)',
          padding: '1.5rem 1.75rem',
          borderRadius: '12px 12px 0 0',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Decorative pattern */}
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: '40%',
            background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.05) 100%)',
            pointerEvents: 'none',
          }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <Shield size={16} color="rgba(255,255,255,0.7)" />
                <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Trip Closure Invoice
                </span>
              </div>
              <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#fff', fontWeight: 700 }}>
                {invoice.invoice_number}
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.2rem', display: 'block' }}>
                Waybill {invoice.trip_number}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.35rem 0.75rem',
                borderRadius: '999px',
                letterSpacing: '0.04em',
              }}>
                ✓ VERIFIED & CLOSED
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close invoice"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  padding: '0.4rem',
                  cursor: 'pointer',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="closure-invoice-body" style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Meta row */}
          <div className="closure-invoice-meta-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {[
              { icon: <Hash size={13} />, label: 'Invoice No.', value: invoice.invoice_number },
              { icon: <Hash size={13} />, label: 'Waybill Ref', value: invoice.trip_number },
              { icon: <Calendar size={13} />, label: 'Issued', value: issuedAt },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '0.75rem',
                background: 'rgba(248, 250, 252, 0.8)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.06em', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                  {item.icon} {item.label}
                </div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Transport Details — Two columns */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: '#0F766E' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Transport Details</span>
            </div>
            <div className="closure-invoice-transport-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {/* Truck */}
              <div style={{
                padding: '1rem',
                background: 'linear-gradient(145deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.5) 100%)',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, marginBottom: '0.65rem', textTransform: 'uppercase' }}>
                  <Truck size={14} /> Truck
                </div>
                <PlateDisplay plate={invoice.truck_registration} size="sm" />
                <div style={{ marginTop: '0.55rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{invoice.truck_type || 'Registered truck'}</div>
                <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {invoice.truck_owner_name || 'Owner on file'} • {invoice.truck_capacity_tonnes || 0}T capacity
                </div>
              </div>
              {/* Driver */}
              <div style={{
                padding: '1rem',
                background: 'linear-gradient(145deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.5) 100%)',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, marginBottom: '0.65rem', textTransform: 'uppercase' }}>
                  <User size={14} /> Driver
                </div>
                <strong style={{ display: 'block', fontSize: '0.95rem' }}>{invoice.driver_name}</strong>
                <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{invoice.driver_phone || 'Phone on file'}</div>
                <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>License: {invoice.driver_license || 'On file'}</div>
              </div>
            </div>
          </div>

          {/* Route & Timeline */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: '#0F766E' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Route & Timeline</span>
            </div>
            <div className="closure-invoice-route-grid" style={{
              padding: '1rem 1.25rem',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              background: 'linear-gradient(145deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.5) 100%)',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: '1rem',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MapPin size={13} color="#0F766E" />
                  <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Loading Origin</span>
                </div>
                <strong style={{ display: 'block', fontSize: '0.88rem', marginTop: '0.3rem' }}>{invoice.loading_site_name}</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Dispatched: {openedAt}</span>
              </div>

              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
              }}>
                <div style={{
                  width: 36, height: 36,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0F766E, #059669)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '1.1rem', fontWeight: 700,
                }}>→</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Destination</span>
                  <MapPin size={13} color="#059669" />
                </div>
                <strong style={{ display: 'block', fontSize: '0.88rem', marginTop: '0.3rem' }}>{invoice.offloading_site_name}</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Completed: {closedAt}</span>
              </div>
            </div>
          </div>

          {/* Delivery Summary Table */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: '#0F766E' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Delivery Summary</span>
            </div>

            {/* Table */}
            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
              {/* Header row */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                padding: '0.6rem 1rem',
                background: 'linear-gradient(135deg, #0F766E 0%, #065F46 100%)',
                color: '#fff',
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                <span>Description</span>
                <span>Quantity</span>
              </div>

              {/* Data rows */}
              {[
                { label: 'Sand / Aggregate — Verified Delivery', value: `${invoice.quantity_tonnes.toFixed(2)} Tonnes`, bold: true },
                { label: 'Truck Rated Capacity', value: `${invoice.truck_capacity_tonnes || 0} Tonnes`, bold: false },
                { label: 'Load Variance', value: `${Number(variancePct) > 0 ? '+' : ''}${variancePct}%`, bold: false },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto',
                  padding: '0.65rem 1rem',
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(248,250,252,0.9)',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: '0.82rem',
                  fontWeight: row.bold ? 700 : 400,
                  color: row.bold ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  <span>{row.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{row.value}</span>
                </div>
              ))}

              {/* Total row */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                padding: '0.85rem 1rem',
                background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
                borderTop: '2px solid #059669',
                fontSize: '0.95rem',
                fontWeight: 800,
                color: '#047857',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Scale size={16} /> TOTAL VERIFIED DELIVERY
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{invoice.quantity_tonnes.toFixed(2)} Tonnes</span>
              </div>
            </div>
          </div>

          {/* Certification Notice */}
          <div style={{
            padding: '0.85rem 1rem',
            background: 'rgba(248, 250, 252, 0.7)',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            borderLeft: '3px solid #0F766E',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Verification Certification
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              This invoice certifies that the above delivery has been verified at the offloading destination.
              Volume/weight was confirmed against the loading dispatch record. Any variance exceeding ±10% is automatically escalated.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="closure-invoice-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', paddingTop: '0.25rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openPdfPreview}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Eye size={15} /> View PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => downloadTripClosureInvoice(invoice)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Download size={15} /> Download PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.print()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Printer size={15} /> Print
            </button>
          </div>
        </div>
      </div>

      {/* ── PDF PREVIEW POPUP ── */}
      {pdfPreviewUrl && (
        <div
          className="pdf-preview-overlay"
          onClick={closePdfPreview}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          {/* Toolbar */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(900px, 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.6rem 1rem',
              background: 'rgba(15, 23, 42, 0.95)',
              borderRadius: '12px 12px 0 0',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
              <Shield size={16} color="#34D399" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>{invoice.invoice_number}</span>
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>— PDF Preview</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadTripClosureInvoice(invoice); }}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  padding: '0.35rem 0.7rem',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'background 0.15s',
                }}
                title="Download PDF"
              >
                <Download size={13} /> Download
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closePdfPreview(); }}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  padding: '0.35rem',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                title="Close preview"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* PDF iframe */}
          <iframe
            onClick={(e) => e.stopPropagation()}
            src={pdfPreviewUrl}
            title={`Invoice ${invoice.invoice_number}`}
            style={{
              width: 'min(900px, 100%)',
              flex: 1,
              border: 'none',
              borderRadius: '0 0 12px 12px',
              background: '#fff',
              minHeight: '300px',
            }}
          />
        </div>
      )}
    </div>
  );
};
