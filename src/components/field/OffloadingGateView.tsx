import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { PlateDisplay } from '../common/PlateDisplay';
import { StatusBadge } from '../common/StatusBadge';
import { QuantityUnit, ExceptionType } from '../../types';
import {
  Scale,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Upload,
} from 'lucide-react';

export const OffloadingGateView: React.FC = () => {
  const {
    openTrips,
    closeOffloadingTrip,
    raiseTripException,
    activeSite,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTripId, setSelectedTripId] = useState<string | null>(
    openTrips.length > 0 ? openTrips[0].id : null
  );

  // Offloading Form Inputs
  const [quantity, setQuantity] = useState<number>(30.5);
  const [unit, setUnit] = useState<QuantityUnit>('tonnes');
  const [scaleTicketNumber, setScaleTicketNumber] = useState('WB-LKK-9104');
  const [ticketPhotoUrl, setTicketPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&auto=format&fit=crop&q=80'
  );
  const [notes, setNotes] = useState('Gross: 44.8T, Tare: 14.3T, Net: 30.5T');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);

  // Exception Modal Form inside view
  const [isFlaggingException, setIsFlaggingException] = useState(false);
  const [exceptionType, setExceptionType] = useState<ExceptionType>('quantity_mismatch');
  const [exceptionDesc, setExceptionDesc] = useState('');

  // Filtered trips
  const filteredOpenTrips = openTrips.filter((t) => {
    const reg = t.truck?.registration_number || t.loading_event?.confirmed_plate || '';
    const num = t.trip_number || '';
    const query = searchQuery.toLowerCase();
    return reg.toLowerCase().includes(query) || num.toLowerCase().includes(query);
  });

  const selectedTrip = openTrips.find((t) => t.id === selectedTripId);

  // Capacity & variance math
  const ratedCapacity = selectedTrip?.truck?.capacity_tonnes || 30;
  const estimatedTonnes = selectedTrip?.loading_event?.estimated_tonnes || ratedCapacity;
  const variance = Number((quantity - estimatedTonnes).toFixed(1));
  const variancePercent = Number(((variance / estimatedTonnes) * 100).toFixed(1));
  const isHighVariance = Math.abs(variancePercent) > 12;

  const handleCloseTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTripId) return;

    const result = await closeOffloadingTrip(selectedTripId, {
      quantity,
      unit,
      scaleTicketNumber,
      scaleTicketUrl: ticketPhotoUrl,
      notes,
    });

    if (result.success) {
      setToastMessage({
        text: `Trip ${selectedTrip?.trip_number} successfully verified and closed!`,
        type: result.varianceAlert ? 'warning' : 'success',
      });

      // Select next available open trip if any
      const remaining = openTrips.filter((t) => t.id !== selectedTripId);
      setSelectedTripId(remaining.length > 0 ? remaining[0].id : null);

      setTimeout(() => setToastMessage(null), 4500);
    } else {
      setToastMessage({
        text: result.message || 'The live trip could not be closed.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 4500);
    }
  };

  const handleRaiseException = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTripId) return;

    try {
      await raiseTripException(selectedTripId, {
        type: exceptionType,
        description: exceptionDesc || `Delivered ${quantity}T deviates by ${variancePercent}% from expected ${estimatedTonnes}T.`,
        severity: 'high',
      });
    } catch (error: unknown) {
      setToastMessage({
        text: error instanceof Error ? error.message : 'The exception could not be saved.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }

    setIsFlaggingException(false);
    setToastMessage({
      text: `Exception flagged on Trip ${selectedTrip?.trip_number}. Transferred to Manager Triage.`,
      type: 'warning',
    });

    const remaining = openTrips.filter((t) => t.id !== selectedTripId);
    setSelectedTripId(remaining.length > 0 ? remaining[0].id : null);
    setTimeout(() => setToastMessage(null), 4500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header Banner */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          backgroundColor: '#F8FAFC',
          borderLeft: '4px solid #059669',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              padding: '0.5rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: '#D1FAE5',
              color: '#059669',
            }}
          >
            <Scale size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.9375rem', fontWeight: 700 }}>
              Gate 2 Weighbridge & Offloading Terminal — {activeSite?.name}
            </h4>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Operator: <strong>Signed-in Offloading Officer</strong> • Awaiting Arrival: {openTrips.length} Vehicles
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="badge badge-open">
            <Clock size={12} />
            {openTrips.length} In-Transit Trips
          </span>
        </div>
      </div>

      {toastMessage && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: toastMessage.type === 'success' ? '#D1FAE5' : '#FEF3C7',
            border: `1px solid ${toastMessage.type === 'success' ? '#6EE7B7' : '#FCD34D'}`,
            borderRadius: 'var(--radius-md)',
            color: toastMessage.type === 'success' ? '#065F46' : '#92400E',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 size={20} color="#059669" />
          ) : (
            <AlertTriangle size={20} color="#D97706" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Main Grid: Left = In-Transit Queue, Right = Weighment Verification */}
      <div className="field-two-col">
        {/* Left Column: Open Trips Queue */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
              Inbound Trucks ({filteredOpenTrips.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tap to verify</span>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Search truck plate or waybill..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search
              size={16}
              style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
          </div>

          {/* Trips List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '520px', overflowY: 'auto' }}>
            {filteredOpenTrips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                <p>No active in-transit trips matching query.</p>
              </div>
            ) : (
              filteredOpenTrips.map((trip) => {
                const isSelected = trip.id === selectedTripId;
                const plate = trip.truck?.registration_number || trip.loading_event?.confirmed_plate || 'N/A';
                const elapsedMins = Math.floor(
                  (Date.now() - new Date(trip.loaded_at).getTime()) / (60 * 1000)
                );

                return (
                  <div
                    key={trip.id}
                    onClick={() => {
                      setSelectedTripId(trip.id);
                      const trk = trip.truck;
                      if (trk) {
                        setQuantity(trk.capacity_tonnes || trk.capacity || 30);
                      }
                    }}
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: isSelected ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                      backgroundColor: isSelected ? '#F0F9FF' : '#FFFFFF',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <PlateDisplay plate={plate} size="sm" />
                      <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
                        {trip.trip_number}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      <span>Driver: <strong>{trip.driver?.full_name}</strong></span>
                      <span>Est: <strong>{trip.loading_event?.estimated_tonnes || 30}T</strong></span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      <span>Origin: {trip.loading_site?.name.split(' ')[0]}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#B45309', fontWeight: 600 }}>
                        <Clock size={11} /> {elapsedMins} mins in transit
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Scale Ticket Verification Form */}
        {selectedTrip ? (
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-primary)', textTransform: 'uppercase' }}>
                  Waybill Verification
                </span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                  Trip {selectedTrip.trip_number}
                </h3>
              </div>

              <StatusBadge status="open" />
            </div>

            {/* Trip Context Card */}
            <div
              className="info-stat-grid"
              style={{
                padding: '1rem',
                backgroundColor: '#F8FAFC',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>TRUCK</span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {selectedTrip.truck?.registration_number} ({selectedTrip.truck?.truck_type})
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>DRIVER</span>
                <strong style={{ color: 'var(--text-primary)' }}>{selectedTrip.driver?.full_name}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>ORIGIN DREDGE PIT</span>
                <strong style={{ color: 'var(--text-primary)' }}>{selectedTrip.loading_site?.name}</strong>
              </div>
            </div>

            {!isFlaggingException ? (
              <form onSubmit={handleCloseTrip}>
                {/* Scale Ticket Number & Photo */}
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Weighbridge Scale Ticket #</label>
                    <input
                      type="text"
                      className="form-input mono"
                      value={scaleTicketNumber}
                      onChange={(e) => setScaleTicketNumber(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Physical Scale Ticket Photo</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="form-input"
                        value={ticketPhotoUrl}
                        onChange={(e) => setTicketPhotoUrl(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ minHeight: '44px', padding: '0.5rem' }}
                        title="Upload Ticket Photo"
                      >
                        <Upload size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Delivered Quantity Input & Unit */}
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Verified Delivered Weight</label>
                    <input
                      type="number"
                      step="0.1"
                      className="form-input mono"
                      style={{ fontSize: '1.25rem', fontWeight: 800 }}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Unit of Measurement</label>
                    <select
                      className="form-select"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as QuantityUnit)}
                    >
                      <option value="tonnes">Tonnes (Metric)</option>
                      <option value="m3">Cubic Metres (m³)</option>
                      <option value="truckloads">Full Truckloads</option>
                    </select>
                  </div>
                </div>

                {/* Live Variance Calculation Banner */}
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isHighVariance ? '#FEE2E2' : '#ECFDF5',
                    border: `1px solid ${isHighVariance ? '#FCA5A5' : '#A7F3D0'}`,
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {isHighVariance ? (
                      <AlertTriangle size={18} color="#DC2626" />
                    ) : (
                      <CheckCircle2 size={18} color="#059669" />
                    )}
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: isHighVariance ? '#991B1B' : '#065F46' }}>
                      Payload Variance: {variance > 0 ? `+${variance}` : variance} Tonnes ({variancePercent}%)
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: isHighVariance ? '#991B1B' : '#065F46' }}>
                    Rated: {ratedCapacity}T
                  </span>
                </div>

                {/* Weighment Breakdown Notes */}
                <div className="form-group">
                  <label className="form-label">Scale Ticket Weight Ledger Details</label>
                  <input
                    type="text"
                    className="form-input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Gross, Tare, Net weights..."
                  />
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ flex: '1' }}
                    onClick={() => setIsFlaggingException(true)}
                  >
                    <AlertTriangle size={16} />
                    FLAG DISPUTE / EXCEPTION
                  </button>

                  <button
                    type="submit"
                    className="btn btn-success btn-lg"
                    style={{ flex: '2', display: 'flex', justifyContent: 'center' }}
                  >
                    <CheckCircle2 size={18} />
                    <span>VERIFY & CLOSE TRIP</span>
                  </button>
                </div>
              </form>
            ) : (
              /* Exception Flagging Panel */
              <form
                onSubmit={handleRaiseException}
                style={{
                  padding: '1rem',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#991B1B', marginBottom: '0.75rem' }}>
                  Flag Operational Exception for Trip {selectedTrip.trip_number}
                </h4>

                <div className="form-group">
                  <label className="form-label">Exception Category</label>
                  <select
                    className="form-select"
                    value={exceptionType}
                    onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
                  >
                    <option value="quantity_mismatch">Quantity Mismatch / Severe Payload Deficit</option>
                    <option value="plate_discrepancy">Plate Discrepancy / Vehicle Substitution</option>
                    <option value="unlisted_truck">Unregistered Subcontracted Vehicle</option>
                    <option value="gate_timeout">Abnormal Transit Delay / Route Deviation</option>
                    <option value="damaged_cargo">Contaminated / Substandard Sand Quality</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Discrepancy Justification & Details</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={exceptionDesc}
                    onChange={(e) => setExceptionDesc(e.target.value)}
                    placeholder="Provide specific weighment details, scale ticket discrepancy, or explanation..."
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setIsFlaggingException(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-danger" style={{ flex: 2 }}>
                    SUBMIT TO MANAGER TRIAGE
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div
            className="card"
            style={{
              padding: '3rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <Scale size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              No Active Trip Selected
            </h4>
            <p style={{ maxWidth: '320px', marginTop: '0.5rem' }}>
              Select an inbound vehicle from the queue to verify the weighbridge scale ticket and complete closure.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
