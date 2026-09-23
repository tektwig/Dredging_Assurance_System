import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../services/store';
import {
  Camera,
  ScanLine,
  Check,
  Truck as TruckIcon,
  User,
  MapPin,
  Sparkles,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';

import { recognizeLicensePlate, OCRProgress } from '../services/ocrService';

export const LoadingCapture: React.FC = () => {
  const {
    currentSiteId,
    sites,
    trucks,
    drivers,
    createLoadingTrip,
    isOnline,
  } = useAppStore();

  const loadingSites = sites.filter((s) => s.site_type === 'loading' || s.site_type === 'hybrid');
  const [selectedSiteId, setSelectedSiteId] = useState(
    loadingSites.find((s) => s.id === currentSiteId)?.id || loadingSites[0]?.id || ''
  );

  // Form states
  const [selectedTruckId, setSelectedTruckId] = useState(trucks[0]?.id || '');
  const [selectedDriverId, setSelectedDriverId] = useState(drivers[0]?.id || '');
  const [notes, setNotes] = useState('');

  // OCR & Image state
  const [isScanning, setIsScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('Ready');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [rawOcrText, setRawOcrText] = useState('');
  const [candidatePlate, setCandidatePlate] = useState(trucks[0]?.registration_number || 'APP-482-XA');
  const [confidenceScore, setConfidenceScore] = useState(96.5);
  const [ocrMatchType, setOcrMatchType] = useState<'EXACT_FLEET' | 'FUZZY_FLEET' | 'SYNTACTIC_VALID' | 'FALLBACK' | null>(null);
  const [preprocessedImageUrl, setPreprocessedImageUrl] = useState<string | null>(null);
  const [capturedImagePreview, setCapturedImagePreview] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedTripNumber, setSubmittedTripNumber] = useState('');

  // Live Camera states & refs
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const currentTruck = trucks.find((t) => t.id === selectedTruckId);

  // Check if plate matches a recognized active truck (BRD FR-09)
  const isPlateRecognized = trucks.some(
    (t) => t.normalized_registration === candidatePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  );

  // Helper to generate a realistic Nigerian license plate image onto an in-memory canvas
  const createSamplePlateImage = (plateNumber: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Plate background (Commercial yellow)
    ctx.fillStyle = '#FED766';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dark border
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

    // Header strip
    ctx.fillStyle = '#065F46';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FEDERAL REPUBLIC OF NIGERIA', canvas.width / 2, 28);

    // Main plate number
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(plateNumber, canvas.width / 2, 85);

    // Footer
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('CENTRE OF EXCELLENCE', canvas.width / 2, 120);

    return canvas.toDataURL('image/png');
  };

  // Perform actual OCR recognition on an image source
  const runActualOCR = async (imageSrc: string | File) => {
    setIsScanning(true);
    setScanComplete(false);
    setOcrError(null);
    setOcrProgress(0);

    try {
      const result = await recognizeLicensePlate(
        imageSrc,
        trucks,
        (p: OCRProgress) => {
          setOcrStatus(p.status);
          setOcrProgress(Math.round(p.progress * 100));
        }
      );

      setRawOcrText(result.rawText);
      setCandidatePlate(result.candidatePlate);
      setConfidenceScore(result.confidence);
      setOcrMatchType(result.matchType);
      if (result.preprocessedImageUrl) {
        setPreprocessedImageUrl(result.preprocessedImageUrl);
      }

      if (result.matchedTruck) {
        setSelectedTruckId(result.matchedTruck.id);
      }

      setIsScanning(false);
      setScanComplete(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOcrError(`OCR Engine error: ${msg}`);
      setIsScanning(false);
    }
  };

  // Stop camera stream when component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // When live camera is toggled on and video element is mounted, attach stream
  useEffect(() => {
    if (isLiveCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((err) => {
        console.warn('Video playback warning:', err);
      });
    }
  }, [isLiveCameraActive]);

  const startLiveCamera = async (facing: 'environment' | 'user' = cameraFacingMode) => {
    setCameraError(null);
    setIsCameraStarting(true);

    // Stop existing stream if any
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access API is not available on this device/context.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraFacingMode(facing);
      setIsLiveCameraActive(true);
      setIsCameraStarting(false);
    } catch (err: unknown) {
      setIsCameraStarting(false);
      setIsLiveCameraActive(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setCameraError('Camera permission was denied. Please allow camera access in browser permissions, or use "Upload Photo".');
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
        setCameraError('No video camera device detected. Please use "Upload Photo" or "Test Sample Plate".');
      } else {
        setCameraError(`Camera error: ${msg}. Please use "Upload Photo" to select an image from your files.`);
      }
    }
  };

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsLiveCameraActive(false);
    setIsCameraStarting(false);
  };

  const toggleFacingMode = () => {
    const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    startLiveCamera(nextMode);
  };

  const captureFrameAndRunOCR = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;

    // Target the central reticle bounding area (78% width, 46% height) where user aligns plate
    const cropWidth = Math.round(videoWidth * 0.78);
    const cropHeight = Math.round(videoHeight * 0.46);
    const cropX = Math.round((videoWidth - cropWidth) / 2);
    const cropY = Math.round((videoHeight - cropHeight) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    stopLiveCamera();
    setCapturedImagePreview(dataUrl);
    runActualOCR(dataUrl);
  };

  const handleSimulateSampleScan = () => {
    if (isLiveCameraActive) {
      stopLiveCamera();
    }
    const randomTruck = trucks[Math.floor(Math.random() * trucks.length)];
    const sampleImg = createSamplePlateImage(randomTruck.registration_number);
    setCapturedImagePreview(sampleImg);
    runActualOCR(sampleImg);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTruckId) return;

    const result = createLoadingTrip({
      truck_id: selectedTruckId,
      driver_id: selectedDriverId,
      loading_site_id: selectedSiteId,
      confirmed_plate: candidatePlate,
      confidence_score: confidenceScore,
      notes,
    });

    if (result.success) {
      setIsSubmitted(true);
      setSubmittedTripNumber(result.trip?.trip_number || 'OFFLINE-DRAFT');
      setTimeout(() => {
        setIsSubmitted(false);
        setNotes('');
        setScanComplete(false);
      }, 3500);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '1.5rem auto', padding: '0 1rem' }}>
      {/* Success banner */}
      {isSubmitted && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)',
            border: '1px solid #10B981',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <CheckCircle size={32} color="#10B981" />
          <div>
            <h3 style={{ color: '#34D399', fontSize: '1.1rem' }}>
              {isOnline ? 'Trip Event Successfully Recorded!' : 'Trip Captured to Offline Draft Queue'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Trip Waybill #{submittedTripNumber} — Status: <strong>{isOnline ? 'OPEN' : 'DRAFT_CAPTURE'}</strong>. Truck cleared for transit.
            </p>
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="glass-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--accent-gold)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Step 1: Dredge Gate Dispatch
            </span>
            <h2 style={{ fontSize: '1.4rem', marginTop: '0.2rem' }}>Loading Point Capture</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Fast plate scan, automated OCR candidate extraction & trip initiation.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="badge badge-open">
              <span className="pulse-dot" /> Live Capture
            </span>
          </div>
        </div>

        {/* OCR Camera Section */}
        <div
          style={{
            background: '#0B1120',
            borderRadius: 'var(--radius-md)',
            border: '2px dashed var(--border-medium)',
            padding: '1.75rem 1rem',
            textAlign: 'center',
            marginBottom: '1.5rem',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {ocrError && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid #F43F5E',
                color: '#FB7185',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1rem',
                fontSize: '0.85rem',
              }}
            >
              {ocrError}
            </div>
          )}

          {cameraError && (
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid #F59E0B',
                color: '#FCD34D',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <AlertCircle size={18} color="#F59E0B" />
              <span>{cameraError}</span>
            </div>
          )}

          {isScanning ? (
            <div style={{ padding: '2rem 1rem' }}>
              <ScanLine size={48} color="var(--accent-gold)" className="spin" style={{ margin: '0 auto 1rem' }} />
              <h4 style={{ color: 'var(--accent-gold)' }}>Tesseract WebAssembly OCR Running</h4>
              <p style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600, marginTop: '0.25rem' }}>
                {ocrStatus}
              </p>

              {/* Real Progress Bar */}
              <div
                style={{
                  width: '80%',
                  maxWidth: '360px',
                  height: '8px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  margin: '1rem auto 0.5rem',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${ocrProgress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--accent-gold) 0%, var(--accent-cyan) 100%)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ocrProgress}% complete</span>
            </div>
          ) : isLiveCameraActive ? (
            /* Live Camera Viewfinder Mode */
            <div style={{ padding: '0.5rem 0' }}>
              <div className="camera-viewfinder-box">
                <div className="camera-live-pill">
                  <span className="pulse-dot" /> Live Camera Stream
                </div>

                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="camera-video-feed"
                />

                {/* Reticle targeting box */}
                <div className="camera-reticle-overlay">
                  <div className="camera-scanline-laser" />
                  <span className="camera-reticle-label">Align Plate In Frame</span>
                </div>
              </div>

              {/* Live camera controls */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={captureFrameAndRunOCR}
                  className="btn btn-primary btn-lg"
                  style={{ minWidth: '200px' }}
                  id="btn-snap-ocr"
                >
                  <Camera size={20} />
                  Snap & Run OCR
                </button>

                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="btn btn-secondary"
                  title="Switch between front and back camera"
                  id="btn-switch-camera"
                >
                  <RefreshCw size={16} />
                  Switch Camera
                </button>

                <button
                  type="button"
                  onClick={stopLiveCamera}
                  className="btn btn-secondary"
                  style={{ color: '#FB7185', borderColor: 'rgba(244, 63, 94, 0.3)' }}
                  id="btn-cancel-camera"
                >
                  <X size={16} />
                  Cancel Camera
                </button>
              </div>
            </div>
          ) : (
            /* Standby Mode with Separate, Distinct Action Buttons */
            <div>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(245, 158, 11, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <Camera size={32} color="var(--accent-gold)" />
              </div>

              <h4 style={{ marginBottom: '0.35rem' }}>Gate Camera & Tesseract.js OCR Engine</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '540px', margin: '0 auto 1.25rem' }}>
                Capture live plate video from your camera, upload an existing photo, or generate a test plate. The on-device OCR engine will extract and match the license plate automatically.
              </p>

              {capturedImagePreview && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    Current Plate Source Preview:
                  </span>
                  <img
                    src={capturedImagePreview}
                    alt="Captured Plate"
                    style={{ maxHeight: '140px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-medium)', objectFit: 'contain' }}
                  />
                </div>
              )}

              {/* Capture Controls */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {/* Button 1: Take Live Photo */}
                <button
                  type="button"
                  onClick={() => startLiveCamera()}
                  className="btn btn-primary"
                  disabled={isCameraStarting}
                  id="btn-take-live-photo"
                >
                  <Camera size={16} />
                  {isCameraStarting ? 'Opening Camera...' : 'Take Live Photo'}
                </button>

                {/* Button 3: Test Sample Plate */}
                <button
                  type="button"
                  onClick={handleSimulateSampleScan}
                  className="btn btn-secondary"
                  id="btn-test-sample-plate"
                  title="Generates a Nigerian plate and feeds it to Tesseract.js"
                >
                  <Sparkles size={16} />
                  Test Sample Plate
                </button>
              </div>
            </div>
          )}

          {/* OCR Candidate Result Pill & Raw Text */}
          {scanComplete && !isScanning && (
            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
              <div
                style={{
                  background: isPlateRecognized ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${isPlateRecognized ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '0.85rem 1.25rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '1.25rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: isPlateRecognized ? '#34D399' : '#FCD34D', fontWeight: 600 }}>
                    Extracted Candidate ({confidenceScore}% Confidence)
                  </span>
                  <div style={{ marginTop: '0.2rem' }}>
                    <span className="license-plate-tag">{candidatePlate}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: isPlateRecognized ? '#34D399' : '#FCD34D', fontSize: '0.82rem' }}>
                  {ocrMatchType === 'EXACT_FLEET' ? (
                    <>
                      <Check size={16} /> Verified Active Fleet (Exact Match)
                    </>
                  ) : ocrMatchType === 'FUZZY_FLEET' ? (
                    <>
                      <Check size={16} /> Fleet Matched via ANPR Disambiguation
                    </>
                  ) : ocrMatchType === 'SYNTACTIC_VALID' ? (
                    <>
                      <AlertCircle size={16} /> Unregistered Vehicle (BR-01 Exception)
                    </>
                  ) : isPlateRecognized ? (
                    <>
                      <Check size={16} /> Verified Active Fleet
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} /> Low Confidence Extraction (Review Required)
                    </>
                  )}
                </div>
              </div>

              {/* Preprocessing indicator and Raw OCR Text */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {preprocessedImageUrl && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-gold)', background: 'rgba(245, 158, 11, 0.1)', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                    ✓ Preprocessed (Grayscale + Dynamic Contrast Boost)
                  </span>
                )}
                {rawOcrText && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Raw OCR Output: <code className="mono" style={{ color: 'var(--accent-cyan)' }}>"{rawOcrText.replace(/\n/g, ' ').slice(0, 45)}"</code>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Verification Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            {/* Loading Site */}
            <div>
              <label className="input-label">
                <MapPin size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                Dredge Loading Terminal
              </label>
              <select
                className="select-control"
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
              >
                {loadingSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.site_code} — {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Truck Selector */}
            <div>
              <label className="input-label">
                <TruckIcon size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                Confirmed Vehicle Registration
              </label>
              <select
                className="select-control"
                value={selectedTruckId}
                onChange={(e) => {
                  setSelectedTruckId(e.target.value);
                  const trk = trucks.find((t) => t.id === e.target.value);
                  if (trk) setCandidatePlate(trk.registration_number);
                }}
              >
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.registration_number} ({t.capacity} {t.capacity_unit} — {t.owner_name})
                  </option>
                ))}
              </select>
            </div>

            {/* Driver Selector */}
            <div>
              <label className="input-label">
                <User size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                Assigned Haulage Driver
              </label>
              <select
                className="select-control"
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

            {/* Registered Capacity display */}
            <div>
              <label className="input-label">Declared Volume / Capacity</label>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: 'var(--accent-gold)',
                }}
              >
                {currentTruck?.capacity} {currentTruck?.capacity_unit} ({currentTruck?.truck_type})
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">Gate Officer Observations / Batch Notes</label>
            <input
              type="text"
              className="input-control"
              placeholder="e.g. Coarse sharp sand, tarpaulin tied, full bucket load confirmed"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Offline Warning Notice */}
          {!isOnline && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.85rem',
                color: '#FCD34D',
              }}
            >
              <AlertCircle size={18} />
              <span>
                Offline mode active. This trip will be assigned an idempotency key and cached in local draft storage until connectivity resumes.
              </span>
            </div>
          )}

          {/* Submit button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setNotes('');
                setScanComplete(false);
              }}
            >
              Reset Form
            </button>
            <button type="submit" className="btn btn-primary btn-lg">
              <CheckCircle size={18} />
              Confirm & Dispatch Trip (Open Waybill)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
