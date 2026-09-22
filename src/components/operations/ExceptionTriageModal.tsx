import React, { useState } from 'react';
import { TripException, Trip } from '../../types';
import { PlateDisplay } from '../common/PlateDisplay';
import { CheckCircle2, X, ShieldAlert } from 'lucide-react';

interface ExceptionTriageModalProps {
  trip: Trip;
  exception: TripException;
  onClose: () => void;
  onResolve: (tripId: string, params: { resolutionNotes: string; reasonCode: string; adjustedQuantity?: number }) => void;
}

export const ExceptionTriageModal: React.FC<ExceptionTriageModalProps> = ({
  trip,
  exception,
  onClose,
  onResolve,
}) => {
  const [reasonCode, setReasonCode] = useState('SCALE_CALIBRATION_ADJUSTMENT');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [adjustedQuantity, setAdjustedQuantity] = useState<number>(
    trip.loading_event?.estimated_tonnes || 30
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onResolve(trip.id, {
      resolutionNotes,
      reasonCode,
      adjustedQuantity,
    });
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="card-header" style={{ backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: '#FEE2E2',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#991B1B' }}>
                Operations Manager Exception Triage
              </h3>
              <p style={{ fontSize: '0.75rem', color: '#B91C1C' }}>
                Trip {trip.trip_number} • Mandatory Audit Trail Reason Code Required
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#991B1B',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-body">
          {/* Discrepancy Evidence Box */}
          <div
            style={{
              padding: '1rem',
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <PlateDisplay plate={trip.truck?.registration_number || 'N/A'} size="sm" />
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700 }}>
                Category: {exception.exception_type.replace('_', ' ').toUpperCase()}
              </span>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginTop: '0.5rem' }}>
              <strong>Reported Anomaly:</strong> {exception.description}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              <span>Flagged by: {exception.flagged_by}</span>
              <span>Time: {new Date(exception.flagged_at).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Mandatory Reason Code (Immutable Audit Ledger)</label>
              <select
                className="form-select"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                required
              >
                <option value="SCALE_CALIBRATION_ADJUSTMENT">
                  Scale Calibration Variance / Re-tared Scale Confirmed
                </option>
                <option value="MOISTURE_DEDUCTION_APPROVED">
                  Approved Moisture Water Deduction (High Water Sand)
                </option>
                <option value="APPROVED_PARTIAL_OFFLOAD">
                  Authorized Multi-drop Offloading at Intermediate Site
                </option>
                <option value="SUBSTITUTED_AUTHORIZED_VEHICLE">
                  Authorized Prime Mover / Trailer Swap in Transit
                </option>
                <option value="OPERATIONAL_COMPENSATION_VOID">
                  Void & Compensate with Contractor Credit Note
                </option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Authorized Net Quantity for Settlement (Tonnes)</label>
              <input
                type="number"
                step="0.1"
                className="form-input mono"
                style={{ fontSize: '1.15rem', fontWeight: 700 }}
                value={adjustedQuantity}
                onChange={(e) => setAdjustedQuantity(Number(e.target.value))}
                required
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                This figure becomes the authoritative basis for contractor payment and client billing.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Manager Resolution Rationale & Instructions</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Document verification check, weighbridge supervisor confirmation, or driver statement..."
                required
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-success btn-lg" style={{ flex: 2 }}>
                <CheckCircle2 size={18} />
                APPROVE FORMAL RESOLUTION & CLOSE
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
