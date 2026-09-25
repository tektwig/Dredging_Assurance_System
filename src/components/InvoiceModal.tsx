import React, { useState, useEffect } from 'react';
import { useAppState } from '../context/AppStateContext';
import { Invoice, InvoiceItem, Trip } from '../types';
import { COMMERCIAL_CLIENT_PRESETS } from '../services/mockData';
import { TektwigLogo } from './common/TektwigLogo';
import { PlateDisplay } from './common/PlateDisplay';
import {
  X,
  Printer,
  CheckCircle,
  CreditCard,
  Building2,
  QrCode,
  Share2,
  FileText,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldCheck,
  MapPin,
  Calendar,
} from 'lucide-react';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
  preselectedTrip?: Trip | null;
}

function numberToWords(amount: number): string {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertGroup(num: number): string {
    let str = '';
    if (num >= 100) {
      str += units[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }
    if (num >= 20) {
      str += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      str += units[num] + ' ';
    }
    return str.trim();
  }

  const intPart = Math.floor(amount);
  if (intPart === 0) return 'Zero Naira Only';

  const billions = Math.floor(intPart / 1000000000);
  const millions = Math.floor((intPart % 1000000000) / 1000000);
  const thousands = Math.floor((intPart % 1000000) / 1000);
  const remainder = intPart % 1000;

  let result = '';
  if (billions > 0) result += convertGroup(billions) + ' Billion ';
  if (millions > 0) result += convertGroup(millions) + ' Million ';
  if (thousands > 0) result += convertGroup(thousands) + ' Thousand ';
  if (remainder > 0) result += convertGroup(remainder) + ' ';

  const kobo = Math.round((amount - intPart) * 100);
  if (kobo > 0) {
    return result.trim() + ' Naira, ' + convertGroup(kobo) + ' Kobo Only';
  }
  return result.trim() + ' Naira Only';
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  invoice: propInvoice,
  preselectedTrip,
}) => {
  const { trips, createInvoice, markInvoiceAsPaid } = useAppState();

  // If propInvoice is provided, view that invoice; otherwise create mode
  const [activeInvoice, setActiveInvoice] = useState<Invoice | undefined>(propInvoice || undefined);
  const [isCopied, setIsCopied] = useState(false);
  const [accountCopied, setAccountCopied] = useState(false);
  const [showPaymentPrompt, setShowPaymentPrompt] = useState(false);
  const [paymentRefInput, setPaymentRefInput] = useState('');

  // Builder form state (when creating new invoice)
  const [selectedClientIndex, setSelectedClientIndex] = useState<number>(0);
  const [customerName, setCustomerName] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.name ?? '');
  const [customerEmail, setCustomerEmail] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.email ?? '');
  const [customerPhone, setCustomerPhone] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.phone ?? '');
  const [customerAddress, setCustomerAddress] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.address ?? '');
  const [customerTin, setCustomerTin] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.tin ?? '');
  const [projectSite, setProjectSite] = useState(COMMERCIAL_CLIENT_PRESETS[0]?.default_project ?? '');
  const [paymentTerms, setPaymentTerms] = useState('Net 14 Days');
  const taxRate = 7.5;

  // Selected trips for invoice
  const closedTrips = trips.filter((t) => t.status === 'closed');
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>(() => {
    if (preselectedTrip && preselectedTrip.status === 'closed') {
      return [preselectedTrip.id];
    }
    return closedTrips.slice(0, 2).map((t) => t.id);
  });

  // Custom additional items
  const [customItems, setCustomItems] = useState<
    Array<{ description: string; sand_type: string; quantity: number; unit_price: number }>
  >([]);

  // Default rates
  const [defaultRatePerM3, setDefaultRatePerM3] = useState<number>(18500);

  // Synchronize when propInvoice or preselectedTrip changes
  useEffect(() => {
    setActiveInvoice(propInvoice || undefined);
    if (preselectedTrip && preselectedTrip.status === 'closed') {
      setSelectedTripIds([preselectedTrip.id]);
    }
  }, [propInvoice, preselectedTrip, isOpen]);

  if (!isOpen) return null;

  // Sync preset changes
  const handleSelectPreset = (idx: number) => {
    setSelectedClientIndex(idx);
    const preset = COMMERCIAL_CLIENT_PRESETS[idx];
    if (preset) {
      setCustomerName(preset.name);
      setCustomerEmail(preset.email);
      setCustomerPhone(preset.phone);
      setCustomerAddress(preset.address);
      setCustomerTin(preset.tin);
      setProjectSite(preset.default_project);
    }
  };

  const handleToggleTrip = (tripId: string) => {
    setSelectedTripIds((prev) =>
      prev.includes(tripId) ? prev.filter((id) => id !== tripId) : [...prev, tripId]
    );
  };

  const handleAddCustomItem = () => {
    setCustomItems((prev) => [
      ...prev,
      { description: 'Lagoon Waterfront Sand Consignment', sand_type: 'Coarse Sharp Sand (Fill)', quantity: 35, unit_price: 18500 },
    ]);
  };

  const handleRemoveCustomItem = (idx: number) => {
    setCustomItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Compile items from selected trips + custom items
  const compiledItems: InvoiceItem[] = [
    ...selectedTripIds.map((tid) => {
      const trip = trips.find((t) => t.id === tid);
      const qty = trip?.offloading_event?.quantity || trip?.truck?.capacity || 30;
      const unit = trip?.offloading_event?.unit || trip?.truck?.capacity_unit || 'm3';
      const unitPrice = defaultRatePerM3;
      return {
        id: `item-trip-${tid}`,
        trip_id: trip?.id,
        trip_number: trip?.trip_number,
        truck_plate: trip?.truck?.registration_number,
        description: `Delivered Sharp Sand Consignment — Waybill ${trip?.trip_number || 'TRIP'} (Truck: ${trip?.truck?.registration_number || 'N/A'})`,
        sand_type: 'Washed Lagoon Sharp Sand (Coarse Grade)',
        quantity: qty,
        unit,
        unit_price: unitPrice,
        amount: qty * unitPrice,
      };
    }),
    ...customItems.map((c, i) => ({
      id: `item-custom-${i}`,
      description: c.description,
      sand_type: c.sand_type,
      quantity: c.quantity,
      unit: 'm3' as const,
      unit_price: c.unit_price,
      amount: c.quantity * c.unit_price,
    })),
  ];

  const subtotal = compiledItems.reduce((sum, it) => sum + it.amount, 0);
  const taxAmount = Math.round((subtotal * (taxRate / 100)) * 100) / 100;
  const totalAmount = subtotal + taxAmount;

  const handleGenerateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    const res = createInvoice({
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      customer_tin: customerTin,
      project_site_name: projectSite,
      items: compiledItems,
      tax_rate: taxRate,
      payment_terms: paymentTerms,
      notes: `Sand dredging consignments verified by weighbridge ticketing. Corporate FIRS VAT registration active.`,
    });

    if (res.success && res.invoice) {
      setActiveInvoice(res.invoice);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(
      `https://dredgeops.tektwig.com/invoices/${activeInvoice?.invoice_number || 'INV'}`
    );
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleCopyNuban = (nuban: string) => {
    navigator.clipboard.writeText(nuban);
    setAccountCopied(true);
    setTimeout(() => setAccountCopied(false), 2000);
  };

  const handleConfirmPayment = () => {
    if (!activeInvoice) return;
    const ref = paymentRefInput.trim() || `NIBSS-EFT-${Date.now().toString().slice(-6)}`;
    markInvoiceAsPaid(activeInvoice.id, ref);
    setActiveInvoice((prev) => (prev ? { ...prev, status: 'paid', paid_reference: ref } : undefined));
    setShowPaymentPrompt(false);
    setPaymentRefInput('');
  };

  return (
    <div className="invoice-modal-backdrop" onClick={onClose}>
      <div
        className="invoice-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* VIEW / PRINT INVOICE MODE */}
        {activeInvoice ? (
          <>
            {/* Top Toolbar (Non-printable) */}
            <div className="invoice-toolbar no-print">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--brand-primary-tint)',
                    color: 'var(--brand-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={18} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>
                      Commercial Tax Invoice
                    </span>
                    <span className="mono" style={{ fontWeight: 800, color: 'var(--brand-primary)', fontSize: '0.9rem' }}>
                      {activeInvoice.invoice_number}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Billed to: <strong>{activeInvoice.customer_name}</strong>
                  </span>
                </div>
                <span className={`badge ${activeInvoice.status === 'paid' ? 'badge-closed' : activeInvoice.status === 'overdue' ? 'badge-exception' : 'badge-open'}`}>
                  {activeInvoice.status === 'paid' ? 'PAID & SETTLED' : activeInvoice.status.toUpperCase()}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {activeInvoice.status !== 'paid' && (
                  <button
                    type="button"
                    onClick={() => setShowPaymentPrompt(true)}
                    className="btn btn-success"
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.8125rem', minHeight: '36px' }}
                  >
                    <CheckCircle size={15} />
                    Mark as Paid
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn btn-secondary"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.8125rem', minHeight: '36px' }}
                  title="Copy Invoice Link"
                >
                  <Share2 size={15} />
                  {isCopied ? 'Copied!' : 'Share Link'}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="btn btn-primary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem', minHeight: '36px' }}
                  title="Print or Save as PDF"
                >
                  <Printer size={15} />
                  Print / Save PDF
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary"
                  style={{ padding: '0.45rem 0.65rem', minHeight: '36px', color: 'var(--text-secondary)' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Payment Prompt Dialog (Non-printable) */}
            {showPaymentPrompt && (
              <div
                className="no-print"
                style={{
                  backgroundColor: '#ECFDF5',
                  border: '1.5px solid #6EE7B7',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div>
                  <strong style={{ color: '#065F46', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <CheckCircle size={16} /> Record Customer Remittance Settlement
                  </strong>
                  <span style={{ fontSize: '0.8rem', color: '#047857' }}>
                    Enter NIBSS / Bank EFT Reference or Paystack confirmation code:
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="e.g. NIBSS-ZENITH-891024"
                    value={paymentRefInput}
                    onChange={(e) => setPaymentRefInput(e.target.value)}
                    className="form-input"
                    style={{ minHeight: '36px', width: '220px', fontSize: '0.85rem' }}
                  />
                  <button
                    type="button"
                    onClick={handleConfirmPayment}
                    className="btn btn-success"
                    style={{ minHeight: '36px', padding: '0.45rem 0.85rem', fontSize: '0.8125rem' }}
                  >
                    Confirm Settlement
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPaymentPrompt(false)}
                    className="btn btn-secondary"
                    style={{ minHeight: '36px', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* OFFICIAL PRINTABLE COMMERCIAL TAX INVOICE DOCUMENT */}
            {/* ================================================================= */}
            <div className="invoice-paper">
              {/* Official Rubber Status Stamp */}
              <div className={`invoice-stamp invoice-stamp-${activeInvoice.status}`}>
                <span>{activeInvoice.status === 'paid' ? 'PAID & SETTLED' : activeInvoice.status === 'issued' ? 'TAX INVOICE' : 'OVERDUE'}</span>
                <span className="invoice-stamp-sub">
                  {activeInvoice.status === 'paid'
                    ? activeInvoice.paid_reference || 'NIBSS EFT VERIFIED'
                    : activeInvoice.status === 'issued'
                    ? 'PAYMENT PENDING'
                    : 'IMMEDIATE ACTION REQUIRED'}
                </span>
              </div>

              {/* Corporate Letterhead & Document Title */}
              <div
                className="invoice-letterhead"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  borderBottom: '2.5px solid var(--border-default)',
                  paddingBottom: '2rem',
                  marginBottom: '2rem',
                  flexWrap: 'wrap',
                  gap: '1.5rem',
                }}
              >
                <div className="invoice-company-details" style={{ maxWidth: '58%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.65rem' }}>
                    <TektwigLogo height={46} />
                    <div style={{ borderLeft: '2px solid var(--border-default)', paddingLeft: '0.85rem' }}>
                      <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                        Tektwig Dredging & Maritime Logistics
                      </h2>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Lagoon Sand Extraction & Revenue Assurance
                      </span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0.5rem', lineHeight: '1.45' }}>
                    Ipakodo Industrial Jetty Corridor, Majidun Waterfront Free Trade Zone, Ikorodu / Lekki-Epe Expressway, Lagos State, Nigeria
                  </p>

                  {/* Statutory Regulatory Registration Badges */}
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                    <span style={{ backgroundColor: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                      CAC RC: <strong style={{ color: '#0F172A' }}>RC-1849201</strong>
                    </span>
                    <span style={{ backgroundColor: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                      FIRS TIN: <strong style={{ color: '#0F172A' }}>23091823-0001</strong>
                    </span>
                    <span style={{ backgroundColor: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                      SCUML: <strong style={{ color: '#0F172A' }}>RN:SC-291048</strong>
                    </span>
                    <span style={{ backgroundColor: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                      MMSD Permit: <strong style={{ color: '#0F172A' }}>DRG/2026/041</strong>
                    </span>
                  </div>
                </div>

                {/* Right Document Identity */}
                <div className="invoice-document-id" style={{ textAlign: 'right', minWidth: '220px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      backgroundColor: 'var(--brand-primary-tint)',
                      color: 'var(--brand-primary)',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      padding: '0.3rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                    }}
                  >
                    COMMERCIAL TAX INVOICE
                  </div>
                  <h1
                    className="mono"
                    style={{
                      fontSize: '1.6rem',
                      fontWeight: 900,
                      color: '#0F172A',
                      margin: '0.25rem 0 0.5rem',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {activeInvoice.invoice_number}
                  </h1>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Issued under Federal Inland Revenue Service Act
                  </span>
                </div>
              </div>

              {/* Invoice Meta Grid (Client Details vs Delivery Specifications) */}
              <div
                className="invoice-meta-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1fr',
                  gap: '1.5rem',
                  marginBottom: '2rem',
                }}
              >
                {/* Left Card: Customer / Contractor Info */}
                <div className="invoice-meta-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--brand-primary)', marginBottom: '0.4rem' }}>
                    <Building2 size={15} />
                    <span style={{ fontSize: '0.725rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Billed To (Contractor / Customer)
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', margin: '0 0 0.35rem' }}>
                    {activeInvoice.customer_name}
                  </h3>

                  {activeInvoice.project_site_name && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        color: 'var(--brand-primary)',
                        backgroundColor: 'var(--brand-primary-tint)',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <MapPin size={13} /> Project: {activeInvoice.project_site_name}
                    </div>
                  )}

                  {activeInvoice.customer_address && (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem', lineHeight: '1.4' }}>
                      {activeInvoice.customer_address}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                    {activeInvoice.customer_tin && (
                      <span>TIN: <strong style={{ color: '#0F172A' }}>{activeInvoice.customer_tin}</strong></span>
                    )}
                    {activeInvoice.customer_phone && (
                      <span>Tel: <strong style={{ color: '#0F172A' }}>{activeInvoice.customer_phone}</strong></span>
                    )}
                    {activeInvoice.customer_email && (
                      <span>Email: <strong style={{ color: '#0F172A' }}>{activeInvoice.customer_email}</strong></span>
                    )}
                  </div>
                </div>

                {/* Right Card: Movement & Billing Terms */}
                <div className="invoice-meta-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Calendar size={14} /> Invoice Date:
                    </span>
                    <strong style={{ color: '#0F172A' }}>{activeInvoice.issue_date}</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Due Date:</span>
                    <strong style={{ color: 'var(--accent-gold-dark)' }}>{activeInvoice.due_date}</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Terms:</span>
                    <span style={{ fontWeight: 700, color: '#0F172A' }}>{activeInvoice.payment_terms}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Extraction Origin:</span>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>Epe Lagoon Basin Pit Alpha</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Settlement Currency:</span>
                    <strong style={{ color: '#0F172A' }}>Nigerian Naira (NGN / ₦)</strong>
                  </div>
                </div>
              </div>

              {/* Waybill Consignment Items Table */}
              <div className="invoice-table-wrap" style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Consignment Description & Specification</th>
                      <th>Waybill / Truck</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Delivered Qty</th>
                      <th style={{ textAlign: 'right', width: '130px' }}>Unit Rate (₦)</th>
                      <th style={{ textAlign: 'right', width: '150px' }}>Total Amount (₦)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeInvoice.items.map((item, idx) => (
                      <tr key={item.id}>
                        <td data-label="Item" style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem' }}>
                          {idx + 1}
                        </td>
                        <td data-label="Description">
                          <strong style={{ color: '#0F172A', display: 'block', fontSize: '0.875rem' }}>
                            {item.description}
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Grade: <strong>{item.sand_type}</strong> • Salt Washed • Quality Verified
                          </span>
                        </td>
                        <td data-label="Waybill / Truck">
                          {item.trip_number ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span className="mono" style={{ fontWeight: 700, color: 'var(--brand-primary)', fontSize: '0.8rem' }}>
                                {item.trip_number}
                              </span>
                              {item.truck_plate && (
                                <PlateDisplay plate={item.truck_plate} size="sm" />
                              )}
                            </div>
                          ) : (
                            <span className="badge badge-blue">Batch Consignment</span>
                          )}
                        </td>
                        <td data-label="Delivered Qty" style={{ textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                          {item.quantity.toLocaleString()} {item.unit}
                        </td>
                        <td data-label="Unit Rate" style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          ₦{item.unit_price.toLocaleString()}
                        </td>
                        <td data-label="Total" style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
                          ₦{item.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals, Amount in Words & Remittance Grid */}
              <div
                className="invoice-financial-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.25fr 1fr',
                  gap: '2rem',
                  alignItems: 'flex-start',
                  borderTop: '2px solid var(--border-default)',
                  paddingTop: '1.75rem',
                  marginBottom: '2rem',
                }}
              >
                {/* Left Column: Amount In Words & Bank Remittance Box */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Legal Words Guarantee */}
                  <div className="invoice-words-card">
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em', display: 'block', marginBottom: '0.25rem' }}>
                      Legal Amount In Words (Nigerian Statutory Guarantee):
                    </span>
                    <p style={{ fontStyle: 'italic', fontWeight: 700, color: '#0F172A', fontSize: '0.9rem', margin: 0, lineHeight: '1.4' }}>
                      {numberToWords(activeInvoice.total_amount)}
                    </p>
                  </div>

                  {/* Official Bank Remittance Slip */}
                  <div className="invoice-remittance-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <span style={{ fontWeight: 800, color: 'var(--brand-primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <CreditCard size={15} /> Electronic Remittance Instructions
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CBN Direct NUBAN</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Beneficiary Bank:</span>
                      <strong style={{ color: '#0F172A' }}>{activeInvoice.bank_name}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Account Name:</span>
                      <strong style={{ color: '#0F172A' }}>{activeInvoice.bank_account_name}</strong>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: '#FFFFFF',
                        border: '1.5px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.35rem 0.65rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>NUBAN ACCOUNT:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong className="mono" style={{ fontSize: '1rem', color: 'var(--brand-primary)', letterSpacing: '0.05em' }}>
                          {activeInvoice.bank_account_number}
                        </strong>
                        <button
                          type="button"
                          onClick={() => handleCopyNuban(activeInvoice.bank_account_number)}
                          className="no-print"
                          title="Copy NUBAN"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: accountCopied ? '#059669' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '2px',
                          }}
                        >
                          {accountCopied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', fontStyle: 'italic' }}>
                      * Important: Please include <strong style={{ color: '#0F172A' }}>{activeInvoice.invoice_number}</strong> in the payment narration.
                    </p>
                  </div>
                </div>

                {/* Right Column: Financial Calculation Box */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)', padding: '0 0.25rem' }}>
                    <span>Consignment Subtotal:</span>
                    <strong style={{ color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
                      ₦{activeInvoice.subtotal.toLocaleString()}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)', padding: '0 0.25rem' }}>
                    <span>7.5% Statutory Federal VAT (FIRS):</span>
                    <strong style={{ color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
                      ₦{activeInvoice.tax_amount.toLocaleString()}
                    </strong>
                  </div>

                  {activeInvoice.discount_amount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#059669', padding: '0 0.25rem' }}>
                      <span>Contractor Rebate / Volume Discount:</span>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>
                        -₦{activeInvoice.discount_amount.toLocaleString()}
                      </strong>
                    </div>
                  )}

                  {/* High Impact Total Due Card */}
                  <div className="invoice-total-card">
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', display: 'block' }}>
                        TOTAL AMOUNT PAYABLE
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#E2E8F0' }}>
                        Inclusive of 7.5% VAT
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div
                        className="mono"
                        style={{
                          fontSize: '1.65rem',
                          fontWeight: 900,
                          color: activeInvoice.status === 'paid' ? '#34D399' : '#F8FAFC',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        ₦{activeInvoice.total_amount.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {activeInvoice.paid_reference && (
                    <div
                      style={{
                        backgroundColor: '#ECFDF5',
                        border: '1px solid #A7F3D0',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.75rem',
                        color: '#065F46',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700 }}>
                        <CheckCircle size={14} color="#059669" /> Electronic Settlement Verified
                      </span>
                      <span className="mono" style={{ fontWeight: 700 }}>{activeInvoice.paid_reference}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Security Seals & Authorized Signatory Block */}
              <div
                className="invoice-footer-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  borderTop: '1px solid var(--border-default)',
                  paddingTop: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1.5rem',
                }}
              >
                {/* Tamper-Evident QR Security Code */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div
                    style={{
                      width: '54px',
                      height: '54px',
                      backgroundColor: '#FFFFFF',
                      border: '1.5px solid var(--border-default)',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#0F172A',
                      boxShadow: 'var(--shadow-xs)',
                    }}
                  >
                    <QrCode size={44} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <ShieldCheck size={14} color="#059669" /> Tamper-Evident Security Seal
                    </span>
                    <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', display: 'block', marginTop: '1px' }}>
                      Cryptographically Signed & Tracked on Tektwig DredgeOps Ledger
                    </span>
                    <span className="mono" style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
                      SHA-256: 4e9a8f21...c018b9
                    </span>
                  </div>
                </div>

                {/* Authorized Signatory & Corporate Stamp Placeholder */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2rem' }}>
                  {/* Corporate Stamp Mark */}
                  <div
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '50%',
                      border: '2px dashed var(--brand-primary)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      padding: '4px',
                      opacity: 0.85,
                      color: 'var(--brand-primary)',
                    }}
                  >
                    <span style={{ fontSize: '0.45rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>TEKTWIG</span>
                    <span style={{ fontSize: '0.42rem', fontWeight: 800 }}>SEAL</span>
                    <span style={{ fontSize: '0.4rem', fontWeight: 700 }}>2026</span>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--brand-primary)', marginBottom: '0.2rem' }}>
                      Tektwig Commercial Finance Directorate
                    </div>
                    <div
                      style={{
                        width: '210px',
                        borderTop: '1.5px solid #0F172A',
                        marginTop: '0.75rem',
                        paddingTop: '0.3rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        fontWeight: 600,
                      }}
                    >
                      Authorized Corporate Signatory
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ================================================================= */
          /* CREATE INVOICE BUILDER MODE (BRIGHT, CRISP EXECUTIVE STYLING) */
          /* ================================================================= */
          <div
            className="invoice-builder"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              padding: '2.25rem',
            }}
          >
            {/* Builder Header */}
            <div
              className="invoice-builder-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '1.25rem',
                marginBottom: '1.75rem',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: 'var(--brand-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    display: 'block',
                    marginBottom: '0.2rem',
                  }}
                >
                  Accounts Receivable & Commercial Billing
                </span>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                  Generate Commercial Tax Invoice
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
                style={{ padding: '0.45rem 0.65rem', minHeight: '36px' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGenerateInvoice}>
              {/* Client Presets Selection */}
              <div style={{ marginBottom: '1.75rem' }}>
                <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                  Select Registered Corporate Client / Contractor Preset:
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '0.75rem',
                  }}
                >
                  {COMMERCIAL_CLIENT_PRESETS.map((preset, idx) => {
                    const isSelected = selectedClientIndex === idx;
                    return (
                      <div
                        key={preset.name}
                        onClick={() => handleSelectPreset(idx)}
                        style={{
                          backgroundColor: isSelected ? 'var(--brand-primary-tint)' : '#F8FAFC',
                          border: `1.5px solid ${isSelected ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                          borderRadius: 'var(--radius-md)',
                          padding: '0.75rem 1rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isSelected ? 'var(--shadow-xs)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <strong style={{ fontSize: '0.875rem', color: isSelected ? 'var(--brand-primary-hover)' : '#0F172A' }}>
                            {preset.name}
                          </strong>
                          {isSelected && <Check size={16} color="var(--brand-primary)" />}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          TIN: {preset.tin}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customer Details Form Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.75rem',
                }}
              >
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Client Company Name *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Project / Delivery Site</label>
                  <input
                    type="text"
                    className="form-input"
                    value={projectSite}
                    onChange={(e) => setProjectSite(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Corporate Tax ID (TIN)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={customerTin}
                    onChange={(e) => setCustomerTin(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Payment Terms</label>
                  <select
                    className="form-select"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                  >
                    <option value="Net 7 Days">Net 7 Days</option>
                    <option value="Net 14 Days">Net 14 Days</option>
                    <option value="Net 30 Days">Net 30 Days</option>
                    <option value="Due Upon Receipt">Due Upon Receipt</option>
                  </select>
                </div>
              </div>

              {/* Trip Selection for Invoice */}
              <div style={{ marginBottom: '1.75rem' }}>
                <div className="invoice-builder-trips-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>
                    Select Closed Dredge Trips to Bundle ({selectedTripIds.length} Selected):
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Commercial Rate:</span>
                    <input
                      type="number"
                      value={defaultRatePerM3}
                      onChange={(e) => setDefaultRatePerM3(Number(e.target.value))}
                      className="form-input mono"
                      style={{
                        width: '100px',
                        minHeight: '34px',
                        padding: '0.25rem 0.5rem',
                        fontWeight: 700,
                        color: 'var(--brand-primary)',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>₦/m³</span>
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: '220px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  {closedTrips.length === 0 ? (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                      No closed trips available for billing. Complete weighbridge offloading first or add consignment items below.
                    </div>
                  ) : (
                    closedTrips.map((tr) => {
                      const isChecked = selectedTripIds.includes(tr.id);
                      const qty = tr.offloading_event?.quantity || tr.truck?.capacity || 30;
                      return (
                        <div
                          className="invoice-trip-row"
                          key={tr.id}
                          onClick={() => handleToggleTrip(tr.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            backgroundColor: isChecked ? 'var(--brand-primary-tint)' : '#FFFFFF',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brand-primary)' }}
                            />
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="mono" style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0F172A' }}>
                                  {tr.trip_number}
                                </span>
                                {tr.truck?.registration_number && (
                                  <PlateDisplay plate={tr.truck.registration_number} size="sm" />
                                )}
                              </div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                                Driver: {tr.driver?.full_name || 'Assigned Driver'} • Offload: {tr.offloading_site?.name || 'Depot'}
                              </span>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <strong style={{ color: '#0F172A', fontSize: '0.9rem' }}>{qty} m³</strong>
                            <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--brand-primary)', marginLeft: '0.75rem', fontWeight: 700 }}>
                              ₦{(qty * defaultRatePerM3).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Custom Additional Items */}
              {customItems.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">Additional Commercial Consignment Items:</label>
                  {customItems.map((item, idx) => (
                    <div
                      className="invoice-custom-item-row"
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr auto',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Description"
                        className="form-input"
                        value={item.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, description: val } : it)));
                        }}
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        className="form-input"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it)));
                        }}
                      />
                      <input
                        type="number"
                        placeholder="Rate (₦)"
                        className="form-input mono"
                        value={item.unit_price}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, unit_price: val } : it)));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomItem(idx)}
                        className="btn btn-secondary"
                        style={{ color: '#DC2626', minHeight: '38px', padding: '0.45rem' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: '1.75rem' }}>
                <button
                  type="button"
                  onClick={handleAddCustomItem}
                  className="btn btn-secondary"
                  style={{ minHeight: '36px', fontSize: '0.8125rem' }}
                >
                  <Plus size={15} /> Add Custom Consignment Item
                </button>
              </div>

              {/* Real-time Calculation Summary Bar */}
              <div
                style={{
                  backgroundColor: '#F8FAFC',
                  border: '1.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.75rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block' }}>
                    Consignment Items: {compiledItems.length}
                  </span>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Subtotal: <strong>₦{subtotal.toLocaleString()}</strong> + 7.5% VAT (<strong>₦{taxAmount.toLocaleString()}</strong>)
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.725rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brand-primary)', display: 'block' }}>
                    Calculated Total Due
                  </span>
                  <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 900, color: '#059669' }}>
                    ₦{totalAmount.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="invoice-builder-actions" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={compiledItems.length === 0}
                  className="btn btn-primary"
                  style={{ padding: '0.65rem 1.5rem', fontWeight: 700 }}
                >
                  <FileText size={16} />
                  Generate Commercial Tax Invoice
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
