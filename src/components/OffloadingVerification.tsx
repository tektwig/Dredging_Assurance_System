import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import {
  CheckCircle2,
  AlertTriangle,
  Scale,
  FileText,
  Clock,
  Upload,
} from 'lucide-react';

export const OffloadingVerification: React.FC = () => {
  const {
    trips,
    sites,
    currentSiteId,
    completeOffloadingTrip,
    flagTripException,
  } = useAppStore();

  const offloadingSites = sites.filter((s) => s.site_type === 'offloading' || s.site_type === 'hybrid');
  const [selectedOffloadSiteId, setSelectedOffloadSiteId] = useState(
    offloadingSites.find((s) => s.id === currentSiteId)?.id || offloadingSites[0]?.id || ''
  );

  const openTrips = trips.filter((t) => t.status === 'open');
  const [selectedTripId, setSelectedTripId] = useState(openTrips[0]?.id || '');

  // Form states
  const selectedTrip = trips.find((t) => t.id === selectedTripId);
  const [deliveredQuantity, setDeliveredQuantity] = useState<number>(selectedTrip?.truck?.capacity || 28.5);
  const [unit, setUnit] = useState<'m3' | 'tonnes' | 'truckloads'>('m3');
  const [operatorNotes, setOperatorNotes] = useState('');
  const [ticketAttached, setTicketAttached] = useState(false);
  const [closureSuccess, setClosureSuccess] = useState(false);
  const [exceptionFlagged, setExceptionFlagged] = useState(false);

  // Calculate variance against loaded capacity
  const expectedCapacity = selectedTrip?.truck?.capacity || 30;
  const variance = Number((((deliveredQuantity - expectedCapacity) / expectedCapacity) * 100).toFixed(1));
  const isHighVariance = Math.abs(variance) > 10;

  const handleSelectTrip = (tripId: string) => {
    setSelectedTripId(tripId);
    const tr = trips.find((t) => t.id === tripId);
    if (tr?.truck) {
      setDeliveredQuantity(tr.truck.capacity);
      setUnit(tr.truck.capacity_unit);
    }
  };

  const handleVerifyAndClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTripId) return;

    completeOffloadingTrip({
      trip_id: selectedTripId,
      offloading_site_id: selectedOffloadSiteId,
      quantity: Number(deliveredQuantity),
      unit,
      notes: operatorNotes,
    });

    if (isHighVariance) {
      setExceptionFlagged(true);
      setTimeout(() => setExceptionFlagged(false), 4000);
    } else {
      setClosureSuccess(true);
      setTimeout(() => setClosureSuccess(false), 4000);
    }

    setOperatorNotes('');
    setTicketAttached(false);
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '1.5rem auto', padding: '0 1rem' }}>
      {/* Success Notification */}
      {closureSuccess && (
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
            <strong>Trip Successfully Verified & Closed!</strong> Waybill finalized, scale ticket registered, and added to the billing queue.
          </div>
        </div>
      )}

      {exceptionFlagged && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid #F43F5E',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            color: '#FB7185',
          }}
        >
          <AlertTriangle size={24} />
          <div>
            <strong>Variance Alert! Trip Moved to Exception Queue.</strong> Delivered volume deviated by {variance}%, exceeding operational thresholds. Dispatched to Managerial Triage.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Left Column: Active In-Transit Vehicles */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                DISPATCH QUEUE
              </span>
              <h3 style={{ fontSize: '1.15rem' }}>Open In-Transit Movements</h3>
            </div>
            <span className="badge badge-open">{openTrips.length} Awaiting</span>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Select an incoming truck to confirm delivery and sign off on delivered volume.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
            {openTrips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={36} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                <p>No open in-transit trips pending offloading.</p>
                <p style={{ fontSize: '0.75rem' }}>All dispatches have been reconciled or closed.</p>
              </div>
            ) : (
              openTrips.map((tr) => {
                const isSelected = tr.id === selectedTripId;
                return (
                  <div
                    key={tr.id}
                    onClick={() => handleSelectTrip(tr.id)}
                    style={{
                      background: isSelected ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '0.85rem 1rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span className="license-plate-tag">{tr.truck?.registration_number}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} className="mono">
                        {tr.trip_number}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <span>Driver: {tr.driver?.full_name}</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-gold)' }}>
                        Capacity: {tr.truck?.capacity} {tr.truck?.capacity_unit}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <Clock size={12} /> Dispatched from {tr.loading_site?.site_code} ({new Date(tr.loaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Offload Verification Form */}
        <div className="glass-card">
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', fontWeight: 700, textTransform: 'uppercase' }}>
              Step 2: Destination Verification
            </span>
            <h3 style={{ fontSize: '1.25rem', marginTop: '0.2rem' }}>Weighbridge & Discharge Confirmation</h3>
          </div>

          {selectedTrip ? (
            <form onSubmit={handleVerifyAndClose}>
              {/* Target offload site */}
              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Receiving Offload Wharf / Stockpile</label>
                <select
                  className="select-control"
                  value={selectedOffloadSiteId}
                  onChange={(e) => setSelectedOffloadSiteId(e.target.value)}
                >
                  {offloadingSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.site_code} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Trip Summary Card */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.85rem 1rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active Trip ID:</span>
                  <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedTrip.trip_number}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Origin Dredge Terminal:</span>
                  <span style={{ fontSize: '0.85rem' }}>{selectedTrip.loading_site?.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Declared Gate Volume:</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-gold)' }}>
                    {selectedTrip.truck?.capacity} {selectedTrip.truck?.capacity_unit}
                  </span>
                </div>
              </div>

              {/* Delivered Volume Entry */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label className="input-label">
                    <Scale size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                    Verified Delivered Volume / Weight
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    className="input-control"
                    value={deliveredQuantity}
                    onChange={(e) => setDeliveredQuantity(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Unit</label>
                  <select
                    className="select-control"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as any)}
                  >
                    <option value="m3">m³</option>
                    <option value="tonnes">Tonnes</option>
                    <option value="truckloads">Loads</option>
                  </select>
                </div>
              </div>

              {/* Real-time Variance Calculation */}
              <div
                style={{
                  background: isHighVariance ? 'rgba(244, 63, 94, 0.12)' : 'rgba(16, 185, 129, 0.1)',
                  border: `1px solid ${isHighVariance ? 'rgba(244, 63, 94, 0.4)' : 'rgba(16, 185, 129, 0.3)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: isHighVariance ? '#FB7185' : '#34D399', fontWeight: 600 }}>
                    Calculated Variance
                  </span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: isHighVariance ? '#F43F5E' : '#10B981' }}>
                    {variance > 0 ? `+${variance}%` : `${variance}%`}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                  {isHighVariance ? (
                    <span style={{ color: '#FB7185', fontWeight: 600 }}>
                      ⚠️ Exceeds ±10% threshold! Will trigger exception triage.
                    </span>
                  ) : (
                    <span>Within standard operational allowance</span>
                  )}
                </div>
              </div>

              {/* Weighbridge Ticket Upload Simulation */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="input-label">
                  <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                  Weighbridge Scale Ticket / Digital Waybill
                </label>
                <div
                  onClick={() => setTicketAttached(!ticketAttached)}
                  style={{
                    border: `1px dashed ${ticketAttached ? 'var(--accent-emerald)' : 'var(--border-medium)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '0.85rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: ticketAttached ? 'rgba(16, 185, 129, 0.08)' : 'rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <Upload size={20} color={ticketAttached ? 'var(--accent-emerald)' : 'var(--text-muted)'} style={{ margin: '0 auto 0.25rem' }} />
                  <span style={{ fontSize: '0.85rem', color: ticketAttached ? '#34D399' : 'var(--text-secondary)', fontWeight: 600 }}>
                    {ticketAttached ? '✓ Scale Ticket Attached (ST-88291.jpg — SHA-256 Verified)' : 'Click to Attach Scale Ticket / Waybill Evidence'}
                  </span>
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="input-label">Discharge Notes / Tally Remarks</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. Weighbridge scale certified, no dampness anomaly observed"
                  value={operatorNotes}
                  onChange={(e) => setOperatorNotes(e.target.value)}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    flagTripException({
                      trip_id: selectedTrip.id,
                      exception_type: 'damaged_seal',
                      description: 'Manually flagged at destination by offloading officer.',
                    });
                    setExceptionFlagged(true);
                  }}
                >
                  <AlertTriangle size={14} /> Flag Dispute
                </button>
                <button type="submit" className="btn btn-success">
                  <CheckCircle2 size={16} /> Finalize Delivery & Close Waybill
                </button>
              </div>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <p>Select a trip from the dispatch queue on the left to review and close.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
