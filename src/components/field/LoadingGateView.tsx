import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { PlateDisplay } from '../common/PlateDisplay';
import { StatusBadge } from '../common/StatusBadge';
import {
  Camera,
  CheckCircle2,
  Truck as TruckIcon,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  MapPin,
  Clock,
} from 'lucide-react';

export const LoadingGateView: React.FC = () => {
  const {
    activeSite,
    sites,
    trucks,
    drivers,
    trips,
    createLoadingTrip,
    activeSiteId,
  } = useAppState();

  // Field Form State
  const [candidatePlate, setCandidatePlate] = useState('KJA-482XY');
  const [confirmedPlate, setConfirmedPlate] = useState('KJA-482XY');
  const [confidenceScore, setConfidenceScore] = useState(96.8);
  const [selectedTruckId, setSelectedTruckId] = useState('trk-1');
  const [selectedDriverId, setSelectedDriverId] = useState('drv-1');
  const [destinationSiteId, setDestinationSiteId] = useState('site-lkk-01');
  const [estimatedTonnes, setEstimatedTonnes] = useState(30);
  const [photoUrl, setPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80'
  );
  const [isScanning, setIsScanning] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Available offloading destinations
  const offloadingSites = sites.filter((s) => s.site_type === 'offloading');

  // Selected truck & driver info
  const currentTruck = trucks.find((t) => t.id === selectedTruckId);
  const currentDriver = drivers.find((d) => d.id === selectedDriverId);

  // Handler when plate candidate changes or test button is clicked
  const handleSelectPresetPlate = (plate: string, truckId: string, driverId: string, img: string) => {
    setIsScanning(true);
    setTimeout(() => {
      setCandidatePlate(plate);
      setConfirmedPlate(plate);
      setSelectedTruckId(truckId);
      setSelectedDriverId(driverId);
      setPhotoUrl(img);
      setConfidenceScore(Number((94 + Math.random() * 5).toFixed(1)));
      const trk = trucks.find((t) => t.id === truckId);
      if (trk) setEstimatedTonnes(trk.capacity_tonnes || trk.capacity || 30);
      setIsScanning(false);
    }, 450);
  };

  const handleManualPlateEdit = (newPlate: string) => {
    setConfirmedPlate(newPlate);
    // Try auto-match by normalized plate
    const normalized = newPlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const matchedTruck = trucks.find((t) => t.normalized_registration === normalized);
    if (matchedTruck) {
      setSelectedTruckId(matchedTruck.id);
      setEstimatedTonnes(matchedTruck.capacity_tonnes || matchedTruck.capacity || 30);
      const matchedDriver = drivers.find((d) => d.assigned_truck_id === matchedTruck.id);
      if (matchedDriver) setSelectedDriverId(matchedDriver.id);
    }
  };

  const handleDispatchTrip = (e: React.FormEvent) => {
    e.preventDefault();
    const newTrip = createLoadingTrip({
      plate: confirmedPlate,
      truckId: selectedTruckId,
      driverId: selectedDriverId,
      offloadingSiteId: destinationSiteId,
      estimatedTonnes,
      plateImageUrl: photoUrl,
      confidenceScore,
    });

    setSuccessToast(`Waybill Issued! Trip ${newTrip.trip_number} dispatched.`);
    setTimeout(() => setSuccessToast(null), 4500);
  };

  // Recent trips for this loading site
  const siteRecentTrips = trips
    .filter((t) => t.loading_site_id === activeSiteId)
    .slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Field Shift Notice Banner */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          backgroundColor: '#F8FAFC',
          borderLeft: '4px solid var(--brand-primary)',
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
              backgroundColor: '#E0F2FE',
              color: 'var(--brand-primary)',
            }}
          >
            <MapPin size={20} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.9375rem', fontWeight: 700 }}>
              Gate 1 Loading Station — {activeSite?.name}
            </h4>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Operator: <strong>Faith (Field Loading Officer)</strong> • Shift Target: 1,200 Tonnes
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="badge badge-blue">
            <ShieldCheck size={12} />
            OCR Engine Ready
          </span>
          <span className="badge badge-open">
            <Clock size={12} />
            Live Queue: {trips.filter((t) => t.status === 'open').length} in transit
          </span>
        </div>
      </div>

      {successToast && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: '#D1FAE5',
            border: '1px solid #6EE7B7',
            borderRadius: 'var(--radius-md)',
            color: '#065F46',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          <CheckCircle2 size={20} color="#059669" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Main Two-Column Field Layout */}
      <div className="field-two-col">
        {/* Left Column: Camera Viewfinder & OCR Candidates */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Camera size={18} color="var(--brand-primary)" />
              1. Truck Plate Camera Capture
            </h3>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Optical Character Recognition
            </span>
          </div>

          {/* Viewfinder Frame */}
          <div className="viewfinder">
            <img
              src={photoUrl}
              alt="License Plate Capture"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: isScanning ? 'blur(2px)' : 'none',
                transition: 'all 0.3s ease',
              }}
            />
            <div className="viewfinder-target">
              {isScanning && <div className="viewfinder-scanline" />}
            </div>

            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                right: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                padding: '0.4rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.75rem',
              }}
            >
              <span>{isScanning ? 'Extracting plate text...' : 'Frame: Full Resolution'}</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>
                Confidence: {confidenceScore}%
              </span>
            </div>
          </div>

          {/* Quick Simulation Plate Selectors */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
              ⚡ Field Test Vehicles (Tap to simulate camera scan):
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '36px' }}
                onClick={() =>
                  handleSelectPresetPlate(
                    'KJA-482XY',
                    'trk-1',
                    'drv-1',
                    'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80'
                  )
                }
              >
                Mack 30T (KJA-482XY)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '36px' }}
                onClick={() =>
                  handleSelectPresetPlate(
                    'APP-914AA',
                    'trk-2',
                    'drv-2',
                    'https://images.unsplash.com/photo-1586191582056-a602167d4f61?w=600&auto=format&fit=crop&q=80'
                  )
                }
              >
                Sino 35T (APP-914AA)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '36px' }}
                onClick={() =>
                  handleSelectPresetPlate(
                    'EPE-303ZZ',
                    'trk-3',
                    'drv-3',
                    'https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=600&auto=format&fit=crop&q=80'
                  )
                }
              >
                Actros 28T (EPE-303ZZ)
              </button>
            </div>
          </div>

          {/* OCR Result Box */}
          <div
            style={{
              padding: '1rem',
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                OCR CANDIDATE DETECTED
              </span>
              <span className="badge badge-closed" style={{ fontSize: '0.7rem' }}>
                <Sparkles size={11} /> {confidenceScore}% Confidence
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <PlateDisplay plate={candidatePlate} size="md" />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: '36px', fontSize: '0.8rem' }}
                onClick={() => handleManualPlateEdit(candidatePlate)}
              >
                <RotateCcw size={14} /> Re-verify
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Waybill Creation & Confirmation Form */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TruckIcon size={18} color="var(--brand-primary)" />
            2. Verify & Issue Movement Waybill
          </h3>

          <form onSubmit={handleDispatchTrip}>
            {/* Confirmed Plate Input */}
            <div className="form-group">
              <label className="form-label">
                Confirmed Vehicle License Plate (Editable if OCR misread)
              </label>
              <input
                type="text"
                className="form-input mono"
                style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '0.05em' }}
                value={confirmedPlate}
                onChange={(e) => handleManualPlateEdit(e.target.value)}
                required
              />
            </div>

            {/* Truck Selection & Specs */}
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Registered Vehicle Record</label>
                <select
                  className="form-select"
                  value={selectedTruckId}
                  onChange={(e) => {
                    setSelectedTruckId(e.target.value);
                    const trk = trucks.find((t) => t.id === e.target.value);
                    if (trk) {
                      setEstimatedTonnes(trk.capacity_tonnes || trk.capacity || 30);
                      setConfirmedPlate(trk.registration_number);
                    }
                  }}
                >
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.registration_number} ({t.truck_type} - {t.capacity_tonnes || t.capacity || 30}T)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Assigned Driver</label>
                <select
                  className="form-select"
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                >
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} ({d.phone})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Truck Capacity & Driver Details Preview */}
            <div
              className="info-stat-grid"
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: '#F1F5F9',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1rem',
                fontSize: '0.8125rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>HAULAGE OWNER</span>
                <strong style={{ color: 'var(--text-primary)' }}>{currentTruck?.owner_name}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>RATED CAPACITY</span>
                <strong style={{ color: 'var(--text-primary)' }}>{currentTruck?.capacity_tonnes} Tonnes</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>DRIVER LICENSE</span>
                <strong style={{ color: 'var(--text-primary)' }}>{currentDriver?.license_number}</strong>
              </div>
            </div>

            {/* Destination & Payload Estimation */}
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Designated Offloading Depot</label>
                <select
                  className="form-select"
                  value={destinationSiteId}
                  onChange={(e) => setDestinationSiteId(e.target.value)}
                >
                  {offloadingSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Estimated Payload (Tonnes)</label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input mono"
                  value={estimatedTonnes}
                  onChange={(e) => setEstimatedTonnes(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            {/* Submit Action */}
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: '0.5rem', display: 'flex', justifyContent: 'center' }}
            >
              <span>DISPATCH TRUCK & ISSUE WAYBILL</span>
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
      </div>

      {/* Gate 1 Recent Shifts Ledger */}
      <div className="card">
        <div className="card-header">
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700 }}>
            Recent Dispatches From {activeSite?.name}
          </h4>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Showing last {siteRecentTrips.length} movements
          </span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waybill / Trip ID</th>
                <th>Truck Plate</th>
                <th>Driver</th>
                <th>Destination</th>
                <th>Payload</th>
                <th>Time Loaded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {siteRecentTrips.map((t) => (
                <tr key={t.id}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                    {t.trip_number}
                  </td>
                  <td>
                    <PlateDisplay plate={t.truck?.registration_number || t.loading_event?.confirmed_plate || 'N/A'} size="sm" />
                  </td>
                  <td>{t.driver?.full_name || 'Assigned Driver'}</td>
                  <td>{t.offloading_site?.name || 'Central Depot'}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {t.loading_event?.estimated_tonnes || 30} Tonnes
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {new Date(t.loaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>
                    <StatusBadge status={t.status} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
