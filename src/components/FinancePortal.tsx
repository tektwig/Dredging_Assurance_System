import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import { Invoice } from '../types';
import { InvoiceModal } from './InvoiceModal';
import {
  Building2,
  CheckCircle2,
  FileCheck,
  Send,
  FileText,
  Plus,
  Printer,
  Clock,
  CheckCircle,
  TrendingUp,
} from 'lucide-react';

export const FinancePortal: React.FC = () => {
  const { payoutBatches, complianceDocs, approvePayoutBatch, invoices, markInvoiceAsPaid } = useAppStore();
  const [activeTab, setActiveTab] = useState<'invoices' | 'payouts'>('invoices');
  const [selectedBatchId, setSelectedBatchId] = useState<string>(payoutBatches[0]?.id || '');
  const [payoutSuccess, setPayoutSuccess] = useState<boolean>(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('all');
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState<boolean>(false);
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<Invoice | null>(null);
  const [paymentSuccessMsg, setPaymentSuccessMsg] = useState<string | null>(null);

  const selectedBatch = payoutBatches.find((b) => b.id === selectedBatchId);

  const handleApproveBatch = () => {
    if (!selectedBatch) return;
    approvePayoutBatch(selectedBatch.id);
    setPayoutSuccess(true);
    setTimeout(() => setPayoutSuccess(false), 4500);
  };

  const handleQuickMarkPaid = (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation();
    const reference = `MANUAL-SETTLED-${Date.now().toString().slice(-6)}`;
    markInvoiceAsPaid(inv.id, reference);
    setPaymentSuccessMsg(`Invoice ${inv.invoice_number} marked as Paid (Ref: ${reference})`);
    setTimeout(() => setPaymentSuccessMsg(null), 4000);
  };

  // Invoice calculations
  const nonCancelledInvoices = invoices.filter((i) => i.status !== 'cancelled');
  const totalBilled = nonCancelledInvoices.reduce((sum, i) => sum + i.total_amount, 0);
  const outstandingReceivables = invoices
    .filter((i) => i.status === 'issued' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.total_amount, 0);
  const totalCollected = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.total_amount, 0);
  const totalVatAccrued = nonCancelledInvoices.reduce((sum, i) => sum + i.tax_amount, 0);

  const filteredInvoices = invoices.filter((inv) => {
    if (invoiceStatusFilter === 'all') return true;
    return inv.status === invoiceStatusFilter;
  });

  const getInvoiceStatusBadge = (status: Invoice['status']) => {
    switch (status) {
      case 'paid':
        return <span className="badge badge-closed">PAID & SETTLED</span>;
      case 'issued':
        return <span className="badge badge-open">ISSUED / DUE</span>;
      case 'overdue':
        return <span className="badge badge-exception">OVERDUE</span>;
      case 'draft':
        return <span className="badge badge-draft">DRAFT</span>;
      case 'cancelled':
        return <span className="badge badge-draft">VOIDED</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  return (
    <div style={{ maxWidth: '1350px', margin: '1.5rem auto', padding: '0 1.25rem' }}>
      {payoutSuccess && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10B981',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            color: '#34D399',
          }}
        >
          <CheckCircle2 size={24} />
          <div>
            <strong>Paystack Bulk Transfer Dispatched!</strong> Transfer reference <code>{selectedBatch?.paystack_transfer_reference}</code> generated. NIBSS instant settlement queue active.
          </div>
        </div>
      )}

      {paymentSuccessMsg && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10B981',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            color: '#34D399',
          }}
        >
          <CheckCircle size={22} />
          <div>
            <strong>Payment Reconciled:</strong> {paymentSuccessMsg}
          </div>
        </div>
      )}

      {/* Primary Top Tab Switcher */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.75rem',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('invoices')}
          style={{
            padding: '0.65rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: '0.92rem',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: activeTab === 'invoices' ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.05)',
            color: activeTab === 'invoices' ? '#000' : 'var(--text-secondary)',
            boxShadow: activeTab === 'invoices' ? '0 4px 15px rgba(245, 158, 11, 0.25)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <FileText size={18} />
          <span>Customer Invoices & Receivables</span>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '0.15rem 0.45rem',
              borderRadius: '999px',
              background: activeTab === 'invoices' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: activeTab === 'invoices' ? '#000' : 'var(--text-muted)',
            }}
          >
            {invoices.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payouts')}
          style={{
            padding: '0.65rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: '0.92rem',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: activeTab === 'payouts' ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.05)',
            color: activeTab === 'payouts' ? '#000' : 'var(--text-secondary)',
            boxShadow: activeTab === 'payouts' ? '0 4px 15px rgba(6, 182, 212, 0.25)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <Send size={18} />
          <span>Weekly Haulage Payout Batches</span>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '0.15rem 0.45rem',
              borderRadius: '999px',
              background: activeTab === 'payouts' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: activeTab === 'payouts' ? '#000' : 'var(--text-muted)',
            }}
          >
            {payoutBatches.length}
          </span>
        </button>
      </div>

      {activeTab === 'invoices' ? (
        <div>
          {/* Invoice Summary Metric Cards */}
          <div className="grid-responsive-cards" style={{ marginBottom: '1.75rem' }}>
            {/* KPI 1: Total Billed */}
            <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-gold)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Total Invoiced Revenue
                  </span>
                  <h2 style={{ fontSize: '1.85rem', marginTop: '0.2rem', color: 'var(--accent-gold)' }}>
                    ₦{totalBilled.toLocaleString()}
                  </h2>
                </div>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(245, 158, 11, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp size={22} color="var(--accent-gold)" />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Commercial billing across all dredging consignments
              </div>
            </div>

            {/* KPI 2: Outstanding Receivables */}
            <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Outstanding Receivables
                  </span>
                  <h2 style={{ fontSize: '1.85rem', marginTop: '0.2rem', color: outstandingReceivables > 0 ? '#FB7185' : '#fff' }}>
                    ₦{outstandingReceivables.toLocaleString()}
                  </h2>
                </div>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(244, 63, 94, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Clock size={22} color="var(--accent-rose)" />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {invoices.filter((i) => i.status === 'issued' || i.status === 'overdue').length} invoices pending customer settlement
              </div>
            </div>

            {/* KPI 3: Collected Remittances */}
            <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-emerald)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Collected Remittances
                  </span>
                  <h2 style={{ fontSize: '1.85rem', marginTop: '0.2rem', color: '#34D399' }}>
                    ₦{totalCollected.toLocaleString()}
                  </h2>
                </div>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckCircle2 size={22} color="#34D399" />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Verified settlements deposited into GTBank designated account
              </div>
            </div>

            {/* KPI 4: Accrued VAT */}
            <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-cyan)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                    FIRS Output VAT (7.5%)
                  </span>
                  <h2 style={{ fontSize: '1.85rem', marginTop: '0.2rem', color: 'var(--accent-cyan)' }}>
                    ₦{totalVatAccrued.toLocaleString()}
                  </h2>
                </div>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'rgba(6, 182, 212, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileCheck size={22} color="var(--accent-cyan)" />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Tax Identification Number: <code>23091823-0001</code>
              </div>
            </div>
          </div>

          {/* Invoices Ledger Table */}
          <div className="glass-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.25rem',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '1rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.25rem' }}>Commercial Tax Invoices & Receivables</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Statutory invoices generated for corporate contractors, infrastructure developers, and multi-trip hauls.
                </p>
              </div>

              {/* Filters & Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Status Filter Tabs */}
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {[
                    { id: 'all', label: `All (${invoices.length})` },
                    { id: 'issued', label: `Due (${invoices.filter((i) => i.status === 'issued').length})` },
                    { id: 'paid', label: `Paid (${invoices.filter((i) => i.status === 'paid').length})` },
                    { id: 'overdue', label: `Overdue (${invoices.filter((i) => i.status === 'overdue').length})` },
                    { id: 'draft', label: `Drafts (${invoices.filter((i) => i.status === 'draft').length})` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setInvoiceStatusFilter(f.id)}
                      style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: invoiceStatusFilter === f.id ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.05)',
                        color: invoiceStatusFilter === f.id ? '#000' : 'var(--text-secondary)',
                        border: 'none',
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Create Invoice Button */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedInvoiceForModal(null);
                    setIsInvoiceModalOpen(true);
                  }}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                >
                  <Plus size={15} /> Create Commercial Invoice
                </button>
              </div>
            </div>

            {/* Invoices Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Issue Date</th>
                    <th>Client Organization</th>
                    <th>Consignment / Trips</th>
                    <th>Subtotal (₦)</th>
                    <th>Total (incl. 7.5% VAT)</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                        No commercial invoices matching filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr
                        key={inv.id}
                        onClick={() => {
                          setSelectedInvoiceForModal(inv);
                          setIsInvoiceModalOpen(true);
                        }}
                        style={{ cursor: 'pointer' }}
                        title="Click to view full printable official invoice"
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <FileText size={16} color="var(--accent-gold)" />
                            <span className="mono" style={{ fontWeight: 700, color: '#fff' }}>
                              {inv.invoice_number}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            Due: {inv.due_date}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.85rem' }}>{inv.issue_date}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {inv.payment_terms}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#fff' }}>{inv.customer_name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {inv.project_site_name || (inv.customer_address ? inv.customer_address.slice(0, 30) : 'Lagos Corridor')}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {inv.items.reduce((s, it) => s + it.quantity, 0)} m³ Total
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {inv.items.filter((it) => it.trip_id).length > 0
                              ? `${inv.items.filter((it) => it.trip_id).length} Verified Waybills`
                              : `${inv.items.length} Line Items`}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.85rem' }}>₦{inv.subtotal.toLocaleString()}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>
                            + ₦{inv.tax_amount.toLocaleString()} VAT
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent-gold)' }}>
                            ₦{inv.total_amount.toLocaleString()}
                          </div>
                        </td>
                        <td>{getInvoiceStatusBadge(inv.status)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedInvoiceForModal(inv);
                                setIsInvoiceModalOpen(true);
                              }}
                              className="btn btn-secondary btn-sm"
                              title="View and Print Invoice"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            >
                              <Printer size={13} /> View / Print
                            </button>

                            {(inv.status === 'issued' || inv.status === 'overdue') && (
                              <button
                                type="button"
                                onClick={(e) => handleQuickMarkPaid(inv, e)}
                                className="btn btn-sm"
                                title="Mark as Paid"
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  color: '#34D399',
                                  border: '1px solid rgba(16, 185, 129, 0.4)',
                                }}
                              >
                                <CheckCircle size={13} /> Settle
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Payouts Section */
        <div>
          {/* Top Banner: Paystack Compliance Status */}
          <div
            className="glass-card"
            style={{
              marginBottom: '1.75rem',
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
              borderLeft: '4px solid #00C3F7',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#00C3F7', fontWeight: 700 }}>
                    PAYSTACK NIGERIA COMPLIANCE INTEGRATION
                  </span>
                  <span className="badge badge-closed">Active Mandate</span>
                </div>
                <h3 style={{ fontSize: '1.25rem' }}>Corporate KYC & Automated Disbursement Engine</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Compliant with Central Bank of Nigeria (CBN) regulations and Paystack Transfers API.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', textAlign: 'right' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Corporate CAC Status</span>
                  <div style={{ fontWeight: 700, color: '#34D399' }}>RC-1849201 (Active)</div>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>FIRS Corporate TIN</span>
                  <div style={{ fontWeight: 700, color: '#34D399' }}>23091823-0001</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
            {/* Left Column: Payout Batches & Approval */}
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', fontWeight: 700 }}>
                    FINANCIAL DISBURSEMENTS
                  </span>
                  <h3 style={{ fontSize: '1.25rem' }}>Weekly Haulage Payout Batches</h3>
                </div>
                <span className="badge badge-closed">
                  {payoutBatches.length} Batches
                </span>
              </div>

              {/* Batch Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {payoutBatches.map((batch) => {
                  const isSelected = batch.id === selectedBatchId;
                  return (
                    <div
                      key={batch.id}
                      onClick={() => setSelectedBatchId(batch.id)}
                      style={{
                        background: isSelected ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                        border: `1px solid ${isSelected ? 'var(--accent-gold)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '0.85rem 1rem',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span className="mono" style={{ fontWeight: 700, color: '#fff' }}>{batch.batch_number}</span>
                        <span className={`badge ${batch.status === 'approved' ? 'badge-open' : 'badge-closed'}`}>
                          {batch.status.toUpperCase()}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{batch.total_trips} Verified Trips</span>
                        <span style={{ fontWeight: 800, color: 'var(--accent-gold)' }}>
                          ₦{batch.gross_amount.toLocaleString()}
                        </span>
                      </div>

                      {batch.paystack_transfer_reference && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }} className="mono">
                          Ref: {batch.paystack_transfer_reference}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Batch Items Detail Table */}
              {selectedBatch && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.95rem' }}>Driver Payout Line Items</h4>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {selectedBatch.items?.length || 0} Recipients
                    </span>
                  </div>

                  <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
                    <table className="custom-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>Driver</th>
                          <th>Trips</th>
                          <th>Volume</th>
                          <th>Gross Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBatch.items?.map((item) => (
                          <tr key={item.id}>
                            <td style={{ fontWeight: 600 }}>{item.driver_name}</td>
                            <td>{item.trip_count}</td>
                            <td>{item.quantity_total} m³</td>
                            <td style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                              ₦{item.amount.toLocaleString()}
                            </td>
                            <td>
                              <span className={`badge ${item.status === 'success' ? 'badge-closed' : 'badge-open'}`}>
                                {item.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Approval Button */}
                  {selectedBatch.status !== 'completed' && selectedBatch.status !== 'processing' ? (
                    <button
                      type="button"
                      onClick={handleApproveBatch}
                      className="btn btn-primary"
                      style={{ width: '100%' }}
                    >
                      <Send size={16} /> Authorize & Send Paystack Bulk Transfer (₦{selectedBatch.gross_amount.toLocaleString()})
                    </button>
                  ) : (
                    <div
                      style={{
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.75rem',
                        textAlign: 'center',
                        color: '#34D399',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      ✓ Batch Dispatched & Reconciled via Paystack
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Business Compliance Documents (KYC/CAC) */}
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                    REGULATORY DUE DILIGENCE
                  </span>
                  <h3 style={{ fontSize: '1.25rem' }}>Business Compliance Dossier</h3>
                </div>
                <FileCheck size={20} color="var(--accent-cyan)" />
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Official corporate entity verification documents required for merchant underwriting and higher disbursement limits.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {complianceDocs.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{doc.title}</span>
                      <span className="badge badge-closed">VERIFIED</span>
                    </div>

                    {doc.registration_number && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }} className="mono">
                        ID: {doc.registration_number}
                      </div>
                    )}

                    {doc.notes && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {doc.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Settlement Account Box */}
              <div
                style={{
                  marginTop: '1.5rem',
                  background: 'rgba(6, 182, 212, 0.08)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <Building2 size={18} color="var(--accent-cyan)" />
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff' }}>
                    Designated Corporate Settlement Account
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Bank: <strong>Guaranty Trust Bank (GTBank) Nigeria</strong>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Account Name: <strong>Adams Haulage Operations Ltd</strong>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-gold)' }} className="mono">
                  Account No: <strong>0123456789</strong> (NUBAN Verified)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Official Commercial Invoice Modal */}
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false);
          setSelectedInvoiceForModal(null);
        }}
        invoice={selectedInvoiceForModal}
      />
    </div>
  );
};
