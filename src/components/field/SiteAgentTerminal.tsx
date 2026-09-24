import React, { useState, useRef, useEffect } from 'react';
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
  Check,
  Video,
  VideoOff,
  SwitchCamera,
  Zap,
  Layers,
  User,
  Users,
  UserPlus,
  CreditCard,
  Search,
  X,
  Phone,
  Building,
} from 'lucide-react';
import { QuantityUnit, ExceptionType } from '../../types';
import { recognizeLicensePlate, OCRProgress } from '../../services/ocrService';

const NIGERIAN_BANKS = [
  'Zenith Bank PLC',
  'Guaranty Trust Bank (GTBank)',
  'First Bank of Nigeria',
  'Access Bank PLC',
  'United Bank for Africa (UBA)',
  'Fidelity Bank PLC',
  'Stanbic IBTC Bank',
  'Union Bank of Nigeria',
  'Sterling Bank',
  'Wema Bank / ALAT',
  'Ecobank Nigeria',
  'First City Monument Bank (FCMB)',
  'Polaris Bank',
  'Kuda Microfinance Bank',
  'OPay Digital Services',
  'PalmPay',
  'Moniepoint MFB',
];

const TRUCK_TYPES = [
  'Mack 10-Wheeler Tipper',
  'Sino 35T Heavy Dump',
  'Mercedes Actros 28T',
  'HOWO Sinotruk 32T',
  'DAF CF Tipper 30T',
  'MAN TGS 33T Articulated',
  'Iveco Trakker 30T',
];

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
    addTruck,
    addDriver,
  } = useAppState();

  // Live hardware camera input ref
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const previewObjectUrlRef = useRef<string | null>(null);
  const capturePurposeRef = useRef<'general' | 'delivery'>('general');

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
  const [ocrStatus, setOcrStatus] = useState('Ready for capture');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrMatchType, setOcrMatchType] = useState<'EXACT_FLEET' | 'FUZZY_FLEET' | 'SYNTACTIC_VALID' | 'FALLBACK' | null>('EXACT_FLEET');
  const [preprocessedImageUrl, setPreprocessedImageUrl] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);

  // Live Camera State
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // 2. Driver Selection & Onboarding State (Multidriver & Unregistered Truck Support)
  const [isUnregisteredModalOpen, setIsUnregisteredModalOpen] = useState(false);
  const [isDriverPoolOpen, setIsDriverPoolOpen] = useState(false);
  const [isNewDriverFormOpen, setIsNewDriverFormOpen] = useState(false);
  const [driverSearchQuery, setDriverSearchQuery] = useState('');

  // Unregistered Vehicle & Driver Form State
  const [newTruckPlate, setNewTruckPlate] = useState('IKD-882ZX');
  const [newTruckType, setNewTruckType] = useState('Mack 10-Wheeler Tipper');
  const [newTruckCapacity, setNewTruckCapacity] = useState(30);
  const [newTruckOwner, setNewTruckOwner] = useState('Coastal Sands Logistics Ltd');
  const [newTruckOwnerPhone, setNewTruckOwnerPhone] = useState('+234 803 551 0921');
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverBankName, setNewDriverBankName] = useState('Zenith Bank PLC');
  const [newDriverAccountNumber, setNewDriverAccountNumber] = useState('');
  const [newDriverLicense, setNewDriverLicense] = useState('');

  // Quick New Driver for Existing Truck Form State
  const [quickDriverName, setQuickDriverName] = useState('');
  const [quickDriverPhone, setQuickDriverPhone] = useState('');
  const [quickDriverBankName, setQuickDriverBankName] = useState('Zenith Bank PLC');
  const [quickDriverAccountNumber, setQuickDriverAccountNumber] = useState('');
  const [quickDriverLicense, setQuickDriverLicense] = useState('');

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  // getUserMedia resolves before the conditional <video> is mounted. Attach the
  // stream after React has rendered it; otherwise the first launch stays blank
  // and only starts after a camera flip causes another request.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!isLiveCameraActive || !video || !stream) return;

    video.srcObject = stream;
    video.play().catch((err) => {
      console.warn('Camera preview playback failed:', err);
      setCameraError('The camera opened but the preview could not start. Tap Retake Camera to try again.');
    });
  }, [isLiveCameraActive]);

  // 3. Movement Type State: 'pickup' vs 'delivery'
  const [movementType, setMovementType] = useState<'pickup' | 'delivery'>('pickup');

  // 4. Pickup Specific Form State
  const [destinationSiteId, setDestinationSiteId] = useState('site-lkk-01');
  const [estimatedTonnes, setEstimatedTonnes] = useState(30);
  const [pickupNotes, setPickupNotes] = useState('');

  // 5. Delivery Specific Form State
  const [scaleTicketNumber, setScaleTicketNumber] = useState('WT-2026-9041');
  const [deliveredTonnes, setDeliveredTonnes] = useState(29.8);
  const [ticketPhotoUrl, setTicketPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80'
  );
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [deliveryPlateEvidence, setDeliveryPlateEvidence] = useState<{
    plate: string;
    imageUrl: string;
    confidence: number;
    capturedAt: string;
  } | null>(null);
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
  ) || null;

  const normalizePlate = (plate: string) => plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const expectedDeliveryPlate = matchingOpenTrip?.truck?.registration_number || '';
  const deliveryPlateMatchesTrip = !!deliveryPlateEvidence && !!matchingOpenTrip &&
    normalizePlate(deliveryPlateEvidence.plate) === normalizePlate(expectedDeliveryPlate);

  // Live Camera Controls
  const startLiveCamera = async (mode: 'environment' | 'user' = cameraFacingMode) => {
    const requestId = ++cameraRequestIdRef.current;
    setIsCameraStarting(true);
    setIsCameraReady(false);
    setCameraError(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires a supported browser over HTTPS.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraFacingMode(mode);
      setIsLiveCameraActive(true);
      // On camera flips the video is already mounted, so replace its stream now.
      // First launch is handled by the effect after the conditional video mounts.
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch((playError) => {
          console.warn('Camera preview playback failed after switching:', playError);
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setCameraError(
        /NotAllowed|Permission/i.test(message)
          ? 'Camera permission is blocked. Allow camera access in the browser, then tap Retake Camera.'
          : `Camera could not start: ${message}`
      );
      setIsLiveCameraActive(false);
    } finally {
      setIsCameraStarting(false);
    }
  };

  const stopLiveCamera = () => {
    cameraRequestIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
    setIsLiveCameraActive(false);
  };

  const toggleCameraFacingMode = () => {
    const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextMode);
    if (isLiveCameraActive) {
      startLiveCamera(nextMode);
    }
  };

  const snapPhotoFromLiveFeed = () => {
    if (!videoRef.current || !isCameraReady) {
      setCameraError('Camera is still starting. Wait for the live preview, then capture again.');
      return;
    }
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    stopLiveCamera();
    runPlateOCR(dataUrl);
  };

  const retakePlatePhoto = () => {
    capturePurposeRef.current = movementType === 'delivery' ? 'delivery' : 'general';
    stopLiveCamera();
    setHasScanned(false);
    setIsScanning(false);
    setOcrProgress(0);
    setOcrStatus('Ready for capture');
    setOcrMatchType(null);
    setPreprocessedImageUrl(null);
    setCameraError(null);
    setIsUnregisteredModalOpen(false);
    void startLiveCamera(cameraFacingMode);
  };

  const captureDeliveryPlate = () => {
    capturePurposeRef.current = 'delivery';
    setDeliveryPlateEvidence(null);
    stopLiveCamera();
    setHasScanned(false);
    setCameraError(null);
    void startLiveCamera('environment');
  };

  // Realistic Nigerian plate canvas generator for instant local testing
  const createPlateCanvas = (plateNumber: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 440;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    // Commercial yellow
    ctx.fillStyle = '#FED766';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Dark border
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    // Top banner
    ctx.fillStyle = '#065F46';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FEDERAL REPUBLIC OF NIGERIA', canvas.width / 2, 28);
    // Plate number
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(plateNumber, canvas.width / 2, 90);
    // Bottom LGA
    ctx.fillStyle = '#B45309';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('LAGOS STATE • COMMERCIAL HAULAGE', canvas.width / 2, 130);
    return canvas.toDataURL('image/jpeg', 0.95);
  };

  // Real Tesseract OCR recognition pipeline
  const runPlateOCR = async (imageSource: File | Blob | string) => {
    setHasScanned(true);
    setIsScanning(true);
    setOcrProgress(0.05);
    setOcrStatus('Initializing ANPR neural engine...');

    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    const previewUrl = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
    if (typeof imageSource !== 'string') previewObjectUrlRef.current = previewUrl;
    setPhotoUrl(previewUrl);

    try {
      const result = await recognizeLicensePlate(imageSource, trucks, (p: OCRProgress) => {
        setOcrStatus(p.status);
        setOcrProgress(p.progress);
      });

      setCandidatePlate(result.candidatePlate);
      setConfirmedPlate(result.candidatePlate);
      setConfidenceScore(result.confidence);
      setOcrMatchType(result.matchType);
      if (result.preprocessedImageUrl) {
        setPreprocessedImageUrl(result.preprocessedImageUrl);
      }

      if (capturePurposeRef.current === 'delivery' || movementType === 'delivery') {
        setDeliveryPlateEvidence({
          plate: result.candidatePlate,
          imageUrl: previewUrl,
          confidence: result.confidence,
          capturedAt: new Date().toISOString(),
        });
      }
      capturePurposeRef.current = 'general';

      const normalized = result.candidatePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const matched = result.matchedTruck || trucks.find((t) => t.normalized_registration === normalized);

      if (matched) {
        setSelectedTruckId(matched.id);
        const tonnage = matched.capacity_tonnes || matched.capacity || 30;
        setEstimatedTonnes(tonnage);
        setDeliveredTonnes(tonnage);
        const driver = drivers.find((d) => d.assigned_truck_id === matched.id) || drivers[0];
        if (driver) setSelectedDriverId(driver.id);
        setIsUnregisteredModalOpen(false);
      } else {
        // UNREGISTERED PLATE DETECTED: prompt to register truck & driver
        setSelectedTruckId('');
        setSelectedDriverId('');
        setNewTruckPlate(result.candidatePlate);
        setIsUnregisteredModalOpen(true);
      }

      setToastMessage({
        text: `Plate [${result.candidatePlate}] recognized! Match type: ${result.matchType} (${result.confidence}% confidence).`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 5000);
    } catch (err: any) {
      console.warn('OCR error:', err);
      setToastMessage({
        text: 'OCR character recognition encountered noise. Plate candidate extracted from syntax heuristics.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setIsScanning(false);
      setOcrProgress(1);
    }
  };

  // Camera capture handler (invoked when mobile device camera snaps a photo)
  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    runPlateOCR(file);
    e.target.value = '';
  };

  // Simulation handler when scanning different trucks (for testing)
  const handleScanPreset = (plate: string, truckId: string, driverId: string, isUnregistered = false) => {
    const dataUrl = createPlateCanvas(plate);
    if (!isUnregistered) {
      setSelectedTruckId(truckId);
      setSelectedDriverId(driverId);
      setIsUnregisteredModalOpen(false);
    } else {
      setSelectedTruckId('');
      setSelectedDriverId('');
      setNewTruckPlate(plate);
    }
    runPlateOCR(dataUrl);
  };

  const handleManualPlateEdit = (newPlate: string) => {
    setConfirmedPlate(newPlate);
    const normalized = newPlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const matchedTruck = trucks.find((t) => t.normalized_registration === normalized);
    if (matchedTruck) {
      setSelectedTruckId(matchedTruck.id);
      setEstimatedTonnes(matchedTruck.capacity_tonnes || matchedTruck.capacity || 30);
      setDeliveredTonnes(matchedTruck.capacity_tonnes || matchedTruck.capacity || 30);
      const matchedDriver = drivers.find((d) => d.assigned_truck_id === matchedTruck.id) || drivers[0];
      if (matchedDriver) setSelectedDriverId(matchedDriver.id);
      setIsUnregisteredModalOpen(false);
    } else {
      setSelectedTruckId('');
      setSelectedDriverId('');
      setNewTruckPlate(newPlate);
    }
  };

  // Register Unregistered Truck and its Driver
  const handleOnboardNewTruckAndDriver = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPlate = (newTruckPlate || confirmedPlate).trim().toUpperCase();
    if (!cleanPlate) {
      setToastMessage({ text: 'Please enter a valid truck plate number.', type: 'warning' });
      return;
    }
    if (!newDriverName.trim()) {
      setToastMessage({ text: 'Please enter driver full name.', type: 'warning' });
      return;
    }
    if (!newDriverPhone.trim()) {
      setToastMessage({ text: 'Please enter driver contact phone number.', type: 'warning' });
      return;
    }
    if (!newDriverAccountNumber.trim() || newDriverAccountNumber.trim().length < 10) {
      setToastMessage({ text: 'Please enter a valid 10-digit NUBAN bank account number.', type: 'warning' });
      return;
    }

    // 1. Add Truck
    const truckRes = addTruck({
      registration_number: cleanPlate,
      capacity: Number(newTruckCapacity) || 30,
      capacity_unit: 'tonnes',
      truck_type: newTruckType || 'Mack 10-Wheeler Tipper',
      owner_name: newTruckOwner.trim() || 'Independent Haulier Fleet',
      owner_phone: newTruckOwnerPhone.trim() || '+234 800 000 0000',
    });

    if (!truckRes.success || !truckRes.truck) {
      setToastMessage({ text: truckRes.error || 'Failed to register truck.', type: 'warning' });
      return;
    }

    // 2. Add Driver
    const driverRes = addDriver({
      full_name: newDriverName.trim(),
      phone: newDriverPhone.trim(),
      license_number: newDriverLicense.trim() || `FRSC-LAG-${Math.floor(10000 + Math.random() * 90000)}`,
      bank_name: newDriverBankName,
      account_number: newDriverAccountNumber.trim(),
      account_number_last4: newDriverAccountNumber.trim().slice(-4),
      assigned_truck_id: truckRes.truck.id,
    });

    if (!driverRes.success || !driverRes.driver) {
      setToastMessage({ text: driverRes.error || 'Failed to register driver.', type: 'warning' });
      return;
    }

    // 3. Set Active Selected
    setSelectedTruckId(truckRes.truck.id);
    setSelectedDriverId(driverRes.driver.id);
    setConfirmedPlate(cleanPlate);
    setCandidatePlate(cleanPlate);
    setEstimatedTonnes(Number(newTruckCapacity) || 30);
    setDeliveredTonnes(Number(newTruckCapacity) || 30);
    setIsUnregisteredModalOpen(false);

    // Reset fields
    setNewDriverName('');
    setNewDriverPhone('');
    setNewDriverAccountNumber('');

    setToastMessage({
      text: `Vehicle [${cleanPlate}] and Driver [${driverRes.driver.full_name}] registered & ready for dispatch!`,
      type: 'success',
    });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // Register New Driver for Existing Registered Truck
  const handleRegisterDriverForExistingTruck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDriverName.trim()) {
      setToastMessage({ text: 'Please enter driver full name.', type: 'warning' });
      return;
    }
    if (!quickDriverPhone.trim()) {
      setToastMessage({ text: 'Please enter driver contact phone number.', type: 'warning' });
      return;
    }
    if (!quickDriverAccountNumber.trim() || quickDriverAccountNumber.trim().length < 10) {
      setToastMessage({ text: 'Please enter a valid 10-digit NUBAN bank account number.', type: 'warning' });
      return;
    }

    const driverRes = addDriver({
      full_name: quickDriverName.trim(),
      phone: quickDriverPhone.trim(),
      license_number: quickDriverLicense.trim() || `FRSC-LAG-${Math.floor(10000 + Math.random() * 90000)}`,
      bank_name: quickDriverBankName,
      account_number: quickDriverAccountNumber.trim(),
      account_number_last4: quickDriverAccountNumber.trim().slice(-4),
      assigned_truck_id: selectedTruckId,
    });

    if (driverRes.success && driverRes.driver) {
      setSelectedDriverId(driverRes.driver.id);
      setIsNewDriverFormOpen(false);
      setQuickDriverName('');
      setQuickDriverPhone('');
      setQuickDriverAccountNumber('');
      setToastMessage({
        text: `New driver [${driverRes.driver.full_name}] registered & assigned to truck [${confirmedPlate}]!`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 5000);
    } else {
      setToastMessage({
        text: driverRes.error || 'Failed to register driver.',
        type: 'warning',
      });
    }
  };

  // Switch Driver from Pool
  const handleSelectDriverFromPool = (driverId: string) => {
    setSelectedDriverId(driverId);
    setIsDriverPoolOpen(false);
    const d = drivers.find((drv) => drv.id === driverId);
    setToastMessage({
      text: `Driver switched to [${d?.full_name || 'Selected Driver'}] for truck [${confirmedPlate}].`,
      type: 'success',
    });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Submit Pickup (Loading Gate Dispatch)
  const handleDispatchPickup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTruckId || !selectedDriverId) {
      setToastMessage({
        text: 'Vehicle and Driver must be registered before issuing a waybill. Please complete registration.',
        type: 'warning',
      });
      setIsUnregisteredModalOpen(true);
      return;
    }

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
    if (!deliveryPlateEvidence) {
      setToastMessage({
        text: 'Snap and verify the arriving truck plate before confirming delivery.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }
    if (!matchingOpenTrip) {
      setToastMessage({
        text: 'No active inbound trip found for this truck to close.',
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }
    if (!deliveryPlateMatchesTrip) {
      setToastMessage({
        text: `Delivery plate ${deliveryPlateEvidence.plate} does not match waybill truck ${expectedDeliveryPlate}. Flag the discrepancy instead of closing the trip.`,
        type: 'warning',
      });
      setTimeout(() => setToastMessage(null), 5500);
      return;
    }

    const result = closeOffloadingTrip(matchingOpenTrip.id, {
      quantity: deliveredTonnes,
      unit: 'tonnes' as QuantityUnit,
      scaleTicketNumber,
      scaleTicketUrl: ticketPhotoUrl,
      deliveryPlateImageUrl: deliveryPlateEvidence.imageUrl,
      deliveryConfirmedPlate: deliveryPlateEvidence.plate,
      deliveryPlateConfidence: deliveryPlateEvidence.confidence,
      deliveryPlateCapturedAt: deliveryPlateEvidence.capturedAt,
      notes: deliveryNotes,
    });

    if (result.success) {
      setToastMessage({
        text: `Trip ${matchingOpenTrip.trip_number} successfully verified and closed!`,
        type: result.varianceAlert ? 'warning' : 'success',
      });
      setDeliveryNotes('');
      setDeliveryPlateEvidence(null);
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

      {/* Hidden Hardware Camera Input (forces live environment camera on mobile) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraCapture}
        aria-label="Capture Truck Photo via Camera"
      />

      {/* TOP SCAN LAUNCHER CARD */}
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
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '640px' }}>
          {/* Live Video Camera Stream Launcher */}
          {!isLiveCameraActive ? (
            <button
              type="button"
              onClick={() => startLiveCamera()}
              disabled={isCameraStarting}
              style={{
                flex: 1,
                minWidth: '220px',
                minHeight: '56px',
                padding: '0.75rem 1.25rem',
                backgroundColor: '#B45309',
                color: '#FFFFFF',
                borderRadius: 'var(--radius-lg)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 800,
                boxShadow: '0 4px 14px rgba(180, 83, 9, 0.35)',
                transition: 'all 0.15s ease',
              }}
            >
              <Video size={20} />
              <span>{isCameraStarting ? 'Starting Camera...' : 'Launch Live Camera Stream'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopLiveCamera}
              style={{
                flex: 1,
                minWidth: '220px',
                minHeight: '56px',
                padding: '0.75rem 1.25rem',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                borderRadius: 'var(--radius-lg)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 800,
              }}
            >
              <VideoOff size={20} />
              <span>Close Live Camera</span>
            </button>
          )}

          {/* Native Live Camera Trigger (Direct Hardware Capture) */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            style={{
              flex: 1,
              minWidth: '200px',
              minHeight: '56px',
              padding: '0.75rem 1.25rem',
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
              borderRadius: 'var(--radius-lg)',
              border: '1.5px solid var(--border-medium)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.65rem',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: 700,
              boxShadow: 'var(--shadow-xs)',
            }}
            title="Open device camera to snap live plate photo"
          >
            <Camera size={19} color="#B45309" />
            <span>Snap with Device Camera</span>
          </button>

          {hasScanned && (
            <button
              type="button"
              onClick={retakePlatePhoto}
              disabled={isScanning || isCameraStarting}
              className="btn btn-secondary"
              style={{ minHeight: '56px', padding: '0.75rem 1rem', fontWeight: 700 }}
              title="Clear this scan and take another live plate photo"
            >
              <RotateCcw size={17} />
              <span>{isCameraStarting ? 'Restarting Camera...' : 'Retake Live Photo'}</span>
            </button>
          )}
        </div>

        {/* Anti-Fraud Security Guarantee Banner */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.35rem 0.85rem',
            backgroundColor: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 'var(--radius-full)',
            color: '#92400E',
            fontSize: '0.74rem',
            fontWeight: 700,
          }}
        >
          <ShieldCheck size={14} color="#B45309" />
          <span>Anti-Fraud Lock: Live Camera Capture Only • Pre-existing File Uploads Disabled</span>
        </div>

        {cameraError && (
          <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: 0 }}>
            {cameraError}
          </p>
        )}

        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, maxWidth: '580px', lineHeight: 1.4 }}>
          {hasScanned ? (
            <>
              Plate <strong style={{ color: '#0F172A' }}>{confirmedPlate}</strong> verified live ({confidenceScore}% confidence). Select <strong>Pickup (Gate 1 Dispatch)</strong> or <strong>Delivery (Gate 2 Weighbridge)</strong> below.
            </>
          ) : (
            <>
              Live video or direct hardware camera snapshot is required at the gate. Pre-saved photo uploads are prohibited to prevent fraud and ensure audit integrity.
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
              1. Real-Time ANPR Plate Recognition
            </h3>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Sparkles size={13} />
              {isScanning ? 'OCR Processing...' : hasScanned ? 'ANPR Verified' : 'Engine Ready'}
            </span>
          </div>

          {/* Live Camera Viewfinder or Static Snapshot Viewfinder */}
          {isLiveCameraActive ? (
            <div className="camera-viewfinder-box">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video-feed"
                onLoadedMetadata={() => setIsCameraReady(true)}
              />
              <div className="camera-reticle-overlay">
                <div className="camera-scanline-laser" />
                <span className="camera-reticle-label">ALIGN NIGERIAN PLATE</span>
              </div>
              <div className="camera-live-pill">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                LIVE STREAM
              </div>

              {/* Live Controls Overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  left: '12px',
                  right: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  zIndex: 10,
                }}
              >
                <button
                  type="button"
                  onClick={toggleCameraFacingMode}
                  className="btn btn-secondary"
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.85)',
                    color: '#FFFFFF',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    fontSize: '0.75rem',
                    padding: '0.35rem 0.65rem',
                  }}
                >
                  <SwitchCamera size={14} /> Flip ({cameraFacingMode})
                </button>

                <button
                  type="button"
                  onClick={snapPhotoFromLiveFeed}
                  disabled={!isCameraReady}
                  style={{
                    backgroundColor: isCameraReady ? '#F59E0B' : '#94A3B8',
                    color: '#0F172A',
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    padding: '0.5rem 1.25rem',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: isCameraReady ? 'pointer' : 'wait',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
                  }}
                >
                  <Zap size={16} /> {isCameraReady ? 'Snap & Analyze Plate' : 'Starting Preview...'}
                </button>
              </div>
            </div>
          ) : (
            <div className="viewfinder" style={{ position: 'relative', overflow: 'hidden' }}>
              <img
                src={photoUrl}
                alt="Truck Plate Scan"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: isScanning ? 'blur(3px)' : !hasScanned ? 'brightness(0.65)' : 'none',
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
                    Launch live camera above or test plate below
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
                  color: '#FFFFFF',
                }}
              >
                <span>{isScanning ? ocrStatus : hasScanned ? 'HD Snapshot Recorded' : 'Ready for plate analysis'}</span>
                <span style={{ color: '#38BDF8', fontWeight: 700 }}>
                  {hasScanned ? `${confidenceScore}% Confidence` : 'Standby'}
                </span>
              </div>
            </div>
          )}

          {/* OCR Progress Bar Indicator */}
          {isScanning && (
            <div
              style={{
                backgroundColor: '#FEF3C7',
                border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: '#B45309' }}>
                <span>{ocrStatus}</span>
                <span>{Math.round(ocrProgress * 100)}%</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: 'rgba(180, 83, 9, 0.15)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(ocrProgress * 100)}%`,
                    height: '100%',
                    backgroundColor: '#B45309',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Match Verification & Recognition Pills */}
          {hasScanned && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {ocrMatchType === 'EXACT_FLEET' && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      backgroundColor: '#D1FAE5',
                      color: '#065F46',
                      border: '1px solid #6EE7B7',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <CheckCircle2 size={12} /> MASTER FLEET MATCH (BR-01)
                  </span>
                )}
                {ocrMatchType === 'FUZZY_FLEET' && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      backgroundColor: '#FEF3C7',
                      color: '#B45309',
                      border: '1px solid #FCD34D',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    FUZZY FLEET MATCH (LEVENSHTEIN)
                  </span>
                )}
                {ocrMatchType === 'SYNTACTIC_VALID' && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      backgroundColor: '#FEE2E2',
                      color: '#991B1B',
                      border: '1px solid #FCA5A5',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    UNREGISTERED NIGERIAN VEHICLE (EXCEPTION BR-01)
                  </span>
                )}
              </div>

              {preprocessedImageUrl && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                  title="Image preprocessed with pixel contrast curve boost"
                >
                  <Layers size={12} /> Contrast Preprocessed (75%)
                </span>
              )}
            </div>
          )}

          {/* Nigerian Test Plates (Canvas Rendered Real Tesseract OCR Verification) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Instant ANPR OCR Plate Verification:
              </label>
              <span style={{ fontSize: '0.68rem', color: '#0284C7', fontWeight: 600 }}>
                Executes Real Tesseract
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '0.45rem',
              }}
            >
              {[
                {
                  plate: 'KJA-482XY',
                  truckId: 'trk-1',
                  driverId: 'drv-1',
                  label: 'Mack Granite (30T)',
                  isUnregistered: false,
                },
                {
                  plate: 'APP-914AA',
                  truckId: 'trk-2',
                  driverId: 'drv-2',
                  label: 'Sino Dump (35T)',
                  isUnregistered: false,
                },
                {
                  plate: 'EPE-303ZZ',
                  truckId: 'trk-3',
                  driverId: 'drv-3',
                  label: 'Actros (28T)',
                  isUnregistered: false,
                },
                {
                  plate: 'BDG-708BB',
                  truckId: 'trk-4',
                  driverId: 'drv-4',
                  label: 'HOWO (32T)',
                  isUnregistered: false,
                },
                {
                  plate: 'IKD-882ZX',
                  truckId: '',
                  driverId: '',
                  label: 'Unregistered Truck',
                  isUnregistered: true,
                },
              ].map((p) => (
                <button
                  key={p.plate}
                  type="button"
                  onClick={() => handleScanPreset(p.plate, p.truckId, p.driverId, p.isUnregistered)}
                  disabled={isScanning}
                  style={{
                    padding: '0.45rem 0.55rem',
                    borderRadius: 'var(--radius-md)',
                    border: confirmedPlate === p.plate
                      ? '2px solid #B45309'
                      : p.isUnregistered
                      ? '1.5px dashed #EF4444'
                      : '1px solid var(--border-subtle)',
                    backgroundColor: confirmedPlate === p.plate
                      ? '#FEF3C7'
                      : p.isUnregistered
                      ? '#FEF2F2'
                      : '#FFFFFF',
                    cursor: isScanning ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <strong style={{ fontSize: '0.78rem', color: confirmedPlate === p.plate ? '#B45309' : p.isUnregistered ? '#DC2626' : '#0F172A' }}>
                      {p.plate}
                    </strong>
                    {p.isUnregistered && (
                      <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#DC2626', backgroundColor: '#FEE2E2', padding: '0.05rem 0.25rem', borderRadius: '3px' }}>
                        NEW
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.65rem', color: p.isUnregistered ? '#B91C1C' : 'var(--text-muted)' }}>
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

          {/* Vehicle Master Context & Driver Assignment Control */}
          {!currentTruck ? (
            /* CASE 1: UNREGISTERED TRUCK DETECTED */
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#FEF2F2',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid #FCA5A5',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#FEE2E2',
                    color: '#DC2626',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <AlertTriangle size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 800, color: '#991B1B', margin: 0 }}>
                      Unregistered Vehicle Detected
                    </h4>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        backgroundColor: '#DC2626',
                        color: '#FFFFFF',
                        padding: '0.15rem 0.4rem',
                        borderRadius: 'var(--radius-sm)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      EXCEPTION BR-01
                    </span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#B91C1C', marginTop: '0.25rem', marginBottom: 0, lineHeight: 1.4 }}>
                    Plate <strong>{confirmedPlate}</strong> has not been registered in the fleet database. Driver bank account & vehicle specifications must be registered before digital waybill issuance.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setNewTruckPlate(confirmedPlate);
                  setIsUnregisteredModalOpen(true);
                }}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.9rem',
                  fontSize: '0.8125rem',
                  backgroundColor: '#DC2626',
                  borderColor: '#B91C1C',
                  gap: '0.5rem',
                }}
              >
                <UserPlus size={16} />
                <span>+ Register Truck & Driver Now</span>
              </button>
            </div>
          ) : (
            /* CASE 2: REGISTERED TRUCK - MULTI-DRIVER MANAGEMENT */
            <div
              style={{
                backgroundColor: '#F8FAFC',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: '0',
              }}
            >
              {/* Truck Specs Strip */}
              <div
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#F1F5F9',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>
                    REGISTERED TRUCK
                  </span>
                  <strong style={{ color: '#0F172A', fontSize: '0.8125rem' }}>
                    {currentTruck.truck_type || 'Tipper'} ({currentTruck.capacity_tonnes || 30}T)
                  </strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.25rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>
                    <Building size={11} /> HAULIER / OWNER
                  </span>
                  <strong style={{ color: '#0F172A', fontSize: '0.8125rem' }}>
                    {currentTruck.owner_name}
                  </strong>
                </div>
              </div>

              {/* Active Driver Card */}
              <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      ASSIGNED DRIVER FOR THIS TRIP
                    </span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        backgroundColor: '#E0F2FE',
                        color: '#0369A1',
                        padding: '0.1rem 0.35rem',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      Multi-Driver
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <CheckCircle2 size={12} /> Verified
                  </span>
                </div>

                <div
                  style={{
                    padding: '0.65rem 0.8rem',
                    backgroundColor: '#FFFFFF',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '50%',
                        backgroundColor: '#FEF3C7',
                        color: '#B45309',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                      }}
                    >
                      <User size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.875rem', color: '#0F172A' }}>
                        {currentDriver?.full_name || 'No Driver Selected'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.1rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Phone size={11} /> {currentDriver?.phone || 'No phone'}
                        </span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <CreditCard size={11} /> {currentDriver?.bank_name ? `${currentDriver.bank_name} (${currentDriver.account_number || ('•••• ' + (currentDriver?.account_number_last4 || '****'))})` : 'NUBAN on file'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Driver Switch / Register Toggle Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDriverPoolOpen(!isDriverPoolOpen);
                      setIsNewDriverFormOpen(false);
                    }}
                    style={{
                      padding: '0.45rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      border: isDriverPoolOpen ? '1.5px solid #0284C7' : '1px solid var(--border-default)',
                      backgroundColor: isDriverPoolOpen ? '#F0F9FF' : '#FFFFFF',
                      color: isDriverPoolOpen ? '#0284C7' : 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Users size={14} />
                    <span>Pick from Driver Pool</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsNewDriverFormOpen(!isNewDriverFormOpen);
                      setIsDriverPoolOpen(false);
                    }}
                    style={{
                      padding: '0.45rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      border: isNewDriverFormOpen ? '1.5px solid #047857' : '1px solid var(--border-default)',
                      backgroundColor: isNewDriverFormOpen ? '#ECFDF5' : '#FFFFFF',
                      color: isNewDriverFormOpen ? '#047857' : 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <UserPlus size={14} />
                    <span>+ Register New Driver</span>
                  </button>
                </div>

                {/* EXPANDABLE SECTION 1: PICK FROM DRIVER POOL */}
                {isDriverPoolOpen && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #BAE6FD',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369A1' }}>
                        Pool of Registered Drivers ({drivers.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDriverPoolOpen(false)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem' }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                      <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        placeholder="Search pool by driver name or phone..."
                        value={driverSearchQuery}
                        onChange={(e) => setDriverSearchQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.35rem 0.5rem 0.35rem 1.7rem',
                          fontSize: '0.75rem',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-default)',
                        }}
                      />
                    </div>

                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {drivers
                        .filter(
                          (d) =>
                            d.full_name.toLowerCase().includes(driverSearchQuery.toLowerCase()) ||
                            d.phone.includes(driverSearchQuery) ||
                            (d.bank_name && d.bank_name.toLowerCase().includes(driverSearchQuery.toLowerCase()))
                        )
                        .map((drv) => {
                          const isSelected = drv.id === selectedDriverId;
                          return (
                            <div
                              key={drv.id}
                              onClick={() => handleSelectDriverFromPool(drv.id)}
                              style={{
                                padding: '0.45rem 0.6rem',
                                borderRadius: 'var(--radius-sm)',
                                border: isSelected ? '1.5px solid #0284C7' : '1px solid var(--border-subtle)',
                                backgroundColor: isSelected ? '#F0F9FF' : '#F8FAFC',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                transition: 'all 0.1s ease',
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  {drv.full_name}
                                  {isSelected && (
                                    <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#0284C7', backgroundColor: '#E0F2FE', padding: '0.05rem 0.3rem', borderRadius: '4px' }}>
                                      SELECTED
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                  {drv.phone} • {drv.bank_name || 'Zenith Bank'} ({drv.account_number || ('•••• ' + (drv.account_number_last4 || '0000'))})
                                </div>
                              </div>
                              <button
                                type="button"
                                style={{
                                  padding: '0.2rem 0.5rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  borderRadius: 'var(--radius-sm)',
                                  border: 'none',
                                  backgroundColor: isSelected ? '#0284C7' : '#E2E8F0',
                                  color: isSelected ? '#FFFFFF' : '#334155',
                                  cursor: 'pointer',
                                }}
                              >
                                {isSelected ? 'Active' : 'Assign'}
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* EXPANDABLE SECTION 2: REGISTER NEW DRIVER FOR THIS TRUCK */}
                {isNewDriverFormOpen && (
                  <form
                    onSubmit={handleRegisterDriverForExistingTruck}
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #A7F3D0',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#047857', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <UserPlus size={14} /> Register & Assign New Driver to {confirmedPlate}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsNewDriverFormOpen(false)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem' }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid-2" style={{ gap: '0.5rem' }}>
                      <div>
                        <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          Driver Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Babatunde Lawal"
                          value={quickDriverName}
                          onChange={(e) => setQuickDriverName(e.target.value)}
                          style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          Phone Number *
                        </label>
                        <input
                          type="tel"
                          required
                          placeholder="e.g. +234 802 345 6789"
                          value={quickDriverPhone}
                          onChange={(e) => setQuickDriverPhone(e.target.value)}
                          style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}
                        />
                      </div>
                    </div>

                    <div className="grid-2" style={{ gap: '0.5rem' }}>
                      <div>
                        <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          Settlement Bank *
                        </label>
                        <select
                          value={quickDriverBankName}
                          onChange={(e) => setQuickDriverBankName(e.target.value)}
                          style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}
                        >
                          {NIGERIAN_BANKS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          10-Digit NUBAN Account # *
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={10}
                          placeholder="e.g. 0123456789"
                          value={quickDriverAccountNumber}
                          onChange={(e) => setQuickDriverAccountNumber(e.target.value.replace(/\D/g, ''))}
                          style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontFamily: 'var(--font-mono)' }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                        FRSC Driver License (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. FRSC-LAG-90821"
                        value={quickDriverLicense}
                        onChange={(e) => setQuickDriverLicense(e.target.value)}
                        style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontFamily: 'var(--font-mono)' }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <button
                        type="button"
                        onClick={() => setIsNewDriverFormOpen(false)}
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', backgroundColor: '#047857', borderColor: '#065F46' }}
                      >
                        <Check size={13} />
                        <span>Save & Assign</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
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
              onClick={() => {
                setMovementType('delivery');
                setDeliveryPlateEvidence(null);
                capturePurposeRef.current = 'delivery';
              }}
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
              {(!selectedTruckId || !selectedDriverId) && (
                <div
                  style={{
                    padding: '0.6rem 0.8rem',
                    backgroundColor: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.75rem',
                    color: '#991B1B',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Registration Required:</strong> Please register the truck and assign a driver before issuing digital waybill.
                  </span>
                </div>
              )}
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={!selectedTruckId || !selectedDriverId}
                style={{
                  width: '100%',
                  marginTop: '0.25rem',
                  backgroundColor: (!selectedTruckId || !selectedDriverId) ? '#94A3B8' : '#B45309',
                  borderColor: (!selectedTruckId || !selectedDriverId) ? '#94A3B8' : '#92400E',
                  cursor: (!selectedTruckId || !selectedDriverId) ? 'not-allowed' : 'pointer',
                  boxShadow: (!selectedTruckId || !selectedDriverId) ? 'none' : '0 2px 4px 0 rgba(180, 83, 9, 0.25)',
                }}
              >
                <TruckIcon size={18} />
                <span>
                  {(!selectedTruckId || !selectedDriverId)
                    ? 'Registration Required to Issue Waybill'
                    : 'Save as Pickup & Issue Digital Waybill'}
                </span>
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

              {/* Mandatory fresh delivery-gate plate evidence */}
              <div
                style={{
                  padding: '0.9rem 1rem',
                  backgroundColor: deliveryPlateMatchesTrip ? '#F0FDF4' : '#FFF7ED',
                  border: `1.5px solid ${deliveryPlateMatchesTrip ? '#86EFAC' : '#FDBA74'}`,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.85rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                  {deliveryPlateEvidence?.imageUrl ? (
                    <img
                      src={deliveryPlateEvidence.imageUrl}
                      alt="Delivery gate plate evidence"
                      style={{ width: '72px', height: '52px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-default)' }}
                    />
                  ) : (
                    <div style={{ width: '72px', height: '52px', borderRadius: '6px', backgroundColor: '#FFEDD5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Camera size={22} color="#C2410C" />
                    </div>
                  )}
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.82rem', color: deliveryPlateMatchesTrip ? '#166534' : '#9A3412' }}>
                      {deliveryPlateMatchesTrip
                        ? `Delivery plate verified: ${deliveryPlateEvidence?.plate}`
                        : deliveryPlateEvidence
                        ? `Review plate: ${deliveryPlateEvidence.plate}`
                        : 'Delivery plate photo required'}
                    </strong>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                      {deliveryPlateEvidence
                        ? `${deliveryPlateEvidence.confidence}% confidence • Must match the active waybill truck`
                        : 'Take a fresh photo of the arriving truck before completing the weighbridge fields.'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={deliveryPlateMatchesTrip ? 'btn btn-secondary' : 'btn btn-primary'}
                  onClick={captureDeliveryPlate}
                  disabled={isScanning || isCameraStarting}
                  style={{ minHeight: '42px' }}
                >
                  <Camera size={16} />
                  {deliveryPlateEvidence ? 'Retake Delivery Plate' : 'Snap Delivery Plate'}
                </button>
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
                        title="Capture scale ticket live via camera"
                      >
                        <Camera size={12} />
                        Snap Ticket
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

                  {!deliveryPlateMatchesTrip && (
                    <div style={{ padding: '0.65rem 0.8rem', backgroundColor: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 'var(--radius-md)', color: '#9A3412', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                      <span>A fresh delivery-gate plate photo must match the inbound waybill before this trip can be closed.</span>
                    </div>
                  )}

                  {/* Complete Delivery Action Button */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="submit"
                      className="btn btn-success btn-lg"
                      style={{ flex: 1 }}
                      disabled={!matchingOpenTrip || !deliveryPlateMatchesTrip}
                      title={!deliveryPlateMatchesTrip ? 'Verify the arriving truck plate first' : 'Close this delivery trip'}
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

      {/* ONBOARDING MODAL: UNREGISTERED TRUCK & DRIVER ENROLLMENT */}
      {isUnregisteredModalOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsUnregisteredModalOpen(false);
          }}
        >
          <div className="modal-card" style={{ maxWidth: '580px', padding: 0 }}>
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: '#FFFBEB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#FEF3C7',
                    color: '#B45309',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #FCD34D',
                  }}
                >
                  <TruckIcon size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    Enroll Unregistered Truck & Driver
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                    <PlateDisplay plate={newTruckPlate || confirmedPlate} size="sm" />
                    <span style={{ fontSize: '0.72rem', color: '#B45309', fontWeight: 600 }}>
                      • First-time gate scan enrollment
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsUnregisteredModalOpen(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0.35rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleOnboardNewTruckAndDriver} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Notice */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem',
                  color: '#1E40AF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <ShieldCheck size={16} style={{ flexShrink: 0 }} />
                <span>
                  This vehicle is not yet registered. Enter the truck specs and the active driver's bank remittance details to establish fleet lineage and enable Paystack e-settlement.
                </span>
              </div>

              {/* Section 1: Vehicle Master Data */}
              <div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <TruckIcon size={14} color="#0284C7" /> Vehicle Master Specifications
                </h4>

                <div className="grid-2" style={{ gap: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>License Plate Number *</label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      value={newTruckPlate}
                      onChange={(e) => setNewTruckPlate(e.target.value.toUpperCase())}
                      placeholder="e.g. IKD-882ZX"
                      style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Truck Body / Model *</label>
                    <select
                      className="form-select"
                      value={newTruckType}
                      onChange={(e) => setNewTruckType(e.target.value)}
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {TRUCK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-3" style={{ gap: '0.75rem', marginTop: '0.65rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Rated Payload (Tonnes) *</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="5"
                      max="60"
                      step="0.5"
                      value={newTruckCapacity}
                      onChange={(e) => setNewTruckCapacity(Number(e.target.value))}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Haulier / Fleet Owner *</label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      placeholder="e.g. Coastal Sands Ltd"
                      value={newTruckOwner}
                      onChange={(e) => setNewTruckOwner(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Owner Phone</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="+234 800 000 0000"
                      value={newTruckOwnerPhone}
                      onChange={(e) => setNewTruckOwnerPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Driver Master & Bank Remittance */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <User size={14} color="#047857" /> Driver & Paystack Settlement Account
                </h4>

                <div className="grid-2" style={{ gap: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Driver Full Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      placeholder="e.g. Babatunde Lawal"
                      value={newDriverName}
                      onChange={(e) => setNewDriverName(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Driver Phone Number *</label>
                    <input
                      type="tel"
                      className="form-input"
                      required
                      placeholder="e.g. +234 803 234 5678"
                      value={newDriverPhone}
                      onChange={(e) => setNewDriverPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid-2" style={{ gap: '0.75rem', marginTop: '0.65rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Settlement Bank *</label>
                    <select
                      className="form-select"
                      value={newDriverBankName}
                      onChange={(e) => setNewDriverBankName(e.target.value)}
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {NIGERIAN_BANKS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>10-Digit NUBAN Account Number *</label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      maxLength={10}
                      placeholder="e.g. 0123456789"
                      value={newDriverAccountNumber}
                      onChange={(e) => setNewDriverAccountNumber(e.target.value.replace(/\D/g, ''))}
                      style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '0.65rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>FRSC Driver's License Number (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. FRSC-LAG-992381"
                      value={newDriverLicense}
                      onChange={(e) => setNewDriverLicense(e.target.value)}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: '1rem',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsUnregisteredModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#B45309', borderColor: '#92400E', gap: '0.4rem' }}
                >
                  <CheckCircle2 size={16} />
                  <span>Register & Assign for Dispatch</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
