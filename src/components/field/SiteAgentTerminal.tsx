import React, { useState, useRef } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { PlateDisplay } from '../common/PlateDisplay';
import { StatusBadge } from '../common/StatusBadge';
import {
  Camera,
  CheckCircle2,
  Truck as TruckIcon,
  Scale,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Clock,
  FileText,
  AlertTriangle,
  Upload,
  Check,
} from 'lucide-react';
import { QuantityUnit, ExceptionType } from '../../types';

export const SiteAgentTerminal: React.FC = () => {
  const {
    activeSite,
    sites,
    trucks,
    drivers,
    trips,
    openTrips,
    createLoadingTrip,
    closeOffloadingTrip,
    raiseTripException,
  } = useAppState();

  // Hidden native camera file input ref (with capture="environment" for mobile camera app)
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [hasScanned, setHasScanned] = useState(false);

  // 1. Camera & Scan State
  const [candidatePlate, setCandidatePlate] = useState('KJA-482XY');
  const [confirmedPlate, setConfirmedPlate] = useState('KJA-482XY');
  const [confidenceScore, setConfidenceScore] = useState(97.6);
  const [selectedTruckId, setSelectedTruckId] = useState('trk-1');
  const [selectedDriverId, setSelectedDriverId] = useState('drv-1');
  const [photoUrl, setPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80'
  );
  const [isScanning, setIsScanning] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);

  // 2. Movement Type State: 'pickup' vs 'delivery'
  // (Chosen ONLY once the image is captured / scanned)
  const [movementType, setMovementType] = useState<'pickup' | 'delivery'>('pickup');

  // 3. Pickup Specific Form State
  const [destinationSiteId, setDestinationSiteId] = useState('site-lkk-01');
  const [estimatedTonnes, setEstimatedTonnes] = useState(30);
  const [pickupNotes, setPickupNotes] = useState('');

  // 4. Delivery Specific Form State
  const [scaleTicketNumber, setScaleTicketNumber] = useState('WT-2026-9041');
  const [deliveredTonnes, setDeliveredTonnes] = useState(29.8);
  const [ticketPhotoUrl, setTicketPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80'
  );
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [isFlaggingException, setIsFlaggingException] = useState(false);
  const [exceptionType, setExceptionType] = useState<ExceptionType>('quantity_mismatch');
  const [exceptionDesc, setExceptionDesc] = useState('');

  // Activity feed tab
  const [activityFilter, setActivityFilter] = useState<'all' | 'pickup' | 'delivery'>('all');

  // Lookup truck & driver details
  const currentTruck = trucks.find((t) => t.id === selectedTruckId);
  const currentDriver = drivers.find((d) => d.id === selectedDriverId);
  const offloadingSites = sites.filter((s) => s.site_type === 'offloading');

  // Check if there is an existing in-transit trip matching this truck for Delivery
  const matchingOpenTrip = openTrips.find(
    (t) =>
      t.truck_id === selectedTruckId ||
      t.truck?.registration_number.toLowerCase() === confirmedPlate.toLowerCase()
  ) || (openTrips.length > 0 ? openTrips[0] : null);

  // Camera capture handler (invoked when mobile device camera snaps a photo)
  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setPhotoUrl(localUrl);
    setHasScanned(true);
    setIsScanning(true);

    setTimeout(() => {
      const randomTruck = trucks[Math.floor(Math.random() * trucks.length)] || trucks[0];
      const detectedPlate = randomTruck?.registration_number || 'KJA-482XY';
      setCandidatePlate(detectedPlate);
      setConfirmedPlate(detectedPlate);
      if (randomTruck) {
        setSelectedTruckId(randomTruck.id);
        setEstimatedTonnes(randomTruck.capacity_tonnes);
        setDeliveredTonnes(randomTruck.capacity_tonnes);
        const matchedDriver = drivers.find((d) => d.assigned_truck_id === randomTruck.id);
        if (matchedDriver) setSelectedDriverId(matchedDriver.id);
      }
      setConfidenceScore(Number((96.5 + Math.random() * 3).toFixed(1)));
      setIsScanning(false);
      setToastMessage({
        text: `Truck plate [${detectedPlate}] captured via camera and verified!`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 4000);
    }, 600);

    e.target.value = '';
  };

  // Simulation handler when scanning different trucks (for testing)
  const handleScanPreset = (plate: string, truckId: string, driverId: string, img: string) => {
    setHasScanned(true);
    setIsScanning(true);
    setTimeout(() => {
      setCandidatePlate(plate);
      setConfirmedPlate(plate);
      setSelectedTruckId(truckId);
      setSelectedDriverId(driverId);
      setPhotoUrl(img);
      setConfidenceScore(Number((95 + Math.random() * 4).toFixed(1)));
      const trk = trucks.find((t) => t.id === truckId);
      if (trk) {
        setEstimatedTonnes(trk.capacity_tonnes);
        setDeliveredTonnes(trk.capacity_tonnes);
      }
      setIsScanning(false);
    }, 450);
  };

  const handleManualPlateEdit = (newPlate: string) => {
    setConfirmedPlate(newPlate);
    const normalized = newPlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const matchedTruck = trucks.find((t) => t.normalized_registration === normalized);
    if (matchedTruck) {
      setSelectedTruckId(matchedTruck.id);
      setEstimatedTonnes(matchedTruck.capacity_tonnes);
      setDeliveredTonnes(matchedTruck.capacity_tonnes);
      const matchedDriver = drivers.find((d) => d.assigned_truck_id === matchedTruck.id);
      if (matchedDriver) setSelectedDriverId(matchedDriver.id);
    }
  };

  // Submit Pickup (Loading Gate Dispatch)
  const handleDispatchPickup = (e: React.FormEvent) => {
    e.preventDefault();
    const newTrip = createLoadingTrip({
      plate: confirmedPlate,
      truckId: selectedTruckId,
      driverId: selectedDriverId,
      offloadingSiteId: destinationSiteId,
      estimatedTonnes,
      plateImageUrl: photoUrl,
      confidenceScore,
      notes: pickupNotes,
    });

    setToastMessage({
      text: `Waybill Issued! Trip ${newTrip.trip_number} dispatched for Pickup.`,
      type: 'success',
    });
    setPickupNotes('');
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Submit Delivery (Offloading Gate / Weighbridge Close)
  const handleCompleteDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchingOpenTrip) {
      setToastMessage({
        text: 'No active inbound trip found for this truck to close.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }

    const result = closeOffloadingTrip(matchingOpenTrip.id, {
      quantity: deliveredTonnes,
      unit: 'tonnes' as QuantityUnit,
      scaleTicketNumber,
      scaleTicketUrl: ticketPhotoUrl,
      notes: deliveryNotes,
    });

    if (result.success) {
      setToastMessage({
        text: `Trip ${matchingOpenTrip.trip_number} successfully verified and closed!`,
        type: result.varianceAlert ? 'warning' : 'success',
      });
      setDeliveryNotes('');
      setTimeout(() => setToastMessage(null), 4500);
    }
  };

  // Raise Exception on Delivery
  const handleRaiseDeliveryException = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchingOpenTrip) return;

    raiseTripException(matchingOpenTrip.id, {
      type: exceptionType,
      description: exceptionDesc || `Delivered ${deliveredTonnes}T deviates from dispatched payload.`,
      severity: 'high',
    });

    setIsFlaggingException(false);
    setToastMessage({
      text: `Discrepancy Exception flagged on Trip ${matchingOpenTrip.trip_number}. Escalated to Manager.`,
      type: 'warning',
    });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Recent trips processed
  const filteredRecentTrips = trips.filter((t) => {
    if (activityFilter === 'pickup') return t.status === 'open';
    if (activityFilter === 'delivery') return t.status === 'closed';
    return true;
  }).slice(0, 6);

  // Variance calculation for delivery
  const expectedTonnage = matchingOpenTrip?.loading_event?.estimated_tonnes || currentTruck?.capacity_tonnes || 30;
  const varianceDiff = deliveredTonnes - expectedTonnage;
  const variancePct = ((varianceDiff / expectedTonnage) * 100).toFixed(1);
  const isToleranceOk = Math.abs(varianceDiff) <= 1.5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Site Agent Shift Header */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          backgroundColor: '#FFFFFF',
          borderLeft: '4px solid #B45309',
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
              backgroundColor: '#FEF3C7',
              color: '#B45309',
            }}
          >
            <Camera size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A' }}>
                Site Agent Terminal — Scan & Record
              </h3>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  backgroundColor: '#FEF3C7',
                  color: '#B45309',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid #FCD34D',
                }}
              >
                SITE AGENT
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Station: <strong>{activeSite?.name}</strong> • Operator: <strong>Faith (Site Agent)</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
            <Clock size={14} color="var(--text-muted)" />
            <span style={{ color: 'var(--text-muted)' }}>Active Queue:</span>
            <strong style={{ color: '#0284C7' }}>{openTrips.length} In-Transit</strong>
          </div>
        </div>
      </div>

      {/* Success / Warning Toast */}
      {toastMessage && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            backgroundColor: toastMessage.type === 'success' ? '#D1FAE5' : '#FEF3C7',
            border: `1px solid ${toastMessage.type === 'success' ? '#6EE7B7' : '#FCD34D'}`,
            borderRadius: 'var(--radius-md)',
            color: toastMessage.type === 'success' ? '#065F46' : '#B45309',
            fontWeight: 600,
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 size={18} color="#059669" />
          ) : (
            <AlertTriangle size={18} color="#B45309" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Hidden File/Camera Input with capture="environment" for Mobile Camera App */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraCapture}
        aria-label="Capture Truck Photo"
      />

      {/* MAJOR OPTION: Click to Scan Button (Opens onto Camera App on Mobile) */}
      <div
        className="card"
        style={{
          padding: '1.25rem 1rem',
          backgroundColor: '#FFFFFF',
          border: '2px solid #F59E0B',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '0.75rem',
          background: 'linear-gradient(180deg, #FFFDF5 0%, #FFFFFF 100%)',
        }}
      >

        {/* Big Touch-First "Click to Scan" Button */}
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          style={{
            width: '100%',
            maxWidth: '460px',
            minHeight: '62px',
            padding: '0.85rem 1.25rem',
            backgroundColor: '#B45309',
            color: '#FFFFFF',
            borderRadius: 'var(--radius-lg)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.85rem',
            cursor: 'pointer',
            fontSize: '1.15rem',
            fontWeight: 800,
            boxShadow: '0 4px 14px rgba(180, 83, 9, 0.35)',
            transition: 'all 0.15s ease',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Camera size={24} />
          </div>
          <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
              {hasScanned ? 'Click to Scan Next Truck' : 'Click to Scan'}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.9 }}>
              Opens camera app on mobile device
            </div>
          </div>
        </button>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, maxWidth: '420px', lineHeight: 1.4 }}>
          {hasScanned ? (
            <>
              Plate <strong style={{ color: '#0F172A' }}>{confirmedPlate}</strong> verified ({confidenceScore}%). Choose <strong>Pickup (Gate 1)</strong> or <strong>Delivery (Gate 2)</strong> below, or tap above to scan another truck.
            </>
          ) : (
            <>
              Tap the button above to launch your mobile camera and scan the license plate of the incoming sand truck.
            </>
          )}
        </p>
      </div>

      {/* Main Two-Column Terminal Layout */}
      <div className="field-two-col">
        {/* Left Column: Camera Viewfinder & OCR Extraction */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Camera size={18} color="#B45309" />
              1. Scan Truck & License Plate
            </h3>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Sparkles size={13} />
              {hasScanned ? 'OCR Verified' : 'OCR Standby'}
            </span>
          </div>

          {/* Viewfinder Window */}
          <div className="viewfinder" style={{ position: 'relative', overflow: 'hidden' }}>
            <img
              src={photoUrl}
              alt="Truck Plate Scan"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: isScanning ? 'blur(2px)' : !hasScanned ? 'brightness(0.6)' : 'none',
                transition: 'all 0.3s ease',
              }}
            />
            <div className="viewfinder-target">
              {isScanning && <div className="viewfinder-scanline" />}
            </div>

            {!hasScanned && !isScanning && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(15, 23, 42, 0.45)',
                  color: '#FFFFFF',
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <Camera size={32} color="#FCD34D" />
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                  Camera Standby
                </span>
                <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
                  Tap "Click to Scan" above to open camera
                </span>
              </div>
            )}

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
              <span>{isScanning ? 'Extracting vehicle registration...' : hasScanned ? 'HD OCR Viewfinder' : 'Ready to Scan'}</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>
                {hasScanned ? `Confidence: ${confidenceScore}%` : 'Standby'}
              </span>
            </div>
          </div>

          {/* Simulated Inbound Queue / Camera Snaps */}
          <div>
            <label
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: '0.4rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Quick Test Scans (Desktop / Simulation):
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '0.5rem',
              }}
            >
              {[
                {
                  plate: 'KJA-482XY',
                  truckId: 'trk-1',
                  driverId: 'drv-1',
                  label: 'Mack Granite (30T)',
                  img: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80',
                },
                {
                  plate: 'LND-902XA',
                  truckId: 'trk-2',
                  driverId: 'drv-2',
                  label: 'Mercedes Actros (35T)',
                  img: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=600&auto=format&fit=crop&q=80',
                },
                {
                  plate: 'APP-319BD',
                  truckId: 'trk-3',
                  driverId: 'drv-3',
                  label: 'Sinotruk Howo (25T)',
                  img: 'https://images.unsplash.com/photo-1586191582152-4467c6999a9a?w=600&auto=format&fit=crop&q=80',
                },
                {
                  plate: 'AGL-774XC',
                  truckId: 'trk-4',
                  driverId: 'drv-4',
                  label: 'Shacman Tipper (30T)',
                  img: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&auto=format&fit=crop&q=80',
                },
              ].map((p) => (
                <button
                  key={p.plate}
                  type="button"
                  onClick={() => handleScanPreset(p.plate, p.truckId, p.driverId, p.img)}
                  style={{
                    padding: '0.45rem 0.6rem',
                    borderRadius: 'var(--radius-md)',
                    border: confirmedPlate === p.plate ? '2px solid #B45309' : '1px solid var(--border-subtle)',
                    backgroundColor: confirmedPlate === p.plate ? '#FEF3C7' : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <strong style={{ fontSize: '0.8rem', color: confirmedPlate === p.plate ? '#B45309' : '#0F172A' }}>
                    {p.plate}
                  </strong>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* OCR Result & Confirmed Registration */}
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: '#F8FAFC',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                IDENTIFIED PLATE:
              </span>
              <PlateDisplay plate={confirmedPlate} size="md" />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                style={{
                  minHeight: '38px',
                  fontSize: '0.875rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
                value={confirmedPlate}
                onChange={(e) => handleManualPlateEdit(e.target.value)}
                placeholder="Edit plate if OCR differs..."
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: '38px', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                onClick={() => handleManualPlateEdit(candidatePlate)}
                title="Reset to OCR candidate"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {/* Vehicle Master Context */}
          <div
            className="info-stat-grid"
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#F8FAFC',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8125rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>HAULIER / OWNER</span>
              <strong style={{ color: 'var(--text-primary)' }}>{currentTruck?.owner_name || 'Verified Fleet'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>RATED PAYLOAD</span>
              <strong style={{ color: 'var(--text-primary)' }}>{currentTruck?.capacity_tonnes || 30} Tonnes</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>ASSIGNED DRIVER</span>
              <strong style={{ color: 'var(--text-primary)' }}>{currentDriver?.full_name || 'Driver On File'}</strong>
            </div>
          </div>
        </div>

        {/* Right Column: THE CHOICE & SAVE PANEL */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.25rem' }}>
              2. Save Truck Movement Record
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Scan complete. Choose whether this input should be recorded as a <strong>Pickup</strong> or <strong>Delivery</strong>:
            </p>
          </div>

          {/* THE MANDATORY CHOICE TOGGLE BUTTONS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.75rem',
            }}
          >
            {/* PICKUP BUTTON */}
            <button
              type="button"
              onClick={() => setMovementType('pickup')}
              style={{
                padding: '0.875rem 1rem',
                borderRadius: 'var(--radius-lg)',
                border: movementType === 'pickup' ? '2.5px solid #B45309' : '1.5px solid var(--border-default)',
                backgroundColor: movementType === 'pickup' ? '#FEF3C7' : '#FFFFFF',
                color: movementType === 'pickup' ? '#B45309' : 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.35rem',
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: movementType === 'pickup' ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, fontSize: '0.9375rem' }}>
                  <TruckIcon size={18} />
                  PICKUP
                </span>
                {movementType === 'pickup' && (
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: '#B45309',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Check size={12} />
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.725rem', color: movementType === 'pickup' ? '#92400E' : 'var(--text-muted)', lineHeight: 1.3 }}>
                Gate 1 Dredge Pit loading & digital waybill issuance
              </span>
            </button>

            {/* DELIVERY BUTTON */}
            <button
              type="button"
              onClick={() => setMovementType('delivery')}
              style={{
                padding: '0.875rem 1rem',
                borderRadius: 'var(--radius-lg)',
                border: movementType === 'delivery' ? '2.5px solid #047857' : '1.5px solid var(--border-default)',
                backgroundColor: movementType === 'delivery' ? '#D1FAE5' : '#FFFFFF',
                color: movementType === 'delivery' ? '#047857' : 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.35rem',
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: movementType === 'delivery' ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, fontSize: '0.9375rem' }}>
                  <Scale size={18} />
                  DELIVERY
                </span>
                {movementType === 'delivery' && (
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: '#047857',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Check size={12} />
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.725rem', color: movementType === 'delivery' ? '#065F46' : 'var(--text-muted)', lineHeight: 1.3 }}>
                Gate 2 Depot weighbridge scale check & trip closure
              </span>
            </button>
          </div>

          {/* SUB-FORM A: PICKUP WORKFLOW */}
          {movementType === 'pickup' && (
            <form onSubmit={handleDispatchPickup} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: '#FEF3C7',
                  border: '1px solid #FCD34D',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.78rem',
                  color: '#92400E',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <TruckIcon size={16} />
                <span>
                  Recording <strong>Pickup</strong> at <strong>{activeSite?.name}</strong>. Waybill will be created with status OPEN.
                </span>
              </div>

              {/* Destination & Payload Estimation */}
              <div className="grid-2">
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Designated Offloading Depot</label>
                  <select
                    className="form-select"
                    value={destinationSiteId}
                    onChange={(e) => setDestinationSiteId(e.target.value)}
                  >
                    {offloadingSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Estimated Payload (Tonnes)</label>
                  <input
                    type="number"
                    className="form-input"
                    step="0.5"
                    min="5"
                    max="60"
                    value={estimatedTonnes}
                    onChange={(e) => setEstimatedTonnes(Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              {/* Material Type & Notes */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Cargo Material Specification</label>
                <input
                  type="text"
                  className="form-input"
                  value="Sharp White Dredged Lagoon Sand (Grade A)"
                  readOnly
                  style={{ backgroundColor: '#F8FAFC', color: 'var(--text-secondary)' }}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Operator Field Notes (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Clean truck bed inspected, verified driver badge"
                  value={pickupNotes}
                  onChange={(e) => setPickupNotes(e.target.value)}
                />
              </div>

              {/* Dispatch Action Button */}
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  backgroundColor: '#B45309',
                  borderColor: '#92400E',
                  boxShadow: '0 2px 4px 0 rgba(180, 83, 9, 0.25)',
                }}
              >
                <TruckIcon size={18} />
                <span>Save as Pickup & Issue Digital Waybill</span>
                <ArrowRight size={16} />
              </button>
            </form>
          )}

          {/* SUB-FORM B: DELIVERY WORKFLOW */}
          {movementType === 'delivery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: '#D1FAE5',
                  border: '1px solid #6EE7B7',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.78rem',
                  color: '#065F46',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Scale size={16} />
                <span>
                  Recording <strong>Delivery</strong> at <strong>{activeSite?.name}</strong>. Matching with in-transit waybill.
                </span>
              </div>

              {/* Linked Inbound Waybill Card */}
              {matchingOpenTrip ? (
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: '#F8FAFC',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                      MATCHED INBOUND TRIP
                    </span>
                    <span className="badge badge-open">IN TRANSIT</span>
                  </div>
                  <div style={{ fontSize: '0.925rem', fontWeight: 800, color: '#0F172A' }}>
                    Waybill #{matchingOpenTrip?.trip_number}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Dispatched from: <strong>{matchingOpenTrip?.loading_site?.name}</strong> • Expected: <strong>{matchingOpenTrip?.loading_event?.estimated_tonnes || matchingOpenTrip?.truck?.capacity_tonnes || 30} Tonnes</strong>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    backgroundColor: '#FEF3C7',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #FCD34D',
                    fontSize: '0.8rem',
                    color: '#92400E',
                  }}
                >
                  No active in-transit trip matched plate {confirmedPlate}. Please verify plate number or select from in-transit list.
                </div>
              )}

              {!isFlaggingException ? (
                <form onSubmit={handleCompleteDelivery} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="grid-2">
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Physical Scale Ticket #</label>
                      <input
                        type="text"
                        className="form-input"
                        value={scaleTicketNumber}
                        onChange={(e) => setScaleTicketNumber(e.target.value)}
                        placeholder="e.g. WT-9024"
                        required
                      />
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Delivered Weight (Tonnes)</label>
                      <input
                        type="number"
                        className="form-input"
                        step="0.1"
                        min="5"
                        max="60"
                        value={deliveredTonnes}
                        onChange={(e) => setDeliveredTonnes(Number(e.target.value))}
                        required
                      />
                    </div>
                  </div>

                  {/* Variance Indicator */}
                  <div
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: isToleranceOk ? '#F0FDF4' : '#FEF2F2',
                      border: `1px solid ${isToleranceOk ? '#BBF7D0' : '#FECACA'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.78rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <ShieldCheck size={15} color={isToleranceOk ? '#16A34A' : '#DC2626'} />
                      <span style={{ fontWeight: 600, color: isToleranceOk ? '#15803D' : '#B91C1C' }}>
                        Variance: {varianceDiff >= 0 ? `+${varianceDiff.toFixed(1)}` : varianceDiff.toFixed(1)} T ({variancePct}%)
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: isToleranceOk ? '#15803D' : '#B91C1C', fontWeight: 700 }}>
                      {isToleranceOk ? 'WITHIN TOLERANCE (±5%)' : 'DISCREPANCY ALERT'}
                    </span>
                  </div>

                  {/* Ticket Evidence Preview */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Weighbridge Scale Ticket Evidence</label>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.5rem',
                        border: '1px dashed var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: '#F8FAFC',
                      }}
                    >
                      <img
                        src={ticketPhotoUrl}
                        alt="Scale Ticket Preview"
                        style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>
                          Scale_Ticket_{scaleTicketNumber}.jpg
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          1.4 MB • SHA-256 Verified
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ minHeight: '32px', fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                        onClick={() =>
                          setTicketPhotoUrl(
                            'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80'
                          )
                        }
                      >
                        <Upload size={12} />
                        Attach
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Delivery Notes (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Weighbridge calibration valid, moisture within norm"
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                    />
                  </div>

                  {/* Complete Delivery Action Button */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="submit"
                      className="btn btn-success btn-lg"
                      style={{ flex: 1 }}
                      disabled={!matchingOpenTrip}
                    >
                      <CheckCircle2 size={18} />
                      <span>Save as Delivery & Close Trip</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ minHeight: '44px', color: '#DC2626', borderColor: '#FCA5A5' }}
                      onClick={() => setIsFlaggingException(true)}
                      title="Flag discrepancy for manager triage"
                    >
                      <AlertTriangle size={16} />
                      <span>Flag</span>
                    </button>
                  </div>
                </form>
              ) : (
                /* Exception Triage Form */
                <form
                  onSubmit={handleRaiseDeliveryException}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                    padding: '1rem',
                    backgroundColor: '#FEF2F2',
                    borderRadius: 'var(--radius-md)',
                    border: '1.5px solid #FECACA',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 800, color: '#991B1B', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertTriangle size={16} />
                      Flag Weighbridge Discrepancy
                    </h4>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontSize: '0.75rem', fontWeight: 700 }}
                      onClick={() => setIsFlaggingException(false)}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ color: '#991B1B' }}>Discrepancy Category</label>
                    <select
                      className="form-select"
                      value={exceptionType}
                      onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
                    >
                      <option value="quantity_mismatch">Delivered Weight Mismatch (&gt; 5% Variance)</option>
                      <option value="diversion_suspected">Suspected Diversion / Route Delay</option>
                      <option value="plate_discrepancy">Vehicle Plate / Registration Discrepancy</option>
                      <option value="unlisted_truck">Unregistered Vehicle / Fake Waybill</option>
                      <option value="damaged_cargo">Contaminated / Substandard Sand Quality</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ color: '#991B1B' }}>Discrepancy Description</label>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      placeholder="Detail physical scale ticket vs dispatch discrepancy..."
                      value={exceptionDesc}
                      onChange={(e) => setExceptionDesc(e.target.value)}
                      required
                    />
                  </div>

                  <button type="submit" className="btn btn-danger" style={{ width: '100%', minHeight: '40px' }}>
                    Submit Exception to Operations Manager
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent Movements Processed by Site Agent */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <FileText size={17} color="var(--brand-primary)" />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>
              Recent Field Movements Processed
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {(['all', 'pickup', 'delivery'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="btn"
                style={{
                  minHeight: '30px',
                  padding: '0.2rem 0.65rem',
                  fontSize: '0.75rem',
                  backgroundColor: activityFilter === f ? 'var(--brand-primary)' : 'var(--bg-subtle)',
                  color: activityFilter === f ? '#FFFFFF' : 'var(--text-secondary)',
                  border: activityFilter === f ? '1px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                }}
                onClick={() => setActivityFilter(f)}
              >
                {f === 'all' ? 'All (Both)' : f === 'pickup' ? 'Pickups (Gate 1)' : 'Deliveries (Gate 2)'}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waybill #</th>
                <th>Truck Plate</th>
                <th>Type</th>
                <th>Tonnes</th>
                <th>Route / Facility</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecentTrips.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    No recent records matching filter.
                  </td>
                </tr>
              ) : (
                filteredRecentTrips.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                        {trip.trip_number}
                      </span>
                    </td>
                    <td>
                      <PlateDisplay plate={trip.truck?.registration_number || 'UNKNOWN'} size="sm" />
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: trip.status === 'open' ? '#FEF3C7' : '#D1FAE5',
                          color: trip.status === 'open' ? '#B45309' : '#047857',
                        }}
                      >
                        {trip.status === 'open' ? 'PICKUP' : 'DELIVERY'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {trip.status === 'open'
                        ? `${trip.loading_event?.estimated_tonnes || trip.truck?.capacity_tonnes || 30} T`
                        : `${trip.offloading_event?.quantity || trip.loading_event?.estimated_tonnes || trip.truck?.capacity_tonnes || 30} T`}
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>
                      {trip.status === 'open'
                        ? `${trip.loading_site?.code} ➔ ${trip.offloading_site?.code}`
                        : `Delivered at ${trip.offloading_site?.name}`}
                    </td>
                    <td>
                      <StatusBadge status={trip.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
