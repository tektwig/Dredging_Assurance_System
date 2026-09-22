import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { StatCard } from '../common/StatCard';
import {
  CreditCard,
  Building2,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  Download,
} from 'lucide-react';

export const FinanceView: React.FC = () => {
  const {
    closedTrips,
    payoutBatches,
    createPayoutBatch,
    approvePayoutBatch,
    complianceDocs,
  } = useAppState();

  const [activeSubTab, setActiveSubTab] = useState<'batches' | 'compliance'>('batches');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(
    payoutBatches.length > 0 ? payoutBatches[0].id : null
  );

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

  const selectedBatch = payoutBatches.find((b) => b.id === selectedBatchId) || payoutBatches[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Financial Assurance & Paystack Automation
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Verified trip aggregations, automated Paystack bulk transfers, and corporate KYC governance.
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
              backgroundColor: activeSubTab === 'batches' ? '#FFFFFF' : 'transparent',
              boxShadow: activeSubTab === 'batches' ? 'var(--shadow-xs)' : 'none',
              color: activeSubTab === 'batches' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveSubTab('batches')}
          >
            <CreditCard size={14} />
            Payout Batches
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
