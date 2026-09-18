import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import {
  CheckCircle2,
  FileSearch,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react';

export const ExceptionPortal: React.FC = () => {
  const { exceptions, trips, resolveException } = useAppStore();

  const [selectedExcId, setSelectedExcId] = useState<string>(exceptions[0]?.id || '');
  const [resolutionAction, setResolutionAction] = useState<'resolve_discrepancy' | 'cancel_trip'>('resolve_discrepancy');
  const [correctedVolume, setCorrectedVolume] = useState<number>(29.0);
  const [reasonCode, setReasonCode] = useState<string>('');
  const [resolutionSuccess, setResolutionSuccess] = useState<boolean>(false);

  const selectedExc = exceptions.find((e) => e.id === selectedExcId);
  const relatedTrip = trips.find((t) => t.id === selectedExc?.trip_id);

  const handleResolve = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExc || !reasonCode.trim()) return;

    resolveException({
      exception_id: selectedExc.id,
      trip_id: selectedExc.trip_id,
      action: resolutionAction,
      correctedQuantity: resolutionAction === 'resolve_discrepancy' ? correctedVolume : undefined,
      reason: reasonCode,
    });

    setResolutionSuccess(true);
    setReasonCode('');
    setTimeout(() => {
      setResolutionSuccess(false);
    }, 4000);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '1.5rem auto', padding: '0 1rem' }}>
      {resolutionSuccess && (
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
            <strong>Dispute Formally Resolved & Audited!</strong> Resolution details and justification have been permanently committed to the immutable audit ledger.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        {/* Left Column: Exception Queue */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-rose)', fontWeight: 700 }}>
                FRAUD & DISCREPANCY MITIGATION
              </span>
              <h3 style={{ fontSize: '1.25rem' }}>Active Exception Queue</h3>
            </div>
            <span className="badge badge-exception">
              {exceptions.filter((e) => e.status === 'pending').length} Pending
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {exceptions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={36} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                <p>No active anomalies or disputes flagged.</p>
              </div>
            ) : (
              exceptions.map((exc) => {
                const isSelected = exc.id === selectedExcId;
                return (
                  <div
                    key={exc.id}
                    onClick={() => {
                      setSelectedExcId(exc.id);
                      if (relatedTrip?.truck) setCorrectedVolume(relatedTrip.truck.capacity);
                    }}
                    style={{
                      background: isSelected ? 'rgba(244, 63, 94, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${isSelected ? 'var(--accent-rose)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '0.85rem 1rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span className="badge badge-exception">{exc.exception_type.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {exc.status.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                      {exc.truck_plate ? <span className="license-plate-tag" style={{ marginRight: '6px' }}>{exc.truck_plate}</span> : null}
                      <span className="mono">{exc.trip_number}</span>
                    </div>

                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {exc.description}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Dispute Review & Resolution Sign-Off */}
        <div className="glass-card">
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)', fontWeight: 700, textTransform: 'uppercase' }}>
              Managerial Triage
            </span>
            <h3 style={{ fontSize: '1.25rem', marginTop: '0.2rem' }}>Audit Review & Formal Correction</h3>
          </div>

          {selectedExc && relatedTrip ? (
            <form onSubmit={handleResolve}>
              {/* Evidence Inspector */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', color: 'var(--accent-gold)' }}>
                  <FileSearch size={18} />
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Field Evidence Cross-Check</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Gate OCR Extraction</span>
                    <strong style={{ color: '#fff' }}>{relatedTrip.loading_event?.confirmed_number || 'N/A'}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)' }}>
                      Confidence: {relatedTrip.loading_event?.confidence_score}%
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Registered Capacity</span>
                    <strong style={{ color: '#fff' }}>{relatedTrip.truck?.capacity} {relatedTrip.truck?.capacity_unit}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Reported Discrepancy Note</span>
                  <p style={{ color: '#FB7185', fontSize: '0.85rem' }}>{selectedExc.description}</p>
                </div>
              </div>

              {/* Action Selection */}
              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Select Resolution Action</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setResolutionAction('resolve_discrepancy')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${resolutionAction === 'resolve_discrepancy' ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                      background: resolutionAction === 'resolve_discrepancy' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: resolutionAction === 'resolve_discrepancy' ? '#34D399' : 'var(--text-secondary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Adjust & Finalize
                  </button>

                  <button
                    type="button"
                    onClick={() => setResolutionAction('cancel_trip')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${resolutionAction === 'cancel_trip' ? 'var(--accent-rose)' : 'var(--border-subtle)'}`,
                      background: resolutionAction === 'cancel_trip' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: resolutionAction === 'cancel_trip' ? '#FB7185' : 'var(--text-secondary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    Void / Cancel Trip
                  </button>
                </div>
              </div>

              {/* Corrected quantity if adjusting */}
              {resolutionAction === 'resolve_discrepancy' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label className="input-label">Authorized Corrected Quantity (m³)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input-control"
                    value={correctedVolume}
                    onChange={(e) => setCorrectedVolume(Number(e.target.value))}
                    required
                  />
                </div>
              )}

              {/* Mandatory Reason Code */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="input-label">
                  <MessageSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                  Mandatory Audit Justification / Reason Code *
                </label>
                <textarea
                  className="input-control"
                  rows={3}
                  placeholder="e.g. Weighbridge calibration certificate reviewed; scale zero-offset adjusted by technician. Verified offload quantity authorized at 29.0 m³."
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  This reason will be permanently embedded in the immutable audit log.
                </span>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={!reasonCode.trim()}
              >
                <ShieldAlert size={16} /> Sign & Apply Resolution to Ledger
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <p>Select an exception from the queue to conduct managerial triage.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
