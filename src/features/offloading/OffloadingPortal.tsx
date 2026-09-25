import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { PlateCapture } from '../loading/components/PlateCapture';
import { createPlateOcrService } from '../loading/services/plateOcr';
import { PlateCaptureController, type PlateCaptureState } from '../loading/utils/plateCaptureController';
import { lookupOffloadingOpenTrip } from './services/offloadingData';
import { OffloadingLookupController, type OffloadingLookupSnapshot } from './utils/offloadingLookupController';
import { OffloadingPortalView } from './components/OffloadingPortalView';
import { closeOffloadingTrip } from './services/closeTripData';
import { ClosureController, type ClosureState } from './utils/closureController';
import { parseTonnage } from './utils/tonnage';
import { ClosurePanel } from './components/ClosurePanel';
import '../loading/loading.css';
import './offloading.css';

export function OffloadingPortal() {
  const { account } = useAuth();
  if (account.status !== 'active' || account.profile.role !== 'offloading_officer') return null;
  return <OffloadingPortalContent key={account.profile.id} actorId={account.profile.id}
    officerName={account.profile.display_name.trim() || 'Offloading Officer'} />;
}

function OffloadingPortalContent({ actorId, officerName }: { actorId: string; officerName: string }) {
  const { retry } = useAuth();
  const [plate, setPlate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [closure, setClosure] = useState<ClosureState>({ status: 'idle' });
  const [capture, setCapture] = useState<PlateCaptureState>({ status: 'idle' });
  const [lookup, setLookup] = useState<OffloadingLookupSnapshot>({ state: { status: 'idle' }, pending: false });
  const [resetEpoch, setResetEpoch] = useState(0);
  const plateRef = useRef(plate);
  plateRef.current = plate;
  const lookupController = useMemo(() => new OffloadingLookupController(lookupOffloadingOpenTrip, setLookup), []);
  const closureController = useMemo(() => new ClosureController(closeOffloadingTrip, setClosure, retry), [retry]);
  const ocrService = useMemo(() => createPlateOcrService(), []);
  const captureController = useMemo(() => new PlateCaptureController(actorId,
    (file, report) => ocrService.process(file, report), setCapture, candidate => {
      lookupController.reset();
      plateRef.current = candidate;
      setPlate(candidate);
    }), [actorId, lookupController, ocrService]);

  useEffect(() => {
    lookupController.resume(); closureController.resume(); captureController.resume(); ocrService.resume();
    return () => { lookupController.dispose(); closureController.dispose(); captureController.dispose(); ocrService.dispose(); };
  }, [lookupController, closureController, captureController, ocrService]);

  const found = lookup.state.status === 'found' ? lookup.state : null;
  const parsedQuantity = parseTonnage(quantity);
  const review = found && parsedQuantity !== null ? {
    assignment: found.assignment, trip: found.trip, capture: found.capture, quantityTonnes: parsedQuantity,
  } : null;
  const reviewKey = review ? JSON.stringify([review.trip.id, review.capture.confirmedPlate,
    review.assignment.assignmentId, review.quantityTonnes, review.capture.method,
    review.capture.capturedAt, review.capture.imagePath]) : null;
  useEffect(() => { closureController.setInput(review); }, [closureController, reviewKey]);

  useEffect(() => {
    if (closure.status !== 'site_changed') return;
    lookupController.reset();
    captureController.clear();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
  }, [closure.status, lookupController, captureController]);

  function changePlate(value: string) {
    if (closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    captureController.cancelPending();
    plateRef.current = value;
    setPlate(value);
    lookupController.reset();
    setQuantity('');
    setResetEpoch(value => value + 1);
  }
  function captureImage(file: File) {
    if (lookupController.current.pending || closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
    void captureController.capture(file);
  }
  function startScan() {
    if (closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    // Immediately invalidate OCR from an earlier photo without changing the
    // camera reset key while a new camera session is starting.
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
  }
  function reset() {
    if (!closureController.reset()) return;
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
    setResetEpoch(value => value + 1);
  }
  const evidence = capture.status === 'detected' ? capture.evidence : null;
  return <OffloadingPortalView officerName={officerName} plate={plate} lookup={lookup}
    closure={closure}
    closurePanel={<ClosurePanel lookup={found} state={closure} quantity={quantity}
      onQuantity={value => { if (closureController.current.status === 'idle') setQuantity(value); }}
      onReview={() => { closureController.setInput(review); closureController.beginReview(); }}
      onBack={() => closureController.back()} onClose={() => { void closureController.submit(); }} />}
    onPlateChange={changePlate} onLookup={() => {
      if (closureController.current.status !== 'idle') return;
      // The officer must submit the confirmed text; OCR never calls this.
      void lookupController.submit(plateRef.current, evidence);
    }} onReset={reset}
    capturePanel={<PlateCapture state={capture} disabled={lookup.pending || closure.status !== 'idle'}
      lookupActionLabel="Find Open Trip"
      resetKey={`${actorId}:${resetEpoch}`} onCapture={captureImage}
      onScanStart={startScan} onManual={() => {
        if (closureController.current.status !== 'idle') return;
        closureController.setInput(null);
        captureController.clear(); lookupController.reset(); setQuantity('');
        setResetEpoch(value => value + 1);
      }} />} />;
}
