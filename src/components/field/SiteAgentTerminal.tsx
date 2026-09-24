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
  Clock,
  FileText,
  AlertTriangle,
  Check,
  Video,
  VideoOff,
  SwitchCamera,
  User,
  Users,
  UserPlus,
  CreditCard,
  Search,
  X,
  Phone,
  Building,
} from 'lucide-react';
import { SiteAgentModeSheet } from './SiteAgentModeSheet';
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
    lookupTruckByPlate,
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
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);
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

  // Cleanup camera resources and preview URL on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  // The video element mounts after getUserMedia resolves, so attach the saved
  // stream after React renders the live viewfinder.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!isLiveCameraActive || !video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      setCameraError('The camera opened, but the preview could not start. Close it and try again.');
    });
  }, [isLiveCameraActive]);

  // 3. Movement Type State: 'pickup' vs 'delivery'
  const [movementType, setMovementType] = useState<'pickup' | 'delivery'>(() => {
    try {
      const saved = sessionStorage.getItem('dredgeops_siteagent_mode');
      return saved === 'delivery' ? 'delivery' : 'pickup';
    } catch {
      return 'pickup';
    }
  });

  const [isModeSheetOpen, setIsModeSheetOpen] = useState<boolean>(() => {
    try {
      // Check if user has explicitly picked their initial shift mode in this session
      return !sessionStorage.getItem('dredgeops_siteagent_mode_selected');
    } catch {
      return true;
    }
  });

  const handleSelectTerminalMode = (mode: 'pickup' | 'delivery') => {
    setMovementType(mode);
    setIsModeSheetOpen(false);
    try {
      sessionStorage.setItem('dredgeops_siteagent_mode', mode);
      sessionStorage.setItem('dredgeops_siteagent_mode_selected', 'true');
    } catch {
      // ignore
    }
  };

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

  useEffect(() => {
    if (offloadingSites.length === 0 && destinationSiteId) {
      setDestinationSiteId('');
    } else if (offloadingSites.length > 0 && !offloadingSites.some((site) => site.id === destinationSiteId)) {
      setDestinationSiteId(offloadingSites[0].id);
    }
  }, [destinationSiteId, offloadingSites]);

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

  const stopLiveCamera = () => {
    cameraRequestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraReady(false);
    setIsCameraStarting(false);
    setIsLiveCameraActive(false);
  };

  const startLiveCamera = async (
    purpose: 'general' | 'delivery' = movementType === 'delivery' ? 'delivery' : 'general',
    facing: 'environment' | 'user' = cameraFacingMode
  ) => {
    const requestId = ++cameraRequestIdRef.current;
    capturePurposeRef.current = purpose;
    setCameraError(null);
    setIsCameraReady(false);
    setIsCameraStarting(true);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires a supported browser over HTTPS.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraFacingMode(facing);
      setIsLiveCameraActive(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setCameraError(
        /NotAllowed|Permission/i.test(message)
          ? 'Camera permission is blocked. Allow camera access in the browser, then try again.'
          : `Camera could not start: ${message}`
      );
      setIsLiveCameraActive(false);
    } finally {
      setIsCameraStarting(false);
    }
  };

  const openDeviceCamera = (
    purpose: 'general' | 'delivery' = movementType === 'delivery' ? 'delivery' : 'general'
  ) => {
    capturePurposeRef.current = purpose;
    stopLiveCamera();
    setCameraError(null);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
      cameraInputRef.current.click();
    }
  };

  const switchWebsiteCamera = () => {
    const facing = cameraFacingMode === 'environment' ? 'user' : 'environment';
    void startLiveCamera(capturePurposeRef.current, facing);
  };

  const captureFullWebsiteFrame = () => {
    const video = videoRef.current;
    if (!video || !isCameraReady) {
      setCameraError('Wait for the live preview to finish starting, then take the photo.');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Retain the complete camera frame. OCR may preprocess a copy internally,
    // while the full original remains the evidence photo and preview.
    context.drawImage(video, 0, 0, width, height);
    const image = canvas.toDataURL('image/jpeg', 0.95);
    stopLiveCamera();
    void runPlateOCR(image);
  };

  const retakePlatePhoto = () => {
    capturePurposeRef.current = movementType === 'delivery' ? 'delivery' : 'general';
    setHasScanned(false);
    setIsScanning(false);
    setOcrProgress(0);
    setOcrStatus('Ready for capture');
    setIsUnregisteredModalOpen(false);
    openDeviceCamera();
  };

  const captureDeliveryPlate = () => {
    capturePurposeRef.current = 'delivery';
    setDeliveryPlateEvidence(null);
    setHasScanned(false);
    setOcrProgress(0);
    setOcrStatus('Ready for capture');
    void startLiveCamera('delivery', 'environment');
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

      setConfirmedPlate(result.candidatePlate);
      setConfidenceScore(result.confidence);

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
      const liveLookup = await lookupTruckByPlate(result.candidatePlate);
      const matched = liveLookup.truck || result.matchedTruck || trucks.find((t) => t.normalized_registration === normalized);

      if (matched) {
        setSelectedTruckId(matched.id);
        const tonnage = matched.capacity_tonnes || matched.capacity || 30;
        setEstimatedTonnes(tonnage);
        setDeliveredTonnes(tonnage);
        const openTripDriverId = openTrips.find((trip) => trip.truck_id === matched.id)?.driver_id;
        const driver = liveLookup.driver
          || drivers.find((item) => item.id === openTripDriverId)
          || drivers.find((item) => item.assigned_truck_id === matched.id)
          || drivers[0];
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
        text: `Plate [${result.candidatePlate}] recognized (${result.confidence}% confidence).`,
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
  const handleDispatchPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasScanned) {
      setToastMessage({ text: 'Scan the truck plate before issuing a live waybill.', type: 'warning' });
      return;
    }
    if (!selectedTruckId || !selectedDriverId) {
      setToastMessage({
        text: 'Vehicle and Driver must be registered before issuing a waybill. Please complete registration.',
        type: 'warning',
      });
      setIsUnregisteredModalOpen(true);
      return;
    }

    try {
      const newTrip = await createLoadingTrip({
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
        text: `Live waybill issued! Trip ${newTrip.trip_number} is now visible at the delivery gate.`,
        type: 'success',
      });
      setPickupNotes('');
    } catch (error: unknown) {
      setToastMessage({
        text: error instanceof Error ? error.message : 'The live waybill could not be issued.',
        type: 'warning',
      });
    }
    setTimeout(() => setToastMessage(null), 5500);
  };

  // Submit Delivery (Offloading Gate / Weighbridge Close)
  const handleCompleteDelivery = async (e: React.FormEvent) => {
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

    const result = await closeOffloadingTrip(matchingOpenTrip.id, {
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
    } else {
      setToastMessage({ text: result.message || 'The live trip could not be closed.', type: 'warning' });
      setTimeout(() => setToastMessage(null), 5000);
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Locked Assigned Mode Post Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 800,
              borderRadius: 'var(--radius-full)',
              backgroundColor: movementType === 'pickup' ? '#FEF3C7' : '#E0F2FE',
              color: movementType === 'pickup' ? '#B45309' : '#0369A1',
              border: `1.5px solid ${movementType === 'pickup' ? '#FCD34D' : '#BAE6FD'}`,
              minHeight: '32px',
            }}
          >
            {movementType === 'pickup' ? <TruckIcon size={14} /> : <Scale size={14} />}
            <span>Assigned Post: {movementType === 'pickup' ? 'Gate 1 (Pickup)' : 'Gate 2 (Delivery)'}</span>
          </div>

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

      {/* Native device-camera input. Mobile browsers open the operating-system camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraCapture}
        aria-label="Take a full truck photo with the device camera"
      />

      {/* Main Two-Column Terminal Layout */}
      <div className="field-two-col">
        {/* Left Column: Camera Viewfinder & OCR Extraction */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <Camera size={18} color="#B45309" />
              <span>Plate Scanner</span>
            </h3>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void startLiveCamera()}
                className="btn btn-primary"
                disabled={isCameraStarting || isScanning}
                style={{ minHeight: '38px', fontSize: '0.8rem', fontWeight: 700 }}
                title="Open the camera inside this website"
              >
                <Video size={16} />
                <span>{isCameraStarting ? 'Opening...' : 'Website Camera'}</span>
              </button>
              <button
                type="button"
                onClick={() => openDeviceCamera()}
                className="btn btn-secondary"
                disabled={isCameraStarting || isScanning}
                style={{ minHeight: '38px', fontSize: '0.8rem', fontWeight: 700 }}
                title="Open the device camera app and use the complete photo"
              >
                <Camera size={16} />
                <span>Device Camera</span>
              </button>
            </div>
          </div>

          {cameraError && (
            <div style={{ padding: '0.65rem 0.8rem', borderRadius: 'var(--radius-md)', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.75rem' }}>
              {cameraError}
            </div>
          )}

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
                <span className="camera-reticle-label">ALIGN PLATE — FULL FRAME SAVED</span>
              </div>
              <div className="camera-live-pill">LIVE WEBSITE CAMERA</div>
              <div style={{ position: 'absolute', zIndex: 10, left: 10, right: 10, bottom: 10, display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={switchWebsiteCamera} style={{ backgroundColor: 'rgba(15, 23, 42, 0.88)', color: '#FFFFFF' }}>
                  <SwitchCamera size={14} /> Flip
                </button>
                <button type="button" className="btn btn-primary" onClick={captureFullWebsiteFrame} disabled={!isCameraReady}>
                  <Camera size={16} /> {isCameraReady ? 'Take Full Photo' : 'Starting...'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={stopLiveCamera} style={{ backgroundColor: 'rgba(15, 23, 42, 0.88)', color: '#FFFFFF' }}>
                  <VideoOff size={14} /> Close
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
                objectFit: hasScanned ? 'contain' : 'cover',
                backgroundColor: '#0F172A',
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
                <Camera size={34} color="#FCD34D" />
                <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>
                  Camera Ready
                </span>
                <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
                  Choose Website Camera or Device Camera above
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

          {/* Plate Capture Confirmation Banner */}
          {hasScanned && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#F8FAFC',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#047857', fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                <span>Plate Scanned ({confidenceScore}% Confidence)</span>
              </div>
              <button
                type="button"
                onClick={retakePlatePhoto}
                disabled={isScanning}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <RotateCcw size={12} />
                <span>Retake</span>
              </button>
            </div>
          )}

          {/* Read-Only Verified Plate Display (Anti-Fraud Lock) */}
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: '#F8FAFC',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                IDENTIFIED PLATE:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: '#047857', fontWeight: 700 }}>
                <ShieldCheck size={13} color="#059669" />
                <span>Locked to Camera Scan</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '0.4rem 0' }}>
              <PlateDisplay plate={confirmedPlate} size="lg" />
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
              Terminal locked to your assigned operational post:
            </p>
          </div>

          {/* LOCKED ASSIGNED POST BANNER (NO TOGGLING ALLOWED) */}
          <div
            style={{
              padding: '0.9rem 1.1rem',
              borderRadius: 'var(--radius-lg)',
              border: `2px solid ${movementType === 'pickup' ? '#FCD34D' : '#6EE7B7'}`,
              backgroundColor: movementType === 'pickup' ? '#FEF3C7' : '#D1FAE5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#FFFFFF',
                  color: movementType === 'pickup' ? '#B45309' : '#047857',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${movementType === 'pickup' ? '#FCD34D' : '#6EE7B7'}`,
                  flexShrink: 0,
                }}
              >
                {movementType === 'pickup' ? <TruckIcon size={18} /> : <Scale size={18} />}
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '0.92rem', color: movementType === 'pickup' ? '#92400E' : '#065F46' }}>
                  {movementType === 'pickup' ? 'Gate 1 Dredge Pit — Pickup Dispatch' : 'Gate 2 Weighbridge — Delivery Check'}
                </strong>
                <span style={{ fontSize: '0.72rem', color: movementType === 'pickup' ? '#B45309' : '#047857' }}>
                  {movementType === 'pickup' ? 'Digital waybill & haulage authorization' : 'Scale ticket verification & trip closure'}
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 800,
                backgroundColor: '#FFFFFF',
                color: movementType === 'pickup' ? '#B45309' : '#047857',
                border: `1px solid ${movementType === 'pickup' ? '#FCD34D' : '#6EE7B7'}`,
                padding: '0.25rem 0.55rem',
                borderRadius: 'var(--radius-sm)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              LOCKED POST
            </span>
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
                    {offloadingSites.length === 0 && (
                      <option value="">Assigned automatically at the delivery gate</option>
                    )}
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
                disabled={!hasScanned || !selectedTruckId || !selectedDriverId}
                title={!hasScanned ? 'Scan the truck plate before issuing a live waybill' : 'Issue the live waybill'}
                style={{
                  width: '100%',
                  marginTop: '0.25rem',
                  backgroundColor: (!hasScanned || !selectedTruckId || !selectedDriverId) ? '#94A3B8' : '#B45309',
                  borderColor: (!hasScanned || !selectedTruckId || !selectedDriverId) ? '#94A3B8' : '#92400E',
                  cursor: (!hasScanned || !selectedTruckId || !selectedDriverId) ? 'not-allowed' : 'pointer',
                  boxShadow: (!hasScanned || !selectedTruckId || !selectedDriverId) ? 'none' : '0 2px 4px 0 rgba(180, 83, 9, 0.25)',
                }}
              >
                <TruckIcon size={18} />
                <span>
                  {!hasScanned
                    ? 'Scan Plate to Issue Waybill'
                    : (!selectedTruckId || !selectedDriverId)
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
                      style={{ width: '72px', height: '52px', objectFit: 'contain', backgroundColor: '#0F172A', borderRadius: '6px', border: '1px solid var(--border-default)' }}
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
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={deliveryPlateMatchesTrip ? 'btn btn-secondary' : 'btn btn-primary'}
                    onClick={captureDeliveryPlate}
                    disabled={isScanning || isCameraStarting}
                    style={{ minHeight: '42px' }}
                  >
                    <Video size={16} /> Website Camera
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setDeliveryPlateEvidence(null);
                      setHasScanned(false);
                      openDeviceCamera('delivery');
                    }}
                    disabled={isScanning || isCameraStarting}
                    style={{ minHeight: '42px' }}
                  >
                    <Camera size={16} /> Device Camera
                  </button>
                </div>
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
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Driver: <strong>{matchingOpenTrip.driver?.full_name || 'Driver details on file'}</strong>
                    {matchingOpenTrip.driver?.phone ? ` • ${matchingOpenTrip.driver.phone}` : ''}
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

        {/* Mobile-Friendly Movement Cards */}
        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {filteredRecentTrips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              No recent movement records.
            </div>
          ) : (
            filteredRecentTrips.map((trip) => (
              <div
                key={trip.id}
                style={{
                  padding: '0.75rem 0.85rem',
                  backgroundColor: '#F8FAFC',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                  <PlateDisplay plate={trip.truck?.registration_number || 'UNKNOWN'} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>
                      #{trip.trip_number}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {trip.status === 'open' ? 'Dispatched' : 'Delivered'} • {trip.status === 'open' ? `${trip.loading_event?.estimated_tonnes || 30}T` : `${trip.offloading_event?.quantity || 30}T`}
                    </div>
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  <StatusBadge status={trip.status} />
                </div>
              </div>
            ))
          )}
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
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>License Plate Number (Scanned)</label>
                    <input
                      type="text"
                      className="form-input"
                      readOnly
                      value={newTruckPlate}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        backgroundColor: '#F1F5F9',
                        color: '#0F172A',
                        cursor: 'not-allowed',
                      }}
                      title="Locked to scanned plate to prevent fraud"
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

      {/* Mode Selection Prompt Bottom Sheet */}
      <SiteAgentModeSheet
        isOpen={isModeSheetOpen}
        onSelectMode={handleSelectTerminalMode}
        onClose={() => {
          // Can only close if an initial mode has already been picked in this session
          if (sessionStorage.getItem('dredgeops_siteagent_mode_selected')) {
            setIsModeSheetOpen(false);
          }
        }}
        isMandatory={!sessionStorage.getItem('dredgeops_siteagent_mode_selected')}
      />
    </div>
  );
};
