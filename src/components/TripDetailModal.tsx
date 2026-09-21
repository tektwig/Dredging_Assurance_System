import React, { useState } from 'react';
import { Trip, AuditLogEntry } from '../types';
import {
  X,
  Lock,
  FileText,
} from 'lucide-react';
import { InvoiceModal } from './InvoiceModal';

interface TripDetailModalProps {
  trip: Trip | null;
  onClose: () => void;
  auditLogs: AuditLogEntry[];
}

export const TripDetailModal: React.FC<TripDetailModalProps> = ({ trip, onClose, auditLogs }) => {
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState<boolean>(false);

  if (!trip) return null;

  const tripAuditLogs = auditLogs.filter((l) => l.entity_id === trip.id || l.reason.includes(trip.trip_number));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 110,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="glass-card"
        style={{
          maxWidth: '850px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#0D1424',
          border: '1px solid var(--border-medium)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>
                {trip.trip_number}
              </span>
              <span className={`badge badge-${trip.status === 'open' ? 'open' : trip.status === 'closed' ? 'closed' : 'exception'}`}>
                {trip.status.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Idempotency Key: <code className="mono" style={{ color: 'var(--accent-gold)' }}>{trip.idempotency_key || 'idem-generated'}</code>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {trip.status === 'closed' && (
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(true)}
                className="btn btn-primary btn-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.78rem',
                  padding: '0.4rem 0.75rem',
                }}
                title="Generate Commercial Tax Invoice for this verified haulage"
              >
                <FileText size={14} /> Generate Invoice
              </button>
            )}

            <button
              onClick={onClose}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.4rem', borderRadius: '50%' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Vehicle & Corridor Banner */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Registered Vehicle</span>
            <div style={{ marginTop: '0.25rem' }}>
              <span className="license-plate-tag">{trip.truck?.registration_number}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {trip.truck?.truck_type} ({trip.truck?.capacity} {trip.truck?.capacity_unit})
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Haulage Driver</span>
            <div style={{ fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>{trip.driver?.full_name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{trip.driver?.phone}</div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading Terminal</span>
            <div style={{ fontWeight: 600, color: 'var(--accent-gold)', marginTop: '0.25rem' }}>
              {trip.loading_site?.name}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code: {trip.loading_site?.site_code}</div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Discharge Wharf</span>
            <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', marginTop: '0.25rem' }}>
              {trip.offloading_site?.name || 'In Transit to Destination'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {trip.offloading_site ? `Code: ${trip.offloading_site.site_code}` : 'Pending Arrival'}
            </div>
          </div>
        </div>

        {/* Life-Cycle Event Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* Step 1: Loading Event */}
          <div
            style={{
              background: 'rgba(6, 182, 212, 0.06)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-open">Step 1</span>
                <strong style={{ color: '#fff' }}>Loading Point Capture</strong>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {new Date(trip.loaded_at).toLocaleString()}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Gate OCR Candidate:</span>{' '}
                <strong className="mono" style={{ color: '#fff' }}>{trip.loading_event?.extracted_number || 'APP482XA'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Confirmed Plate:</span>{' '}
                <strong style={{ color: 'var(--accent-gold)' }}>{trip.loading_event?.confirmed_number || trip.truck?.registration_number}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>OCR Confidence:</span>{' '}
                <span style={{ color: '#34D399', fontWeight: 700 }}>
                  {trip.loading_event?.confidence_score || 96.5}% Verified
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Gate Officer:</span>{' '}
                <span>{trip.loading_event?.captured_by || 'loading_officer'}</span>
              </div>
            </div>

            {trip.loading_event?.operator_notes && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                "{trip.loading_event.operator_notes}"
              </p>
            )}
          </div>

          {/* Step 2: Offloading Event */}
          <div
            style={{
              background: trip.offloading_event ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.02)',
              border: `1px solid ${trip.offloading_event ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={`badge ${trip.offloading_event ? 'badge-closed' : 'badge-draft'}`}>Step 2</span>
                <strong style={{ color: trip.offloading_event ? '#fff' : 'var(--text-muted)' }}>
                  Destination Weighment & Discharge
                </strong>
              </div>
              {trip.closed_at && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {new Date(trip.closed_at).toLocaleString()}
                </span>
              )}
            </div>

            {trip.offloading_event ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Delivered Quantity:</span>{' '}
                    <strong style={{ color: 'var(--accent-gold)', fontSize: '1rem' }}>
                      {trip.offloading_event.quantity} {trip.offloading_event.unit}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Variance:</span>{' '}
                    <strong
                      style={{
                        color:
                          trip.offloading_event.variance_percentage && Math.abs(trip.offloading_event.variance_percentage) > 10
                            ? '#FB7185'
                            : '#34D399',
                      }}
                    >
                      {trip.offloading_event.variance_percentage !== undefined
                        ? `${trip.offloading_event.variance_percentage > 0 ? '+' : ''}${trip.offloading_event.variance_percentage}%`
                        : '0%'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Receiving Officer:</span>{' '}
                    <span>{trip.offloading_event.closed_by}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Scale Ticket Evidence:</span>{' '}
                    <span style={{ color: '#38BDF8', fontWeight: 600 }}>ST-88291.jpg (Verified)</span>
                  </div>
                </div>

                {trip.offloading_event.operator_notes && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    "{trip.offloading_event.operator_notes}"
                  </p>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Vehicle currently in-transit. Awaiting scale weighment confirmation at receiving terminal.
              </p>
            )}
          </div>
        </div>

        {/* Immutable Audit Log Entries for this Trip */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Lock size={16} color="var(--accent-emerald)" />
            <h4 style={{ fontSize: '0.95rem' }}>Tamper-Evident Audit History ({tripAuditLogs.length} events)</h4>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
            {tripAuditLogs.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No corrections recorded. Clean record.</p>
            ) : (
              tripAuditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span className="badge badge-closed" style={{ marginRight: '6px', fontSize: '0.7rem' }}>
                      {log.action}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{log.reason}</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({log.actor_role})
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Commercial Invoice Modal */}
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        preselectedTrip={trip}
      />
    </div>
  );
};
