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
import { loadOffloadingStatistics } from './services/offloadingStatistics';
import type { OffloadingStatisticsState } from './types';
import { operationalDateKey } from '../loading/utils/operationalDate';
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
  const [statistics, setStatistics] = useState<OffloadingStatisticsState>({ status: 'loading' });
  const [statisticsRevision, setStatisticsRevision] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [capture, setCapture] = useState<PlateCaptureState>({ status: 'idle' });
  const [lookup, setLookup] = useState<OffloadingLookupSnapshot>({ state: { status: 'idle' }, pending: false });
  const [resetEpoch, setResetEpoch] = useState(0);
  const plateRef = useRef(plate);
  const autoLookupEvidence = useRef<string | null>(null);
  const selectedTripRef = useRef(false);
  selectedTripRef.current = lookup.state.status === 'found';
  plateRef.current = plate;
  const lookupController = useMemo(() => new OffloadingLookupController(lookupOffloadingOpenTrip, snapshot => {
    selectedTripRef.current = snapshot.state.status === 'found';
    setLookup(snapshot);
  }), []);
  const closureController = useMemo(() => new ClosureController(closeOffloadingTrip, setClosure, retry,
    undefined, () => setStatisticsRevision(value => value + 1)), [retry]);
  const ocrService = useMemo(() => createPlateOcrService(), []);
  const captureController = useMemo(() => new PlateCaptureController(actorId,
    ocrService, setCapture, candidate => {
      if (selectedTripRef.current) return;
      lookupController.reset();
      plateRef.current = candidate;
      setPlate(candidate);
      setQuantity('');
    }), [actorId, lookupController, ocrService]);

  useEffect(() => {
    lookupController.resume(); closureController.resume(); captureController.resume(); ocrService.resume();
    return () => { lookupController.dispose(); closureController.dispose(); captureController.dispose(); ocrService.dispose(); };
  }, [lookupController, closureController, captureController, ocrService]);

  const found = lookup.state.status === 'found' ? lookup.state : null;
  const parsedQuantity = parseTonnage(quantity);
  const dateKey = operationalDateKey(now);
  const review = found && parsedQuantity !== null ? {
    assignment: found.assignment, trip: found.trip, capture: found.capture, quantityTonnes: parsedQuantity,
  } : null;
  const reviewKey = review ? JSON.stringify([review.trip.id, review.capture.confirmedPlate,
    review.assignment.assignmentId, review.quantityTonnes, review.capture.method,
    review.capture.capturedAt, review.capture.imagePath]) : null;
  useEffect(() => { closureController.setInput(review); }, [closureController, reviewKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let current = true;
    setStatistics({ status: 'loading' });
    void loadOffloadingStatistics().then(value => {
      if (current) setStatistics({ status: 'ready', statistics: value });
    }).catch(() => { if (current) setStatistics({ status: 'error' }); });
    return () => { current = false; };
  }, [actorId, dateKey, statisticsRevision]);

  useEffect(() => {
    if (capture.status !== 'detected' || autoLookupEvidence.current === capture.evidence.id
      || closureController.current.status !== 'idle') return;
    autoLookupEvidence.current = capture.evidence.id;
    void lookupController.submit(capture.evidence.candidate, capture.evidence);
  }, [capture, closureController, lookupController]);

  useEffect(() => {
    if (lookup.state.status === 'found') captureController.clear();
  }, [lookup.state.status, captureController]);

  useEffect(() => {
    if (closure.status !== 'site_changed') return;
    selectedTripRef.current = false;
    lookupController.reset();
    captureController.clear();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
  }, [closure.status, lookupController, captureController]);

  function captureImage(file: File) {
    if (selectedTripRef.current || lookupController.current.pending || closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
    autoLookupEvidence.current = null;
    void captureController.capture(file);
  }
  function startScan() {
    if (selectedTripRef.current || closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    // Immediately invalidate OCR from an earlier photo without changing the
    // camera reset key while a new camera session is starting.
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
    autoLookupEvidence.current = null;
  }
  function reset() {
    if (!closureController.reset()) return;
    selectedTripRef.current = false;
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setQuantity('');
    autoLookupEvidence.current = null;
    setResetEpoch(value => value + 1);
  }
  const evidence = capture.status === 'detected' ? capture.evidence : null;
  return <OffloadingPortalView officerName={officerName} lookup={lookup}
    closure={closure} statistics={statistics} now={now}
    onRetryStatistics={() => setStatisticsRevision(value => value + 1)}
    closurePanel={<ClosurePanel lookup={found} state={closure} quantity={quantity}
      onQuantity={value => { if (closureController.current.status === 'idle') setQuantity(value); }}
      onReview={() => { closureController.setInput(review); closureController.beginReview(); }}
      onBack={() => closureController.back()} onClose={() => { void closureController.submit(); }} />}
    onLookup={() => {
      if (closureController.current.status !== 'idle') return;
      void lookupController.submit(plateRef.current, evidence);
    }} onReset={reset}
    capturePanel={lookup.state.status === 'found' ? undefined : <PlateCapture state={capture} disabled={lookup.pending || closure.status !== 'idle'}
      resetKey={`${actorId}:${resetEpoch}`} onCapture={captureImage}
      onScanStart={startScan} />} />;
}
