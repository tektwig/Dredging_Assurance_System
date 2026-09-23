import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { StatCard } from '../common/StatCard';
import { Invoice } from '../../types';
import { InvoiceModal } from '../InvoiceModal';
import {
  CreditCard,
  Building2,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  Download,
  FileText,
  Plus,
  Printer,
  Clock,
  TrendingUp,
  Search,
  Check,
} from 'lucide-react';

export const FinanceView: React.FC = () => {
  const {
    closedTrips,
    payoutBatches,
    createPayoutBatch,
    approvePayoutBatch,
    complianceDocs,
    invoices,
    markInvoiceAsPaid,
  } = useAppState();

  const [activeSubTab, setActiveSubTab] = useState<'invoices' | 'batches' | 'compliance'>('invoices');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(
    payoutBatches.length > 0 ? payoutBatches[0].id : null
  );

  // Invoicing state
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState<boolean>(false);
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<Invoice | null>(null);
  const [paymentSuccessMsg, setPaymentSuccessMsg] = useState<string | null>(null);

  // Available trips not yet added to a batch
  const unbatchedClosedTrips = closedTrips;

  const totalUnbatchedTonnes = unbatchedClosedTrips.reduce(
    (acc, t) => acc + (t.offloading_event?.quantity || 0),
    0
  );
  const estimatedUnbatchedPayoutNGN = Math.round(totalUnbatchedTonnes * 1850);

  const handleCreateNewBatch = () => {
    const batch = createPayoutBatch(unbatchedClosedTrips.map((t) => t.id));
    setSelectedBatchId(batch.id);
  };

  const handleQuickMarkPaid = (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation();
    const reference = `ZENITH-EFT-${Date.now().toString().slice(-6)}`;
    markInvoiceAsPaid(inv.id, reference);
    setPaymentSuccessMsg(`Invoice ${inv.invoice_number} marked as Paid (Ref: ${reference})`);
    setTimeout(() => setPaymentSuccessMsg(null), 4000);
  };

  const openCreateInvoiceModal = () => {
    setSelectedInvoiceForModal(null);
    setIsInvoiceModalOpen(true);
  };

  const openViewInvoiceModal = (inv: Invoice) => {
    setSelectedInvoiceForModal(inv);
    setIsInvoiceModalOpen(true);
  };

  // Accounts Receivable Calculations
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
    const matchesStatus = invoiceStatusFilter === 'all' || inv.status === invoiceStatusFilter;
    const matchesQuery =
      searchQuery === '' ||
      inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.project_site_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesQuery;
  });

  const getInvoiceStatusBadge = (status: Invoice['status']) => {
    switch (status) {
      case 'paid':
        return (
          <span
            style={{
              backgroundColor: '#D1FAE5',
              color: '#065F46',
              border: '1px solid #6EE7B7',
              fontSize: '0.7rem',
              fontWeight: 800,
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--radius-sm)',
              letterSpacing: '0.04em',
            }}
          >
            PAID & SETTLED
          </span>
        );
      case 'issued':
        return (
          <span
            style={{
              backgroundColor: '#FEF3C7',
              color: '#B45309',
              border: '1px solid #FCD34D',
              fontSize: '0.7rem',
              fontWeight: 800,
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--radius-sm)',
              letterSpacing: '0.04em',
            }}
          >
            ISSUED / DUE
          </span>
        );
      case 'overdue':
        return (
          <span
            style={{
              backgroundColor: '#FEE2E2',
              color: '#991B1B',
              border: '1px solid #FCA5A5',
              fontSize: '0.7rem',
              fontWeight: 800,
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--radius-sm)',
              letterSpacing: '0.04em',
            }}
          >
            OVERDUE
          </span>
        );
      case 'draft':
        return (
          <span
            style={{
              backgroundColor: '#F1F5F9',
              color: '#475569',
              border: '1px solid #CBD5E1',
              fontSize: '0.7rem',
              fontWeight: 800,
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--radius-sm)',
              letterSpacing: '0.04em',
            }}
          >
            DRAFT
          </span>
        );
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const selectedBatch = payoutBatches.find((b) => b.id === selectedBatchId) || payoutBatches[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Payment Success Notification Toast */}
      {paymentSuccessMsg && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            backgroundColor: '#D1FAE5',
            border: '1px solid #6EE7B7',
            borderRadius: 'var(--radius-md)',
            color: '#065F46',
            fontWeight: 600,
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <CheckCircle2 size={18} color="#059669" />
          <span>{paymentSuccessMsg}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Financial Assurance & Revenue Operations
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Commercial invoicing, Accounts Receivable, automated Paystack bulk transfers, and corporate KYC governance.
          </p>
        </div>

        {/* Sub-tab toggle */}
        <div style={{ display: 'flex', backgroundColor: '#F1F5F9', padding: '0.25rem', borderRadius: 'var(--radius-md)' }}>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeSubTab === 'invoices' ? '#FFFFFF' : 'transparent',
              boxShadow: activeSubTab === 'invoices' ? 'var(--shadow-xs)' : 'none',
              color: activeSubTab === 'invoices' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveSubTab('invoices')}
          >
            <FileText size={14} />
            Commercial Invoices ({invoices.length})
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeSubTab === 'batches' ? '#FFFFFF' : 'transparent',
              boxShadow: activeSubTab === 'batches' ? 'var(--shadow-xs)' : 'none',
              color: activeSubTab === 'batches' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveSubTab('batches')}
          >
            <CreditCard size={14} />
            Payout Batches ({payoutBatches.length})
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeSubTab === 'compliance' ? '#FFFFFF' : 'transparent',
              boxShadow: activeSubTab === 'compliance' ? 'var(--shadow-xs)' : 'none',
              color: activeSubTab === 'compliance' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveSubTab('compliance')}
          >
            <Building2 size={14} />
            Paystack KYC Documents
          </button>
        </div>
      </div>

      {/* TAB 1: COMMERCIAL INVOICING & ACCOUNTS RECEIVABLE */}
      {activeSubTab === 'invoices' && (
        <>
          {/* AR Stat Cards */}
          <div className="grid-4">
            <StatCard
              title="BILLED REVENUE (GROSS)"
              value={`₦${totalBilled.toLocaleString()}`}
              subtitle={`${nonCancelledInvoices.length} active commercial invoices`}
              icon={<TrendingUp size={20} />}
              highlightColor="blue"
            />
            <StatCard
              title="OUTSTANDING RECEIVABLES"
              value={`₦${outstandingReceivables.toLocaleString()}`}
              subtitle={`${invoices.filter((i) => i.status === 'issued' || i.status === 'overdue').length} awaiting customer remittance`}
              icon={<Clock size={20} />}
              highlightColor="amber"
            />
            <StatCard
              title="COLLECTIONS SETTLED"
              value={`₦${totalCollected.toLocaleString()}`}
              subtitle={`${invoices.filter((i) => i.status === 'paid').length} payments reconciled`}
              icon={<CheckCircle2 size={20} />}
              highlightColor="emerald"
            />
            <StatCard
              title="ACCRUED 7.5% FIRS VAT"
              value={`₦${totalVatAccrued.toLocaleString()}`}
              subtitle="Statutory tax compliance withholding"
              icon={<ShieldCheck size={20} />}
              highlightColor="blue"
            />
          </div>

          {/* Invoices List Card */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Status Filter Buttons */}
                {[
                  { id: 'all', label: `All (${invoices.length})` },
                  { id: 'issued', label: `Issued / Due (${invoices.filter((i) => i.status === 'issued').length})` },
                  { id: 'paid', label: `Paid (${invoices.filter((i) => i.status === 'paid').length})` },
                  { id: 'overdue', label: `Overdue (${invoices.filter((i) => i.status === 'overdue').length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn"
                    style={{
                      padding: '0.3rem 0.75rem',
                      minHeight: '30px',
                      fontSize: '0.75rem',
                      backgroundColor: invoiceStatusFilter === f.id ? '#0F172A' : '#F1F5F9',
                      color: invoiceStatusFilter === f.id ? '#FFFFFF' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius-full)',
                    }}
                    onClick={() => setInvoiceStatusFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Search Bar */}
                <div style={{ position: 'relative' }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search invoice or client..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '2rem', minHeight: '34px', fontSize: '0.8rem', width: '220px' }}
                  />
                </div>

                {/* Generate New Invoice Button */}
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ minHeight: '36px', padding: '0.4rem 1rem', fontSize: '0.8125rem' }}
                  onClick={openCreateInvoiceModal}
                >
                  <Plus size={15} />
                  + Create Commercial Invoice
                </button>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer & Project Site</th>
                    <th>Issue Date</th>
                    <th>Due Date</th>
                    <th>Subtotal (NGN)</th>
                    <th>7.5% VAT</th>
                    <th>Total Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                        <FileText size={36} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                        <p style={{ fontWeight: 600 }}>No invoices match this filter</p>
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>
                          <button
                            type="button"
                            onClick={() => openViewInvoiceModal(inv)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontWeight: 800,
                              color: 'var(--brand-primary)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                              textAlign: 'left',
                            }}
                          >
                            {inv.invoice_number}
                          </button>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.customer_name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {inv.project_site_name || 'Standard Dredging Supply'}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.8125rem' }}>{inv.issue_date}</td>
                        <td style={{ fontSize: '0.8125rem', color: inv.status === 'overdue' ? '#DC2626' : 'inherit' }}>
                          {inv.due_date}
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem' }}>
                          ₦{inv.subtotal.toLocaleString()}
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                          ₦{inv.tax_amount.toLocaleString()}
                        </td>
                        <td className="mono" style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0F172A' }}>
                          ₦{inv.total_amount.toLocaleString()}
                        </td>
                        <td>{getInvoiceStatusBadge(inv.status)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ minHeight: '30px', padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
                              onClick={() => openViewInvoiceModal(inv)}
                              title="View and Print Official Invoice"
                            >
                              <Printer size={13} /> Print
                            </button>
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  minHeight: '30px',
                                  padding: '0.2rem 0.55rem',
                                  fontSize: '0.72rem',
                                  backgroundColor: '#D1FAE5',
                                  color: '#065F46',
                                  border: '1px solid #6EE7B7',
                                }}
                                onClick={(e) => handleQuickMarkPaid(inv, e)}
                                title="Record Direct Payment Remittance"
                              >
                                <Check size={13} /> Mark Paid
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
        </>
      )}

      {/* Invoice Modal for Creating and Printing */}
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false);
          setSelectedInvoiceForModal(null);
        }}
        invoice={selectedInvoiceForModal}
      />

      {activeSubTab === 'batches' ? (
        <>
          {/* Financial Summary Cards */}
          <div className="grid-3">
            <StatCard
              title="READY FOR DISBURSEMENT"
              value={`₦${estimatedUnbatchedPayoutNGN.toLocaleString()}`}
              subtitle={`${unbatchedClosedTrips.length} verified trips (${totalUnbatchedTonnes.toFixed(1)}T)`}
              icon={<DollarSign size={20} />}
              highlightColor="emerald"
            />
            <StatCard
              title="PAYSTACK RECIPIENTS"
              value="4 / 4 Active"
              subtitle="100% bank accounts verified"
              icon={<CreditCard size={20} />}
              highlightColor="blue"
            />
            <StatCard
              title="COMPLIANCE RATING"
              value="TIER 3 APPROVED"
              subtitle="CAC & TIN Verified by Paystack"
              icon={<ShieldCheck size={20} />}
              highlightColor="emerald"
            />
          </div>

          {/* Payout Batch Generation & List */}
          <div className="field-two-col">
            {/* Left: Available Pools & Generated Batches */}
            <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                  Weekly Payout Runs
                </h3>
                {unbatchedClosedTrips.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minHeight: '36px', padding: '0.4rem 0.875rem', fontSize: '0.8rem' }}
                    onClick={handleCreateNewBatch}
                  >
                    + Generate Payout Batch
                  </button>
                )}
              </div>

              {payoutBatches.length === 0 ? (
                <div
                  style={{
                    padding: '2.5rem 1rem',
                    textAlign: 'center',
                    backgroundColor: '#F8FAFC',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-default)',
                  }}
                >
                  <CreditCard size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No active payout batches</p>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Click "Generate Payout Batch" to aggregate verified trips.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '1rem' }}
                    onClick={handleCreateNewBatch}
                  >
                    Generate Batch (₦{estimatedUnbatchedPayoutNGN.toLocaleString()})
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {payoutBatches.map((batch) => {
                    const isSelected = batch.id === selectedBatch?.id;
                    const isDisbursed = batch.status === 'disbursed';

                    return (
                      <div
                        key={batch.id}
                        onClick={() => setSelectedBatchId(batch.id)}
                        style={{
                          padding: '1rem',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                          backgroundColor: isSelected ? '#F0F9FF' : '#FFFFFF',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {batch.batch_reference}
                          </span>
                          <span
                            className="badge"
                            style={{
                              backgroundColor: isDisbursed ? '#D1FAE5' : '#FEF3C7',
                              color: isDisbursed ? '#065F46' : '#92400E',
                            }}
                          >
                            {isDisbursed ? 'Disbursed' : 'Pending Approval'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {batch.total_trips} trips • {batch.total_tonnes} Tonnes
                          </span>
                          <strong style={{ color: '#059669' }}>
                            ₦{(batch.gross_amount_ngn || batch.gross_amount || 0).toLocaleString()}
                          </strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Batch Line Item Breakdown & Paystack Transfer Authorization */}
            {selectedBatch ? (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
                      PAYOUT BATCH SPECIFICATION
                    </span>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                      {selectedBatch.batch_reference}
                    </h3>
                  </div>

                  {selectedBatch.status !== 'disbursed' ? (
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => approvePayoutBatch(selectedBatch.id)}
                    >
                      <CheckCircle2 size={16} />
                      Authorize Paystack Bulk Transfer
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#059669', fontWeight: 700 }}>
                      <CheckCircle2 size={20} />
                      <span>Transferred via Paystack</span>
                    </div>
                  )}
                </div>

                {/* Batch Transfer Metadata */}
                <div
                  className="info-stat-grid"
                  style={{
                    padding: '0.875rem 1rem',
                    backgroundColor: '#F8FAFC',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.8125rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>GROSS PAYOUT</span>
                    <strong style={{ fontSize: '1.05rem', color: '#059669' }}>
                      ₦{(selectedBatch.gross_amount_ngn || selectedBatch.gross_amount || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>PAYSTACK REFERENCE</span>
                    <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                      {selectedBatch.paystack_transfer_reference || 'Awaiting Authorization'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>AUTHORIZED BY</span>
                    <strong>{selectedBatch.approved_by || 'Two-Party Sign-off Pending'}</strong>
                  </div>
                </div>

                {/* Batch Line Items Table */}
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Recipient Line-Item Breakdown ({(selectedBatch.items || []).length} Payees)
                </h4>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Driver / Contractor</th>
                        <th>Settlement Bank</th>
                        <th>Delivered Tonnage</th>
                        <th>Haulage Fee (NGN)</th>
                        <th>Paystack Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedBatch.items || []).map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.driver_name}</strong>
                          </td>
                          <td style={{ fontSize: '0.8125rem' }}>
                            {item.bank_name} •••• {item.account_last4}
                          </td>
                          <td className="mono">{item.quantity_total_tonnes} T</td>
                          <td className="mono" style={{ fontWeight: 700, color: '#059669' }}>
                            ₦{(item.amount_ngn || item.amount || 0).toLocaleString()}
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                backgroundColor: item.status === 'success' ? '#D1FAE5' : '#FEF3C7',
                                color: item.status === 'success' ? '#065F46' : '#92400E',
                              }}
                            >
                              {item.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p>Select or create a payout batch to inspect transfer line items.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* KYC Compliance Document Checklist Tab */
        <div className="card">
          <div className="card-header">
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                Paystack Corporate Compliance & Verification Documents
              </h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                Required for high-volume automated transfers and Nigerian Central Bank regulatory clearance.
              </p>
            </div>
            <span className="badge badge-closed">
              <ShieldCheck size={12} /> 4 / 5 Verified
            </span>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document Type & Title</th>
                  <th>Registration / Identifer #</th>
                  <th>File Attachment</th>
                  <th>Uploaded Date</th>
                  <th>Verification Reviewer</th>
                  <th>Compliance Status</th>
                </tr>
              </thead>
              <tbody>
                {complianceDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{doc.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Category: {doc.document_type.replace('_', ' ').toUpperCase()}
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {doc.registration_number || 'N/A'}
                    </td>
                    <td>
                      <a
                        href="#"
                        onClick={(e) => e.preventDefault()}
                        style={{
                          color: 'var(--brand-primary)',
                          textDecoration: 'none',
                          fontSize: '0.8125rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <Download size={13} /> {doc.file_name} ({doc.file_size})
                      </a>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {new Date(doc.uploaded_at || Date.now()).toLocaleDateString()}
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>
                      {doc.reviewed_by || 'Pending Review'}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: doc.status === 'verified' ? '#D1FAE5' : '#FEF3C7',
                          color: doc.status === 'verified' ? '#065F46' : '#92400E',
                        }}
                      >
                        {doc.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
