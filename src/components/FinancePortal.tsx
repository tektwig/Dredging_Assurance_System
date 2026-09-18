import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import {
  Building2,
  CheckCircle2,
  FileCheck,
  Send,
} from 'lucide-react';

export const FinancePortal: React.FC = () => {
  const { payoutBatches, complianceDocs, approvePayoutBatch } = useAppStore();
  const [selectedBatchId, setSelectedBatchId] = useState<string>(payoutBatches[0]?.id || '');
  const [payoutSuccess, setPayoutSuccess] = useState<boolean>(false);

  const selectedBatch = payoutBatches.find((b) => b.id === selectedBatchId);

  const handleApproveBatch = () => {
    if (!selectedBatch) return;
    approvePayoutBatch(selectedBatch.id);
    setPayoutSuccess(true);
    setTimeout(() => setPayoutSuccess(false), 4500);
  };

  return (
    <div style={{ maxWidth: '1300px', margin: '1.5rem auto', padding: '0 1.25rem' }}>
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
  );
};
