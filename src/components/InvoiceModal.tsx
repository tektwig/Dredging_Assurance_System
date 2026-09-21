import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import { Invoice, InvoiceItem, Trip } from '../types';
import { COMMERCIAL_CLIENT_PRESETS } from '../services/mockData';
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
  const { trips, createInvoice, markInvoiceAsPaid } = useAppStore();

  // If propInvoice is provided, view that invoice; otherwise create mode
  const [activeInvoice, setActiveInvoice] = useState<Invoice | undefined>(propInvoice || undefined);
  const [isCopied, setIsCopied] = useState(false);
  const [showPaymentPrompt, setShowPaymentPrompt] = useState(false);
  const [paymentRefInput, setPaymentRefInput] = useState('');

  // Synchronize when propInvoice or preselectedTrip changes
  React.useEffect(() => {
    setActiveInvoice(propInvoice || undefined);
    if (preselectedTrip && preselectedTrip.status === 'closed') {
      setSelectedTripIds([preselectedTrip.id]);
    }
  }, [propInvoice, preselectedTrip, isOpen]);

  // Builder form state (when creating new invoice)
  const [selectedClientIndex, setSelectedClientIndex] = useState<number>(0);
  const [customerName, setCustomerName] = useState(COMMERCIAL_CLIENT_PRESETS[0].name);
  const [customerEmail, setCustomerEmail] = useState(COMMERCIAL_CLIENT_PRESETS[0].email);
  const [customerPhone, setCustomerPhone] = useState(COMMERCIAL_CLIENT_PRESETS[0].phone);
  const [customerAddress, setCustomerAddress] = useState(COMMERCIAL_CLIENT_PRESETS[0].address);
  const [customerTin, setCustomerTin] = useState(COMMERCIAL_CLIENT_PRESETS[0].tin);
  const [projectSite, setProjectSite] = useState(COMMERCIAL_CLIENT_PRESETS[0].default_project);
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
      { description: 'Site Stockpile Sand Filling', sand_type: 'Lagoon Filling Sand', quantity: 50, unit_price: 15000 },
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
        description: `Delivered Sharp Sand - Waybill ${trip?.trip_number || 'TRIP'} (Truck: ${trip?.truck?.registration_number || 'N/A'})`,
        sand_type: 'Coarse Sharp Sand',
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
      notes: `Sand dredging deliveries verified by weighbridge ticketing. Corporate VAT registration active.`,
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
      `https://dredgeops.com/invoices/${activeInvoice?.invoice_number || 'INV'}`
    );
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleConfirmPayment = () => {
    if (!activeInvoice) return;
    markInvoiceAsPaid(activeInvoice.id, paymentRefInput || `NIBSS-PAY-${Date.now()}`);
    setActiveInvoice((prev) => (prev ? { ...prev, status: 'paid', paid_reference: paymentRefInput || `NIBSS-PAY-${Date.now()}` } : undefined));
    setShowPaymentPrompt(false);
    setPaymentRefInput('');
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(5, 8, 15, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '1.5rem',
        overflowY: 'auto',
      }}
    >
      <div
        className="invoice-modal-content"
        style={{
          width: '100%',
          maxWidth: activeInvoice ? '880px' : '960px',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: 'var(--radius-lg)',
          position: 'relative',
        }}
      >
        {/* VIEW / PRINT INVOICE MODE */}
        {activeInvoice ? (
          <div>
            {/* Top Toolbar (Non-printable) */}
            <div
              className="no-print"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#131B2E',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1.25rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="var(--accent-gold)" />
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                  Commercial Invoice: <span className="mono" style={{ color: 'var(--accent-gold)' }}>{activeInvoice.invoice_number}</span>
                </span>
                <span className={`badge ${activeInvoice.status === 'paid' ? 'badge-closed' : 'badge-open'}`}>
                  {activeInvoice.status.toUpperCase()}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {activeInvoice.status !== 'paid' && (
                  <button
                    type="button"
                    onClick={() => setShowPaymentPrompt(true)}
                    className="btn btn-success btn-sm"
                  >
                    <CheckCircle size={14} />
                    Mark as Paid
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn btn-secondary btn-sm"
                  title="Copy Invoice Link"
                >
                  <Share2 size={14} />
                  {isCopied ? 'Link Copied!' : 'Share'}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="btn btn-primary btn-sm"
                  title="Print or Save as PDF"
                >
                  <Printer size={14} />
                  Print / Save PDF
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#F43F5E' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Payment Prompt Dialog */}
            {showPaymentPrompt && (
              <div
                className="no-print"
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid #10B981',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <strong style={{ color: '#34D399', fontSize: '0.9rem', display: 'block' }}>
                    Record Customer Settlement
                  </strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Enter NIBSS / Bank EFT Reference or Paystack transaction code:
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="e.g. NIBSS-GTB-891024"
                    value={paymentRefInput}
                    onChange={(e) => setPaymentRefInput(e.target.value)}
                    style={{
                      background: '#0B1120',
                      border: '1px solid var(--border-medium)',
                      color: '#fff',
                      padding: '0.35rem 0.65rem',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                    }}
                  />
                  <button type="button" onClick={handleConfirmPayment} className="btn btn-success btn-sm">
                    Confirm Paid
                  </button>
                  <button type="button" onClick={() => setShowPaymentPrompt(false)} className="btn btn-secondary btn-sm">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* OFFICIAL PRINTABLE COMMERCIAL INVOICE DOCUMENT */}
            <div className="invoice-paper">
              {/* Stamp */}
              <div className={`invoice-stamp invoice-stamp-${activeInvoice.status}`}>
                {activeInvoice.status.toUpperCase()}
              </div>

              {/* Corporate Letterhead */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--border-medium)', paddingBottom: '1.75rem', marginBottom: '1.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Building2 size={20} color="#090D16" />
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                        Adams Dredging & Haulage Operations Ltd
                      </h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Maritime Sand Extraction, Reclamation & Revenue Assurance
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0' }}>
                    Ipakodo Industrial Jetty Corridor, Waterfront Zone, Ikorodu, Lagos State, Nigeria
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    <span>RC: <strong style={{ color: '#fff' }}>RC-1849201</strong></span>
                    <span>•</span>
                    <span>FIRS TIN: <strong style={{ color: '#fff' }}>23091823-0001</strong></span>
                    <span>•</span>
                    <span>SCUML: <strong style={{ color: '#fff' }}>RN:SC-291048</strong></span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--accent-gold)', letterSpacing: '0.04em', margin: 0 }}>
                    COMMERCIAL TAX INVOICE
                  </h1>
                  <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                    {activeInvoice.invoice_number}
                  </div>
                </div>
              </div>

              {/* Invoice Meta Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
                {/* Billed To */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Billed To (Contractor / Customer):
                  </span>
                  <h3 style={{ fontSize: '1.15rem', marginTop: '0.25rem', color: '#fff' }}>
                    {activeInvoice.customer_name}
                  </h3>
                  {activeInvoice.project_site_name && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--accent-gold)', fontWeight: 600, marginTop: '0.2rem' }}>
                      Project: {activeInvoice.project_site_name}
                    </div>
                  )}
                  {activeInvoice.customer_address && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem', lineHeight: '1.4' }}>
                      {activeInvoice.customer_address}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {activeInvoice.customer_tin && <span>TIN: <strong>{activeInvoice.customer_tin}</strong></span>}
                    {activeInvoice.customer_phone && <span>Tel: {activeInvoice.customer_phone}</span>}
                  </div>
                </div>

                {/* Dates & Terms */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.35rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Invoice Date:</span>
                    <strong>{activeInvoice.issue_date}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.35rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Due Date:</span>
                    <strong style={{ color: 'var(--accent-gold)' }}>{activeInvoice.due_date}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.35rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Terms:</span>
                    <span>{activeInvoice.payment_terms}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Currency:</span>
                    <strong>Nigerian Naira (NGN / ₦)</strong>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderBottom: '2px solid var(--border-medium)' }}>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>#</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Description & Sand Grade</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Waybill / Truck</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Qty (m³)</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Unit Rate (₦)</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Amount (₦)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeInvoice.items.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{idx + 1}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                          <strong>{item.description}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Specification: {item.sand_type}</div>
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                          {item.trip_number ? (
                            <span className="mono" style={{ color: 'var(--accent-gold)', fontSize: '0.8rem' }}>{item.trip_number}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Batch Consignment</span>
                          )}
                          {item.truck_plate && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Plate: {item.truck_plate}</div>}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}>
                          {item.quantity.toLocaleString()} {item.unit}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', textAlign: 'right' }}>
                          ₦{item.unit_price.toLocaleString()}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 700 }}>
                          ₦{item.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals & Remittance Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', alignItems: 'flex-start', borderTop: '2px solid var(--border-medium)', paddingTop: '1.5rem', marginBottom: '2rem' }}>
                {/* Remittance & Amount In Words */}
                <div>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Amount In Words:
                    </span>
                    <p style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--accent-gold)', fontSize: '0.88rem', marginTop: '0.2rem' }}>
                      {numberToWords(activeInvoice.total_amount)}
                    </p>
                  </div>

                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: 700, color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' }}>
                      <CreditCard size={15} /> Bank Remittance Information:
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Bank:</span>
                      <strong>{activeInvoice.bank_name}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Account Name:</span>
                      <strong>{activeInvoice.bank_account_name}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>NUBAN Account:</span>
                      <strong className="mono" style={{ color: 'var(--accent-gold)', fontSize: '0.95rem' }}>
                        {activeInvoice.bank_account_number}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Subtotal, VAT, Total Due */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    <span>Subtotal:</span>
                    <span>₦{activeInvoice.subtotal.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    <span>7.5% Statutory VAT:</span>
                    <span>₦{activeInvoice.tax_amount.toLocaleString()}</span>
                  </div>
                  {activeInvoice.discount_amount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#34D399' }}>
                      <span>Contractor Rebate / Discount:</span>
                      <span>-₦{activeInvoice.discount_amount.toLocaleString()}</span>
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '2px solid var(--accent-gold)',
                      paddingTop: '0.75rem',
                      marginTop: '0.5rem',
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>TOTAL DUE:</span>
                    <span style={{ fontWeight: 900, fontSize: '1.35rem', color: activeInvoice.status === 'paid' ? '#34D399' : 'var(--accent-gold)' }}>
                      ₦{activeInvoice.total_amount.toLocaleString()}
                    </span>
                  </div>

                  {activeInvoice.paid_reference && (
                    <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#34D399', marginTop: '0.35rem' }} className="mono">
                      Settled via: {activeInvoice.paid_reference}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Verification & Signatory Stamp */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div style={{ width: '48px', height: '48px', background: '#fff', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
                    <QrCode size={40} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Tamper-Evident QR Security Seal
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#38BDF8', fontWeight: 600 }}>
                      Verified by Adams Revenue Assurance Engine
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--accent-gold)', marginBottom: '0.2rem' }}>
                    Adams Commercial Finance Directorate
                  </div>
                  <div style={{ width: '180px', borderTop: '1px solid var(--border-medium)', marginTop: '0.5rem', paddingTop: '0.25rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Authorized Corporate Signature
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* CREATE INVOICE BUILDER MODE */
          <div className="glass-card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Accounts Receivable & Commercial Billing
                </span>
                <h2 style={{ fontSize: '1.35rem', marginTop: '0.2rem' }}>Generate Commercial Tax Invoice</h2>
              </div>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" style={{ color: '#F43F5E' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGenerateInvoice}>
              {/* Client Presets */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label className="input-label">Select Corporate Client / Contractor:</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  {COMMERCIAL_CLIENT_PRESETS.map((preset, idx) => (
                    <div
                      key={preset.name}
                      onClick={() => handleSelectPreset(idx)}
                      style={{
                        background: selectedClientIndex === idx ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                        border: `1px solid ${selectedClientIndex === idx ? 'var(--accent-gold)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '0.65rem 0.85rem',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                      }}
                    >
                      <strong style={{ display: 'block', color: selectedClientIndex === idx ? 'var(--accent-gold)' : '#fff' }}>
                        {preset.name}
                      </strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>TIN: {preset.tin}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Customer Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label className="input-label">Customer Company Name *</label>
                  <input
                    type="text"
                    required
                    className="select-control"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">Project / Delivery Site</label>
                  <input
                    type="text"
                    className="select-control"
                    value={projectSite}
                    onChange={(e) => setProjectSite(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">Customer TIN</label>
                  <input
                    type="text"
                    className="select-control"
                    value={customerTin}
                    onChange={(e) => setCustomerTin(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">Payment Terms</label>
                  <select
                    className="select-control"
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
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="input-label" style={{ margin: 0 }}>
                    Select Closed Trips to Bundle ({selectedTripIds.length} Selected):
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sand Unit Rate:</span>
                    <input
                      type="number"
                      value={defaultRatePerM3}
                      onChange={(e) => setDefaultRatePerM3(Number(e.target.value))}
                      style={{
                        background: '#0B1120',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--accent-gold)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        width: '90px',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                      }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>₦/m³</span>
                  </div>
                </div>

                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: '#040711' }}>
                  {closedTrips.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No closed trips available. Complete trip offloading first or add manual items below.
                    </div>
                  ) : (
                    closedTrips.map((tr) => {
                      const isChecked = selectedTripIds.includes(tr.id);
                      const qty = tr.offloading_event?.quantity || tr.truck?.capacity || 30;
                      return (
                        <div
                          key={tr.id}
                          onClick={() => handleToggleTrip(tr.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.65rem 1rem',
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            background: isChecked ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ cursor: 'pointer' }}
                            />
                            <div>
                              <span className="mono" style={{ fontWeight: 700, fontSize: '0.85rem' }}>{tr.trip_number}</span>
                              <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Truck: {tr.truck?.registration_number} • Dest: {tr.offloading_site?.name}
                              </span>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <strong>{qty} m³</strong>
                            <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', marginLeft: '0.5rem' }}>
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
                  <label className="input-label">Additional Line Items:</label>
                  {customItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="select-control"
                        value={item.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, description: val } : it)));
                        }}
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        className="select-control"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it)));
                        }}
                      />
                      <input
                        type="number"
                        placeholder="Rate"
                        className="select-control"
                        value={item.unit_price}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCustomItems((prev) => prev.map((it, i) => (i === idx ? { ...it, unit_price: val } : it)));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomItem(idx)}
                        className="btn btn-secondary btn-sm"
                        style={{ color: '#F43F5E' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <button
                  type="button"
                  onClick={handleAddCustomItem}
                  className="btn btn-secondary btn-sm"
                >
                  <Plus size={14} /> Add Custom Consignment Item
                </button>
              </div>

              {/* Totals Preview Bar */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Items: {compiledItems.length}</span>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Subtotal: ₦{subtotal.toLocaleString()} + 7.5% VAT (₦{taxAmount.toLocaleString()})
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Calculated Total Due
                  </span>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#34D399' }}>
                    ₦{totalAmount.toLocaleString()}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={compiledItems.length === 0}
                  className="btn btn-primary"
                >
                  <FileText size={16} />
                  Generate Commercial Invoice
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
