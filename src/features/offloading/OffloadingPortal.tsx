import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { PlateCapture } from '../loading/components/PlateCapture';
import { createPlateOcrService } from '../loading/services/plateOcr';
import { PlateCaptureController, type PlateCaptureState } from '../loading/utils/plateCaptureController';
import { loadOffloadingOpenTrips, lookupOffloadingOpenTrip, OffloadingAuthorizationError }
  from './services/offloadingData';
import type { OffloadingVerificationSnapshot } from './utils/offloadingVerificationController';
import { OffloadingVerificationController } from './utils/offloadingVerificationController';
import { OffloadingPortalView } from './components/OffloadingPortalView';
import { closeOffloadingTrip } from './services/closeTripData';
import { ClosureController, type ClosureState } from './utils/closureController';
import { parseTonnage } from './utils/tonnage';
import { ClosurePanel } from './components/ClosurePanel';
import { loadOffloadingStatistics } from './services/offloadingStatistics';
import type { OffloadingOpenTripsState, OffloadingStatisticsState, OffloadingOpenTripListItem }
  from './types';
import { operationalDateKey } from '../loading/utils/operationalDate';
import { useRealtimeTrips } from '../../hooks/useRealtimeTrips';
import { NotificationToastContainer } from '../../components/common/NotificationToast';
import { useFieldWorkflowStore, type FieldWorkflowScope } from '../fieldWorkflow/FieldWorkflowProvider';
import { checkOffloadingRestore } from '../fieldWorkflow/restoration';
import '../loading/loading.css';
import './offloading.css';

export function OffloadingPortal() {
  const { account } = useAuth();
  if (account.status !== 'active' || account.profile.role !== 'offloading_officer') return null;
  const operationalDate = account.fieldOperationalDate ?? operationalDateKey();
  return <OffloadingPortalContent key={`${account.profile.id}:${operationalDate}`} actorId={account.profile.id}
    operationalDate={operationalDate}
    officerName={account.profile.display_name.trim() || 'Offloading Officer'} />;
}

function OffloadingPortalContent({ actorId, operationalDate, officerName }: {
  actorId: string; operationalDate: string; officerName: string;
}) {
  const { retry } = useAuth();
  const workflowStore = useFieldWorkflowStore();
  const workflowScope: FieldWorkflowScope = { actorId, role: 'offloading_officer', operationalDate };
  const [openTrips, setOpenTrips] = useState<OffloadingOpenTripsState>({ status: 'loading' });
  const [selectedTrip, setSelectedTrip] = useState<OffloadingOpenTripListItem | null>(null);
  const [quantity, setQuantity] = useState('');
  const [closure, setClosure] = useState<ClosureState>({ status: 'idle' });
  const [statistics, setStatistics] = useState<OffloadingStatisticsState>({ status: 'loading' });
  const [statisticsRevision, setStatisticsRevision] = useState(0);
  const [openTripsRevision, setOpenTripsRevision] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [capture, setCapture] = useState<PlateCaptureState>({ status: 'idle' });
  const [verificationSnapshot, setVerificationSnapshot] = useState<OffloadingVerificationSnapshot>(
    { state: { status: 'idle' }, pending: false });
  const [resetEpoch, setResetEpoch] = useState(0);
  const selectedTripRef = useRef<OffloadingOpenTripListItem | null>(null);
  const assignmentRef = useRef<{ assignmentId: string; siteId: string } | null>(null);
  const openTripsRef = useRef(openTrips);
  const autoLookupEvidence = useRef<string | null>(null);
  const listRequestRevision = useRef(0);
  const restoreHandled = useRef(false);
  openTripsRef.current = openTrips;
  selectedTripRef.current = selectedTrip;

  const verificationController = useMemo(() => new OffloadingVerificationController(
    lookupOffloadingOpenTrip, snapshot => setVerificationSnapshot(snapshot)), []);
  const closureController = useMemo(() => new ClosureController(closeOffloadingTrip, setClosure, retry,
    undefined, () => {
      workflowStore.clearOffloading(workflowScope);
      setStatisticsRevision(value => value + 1);
      setOpenTripsRevision(value => value + 1);
    }), [retry, actorId, operationalDate, workflowStore]);
  const ocrService = useMemo(() => createPlateOcrService(), []);
  const captureController = useMemo(() => new PlateCaptureController(actorId,
    ocrService, setCapture, () => {}), [actorId, ocrService]);

  useEffect(() => {
    verificationController.resume(); closureController.resume(); captureController.resume(); ocrService.resume();
    return () => {
      verificationController.dispose(); closureController.dispose(); captureController.dispose(); ocrService.dispose();
    };
  }, [verificationController, closureController, captureController, ocrService]);

  const setOpenTripsState = useCallback((next: OffloadingOpenTripsState) => {
    openTripsRef.current = next;
    setOpenTrips(next);
  }, []);

  const clearSelectedTrip = useCallback((clearDraft = true) => {
    selectedTripRef.current = null;
    assignmentRef.current = null;
    setSelectedTrip(null);
    setQuantity('');
    verificationController.clear();
    captureController.clear();
    autoLookupEvidence.current = null;
    if (clearDraft) workflowStore.clearOffloading(workflowScope);
    setResetEpoch(value => value + 1);
  }, [verificationController, captureController, workflowStore, actorId, operationalDate]);

  const invalidateUnavailableTrip = useCallback((trip: OffloadingOpenTripListItem) => {
    const current = closureController.current.status;
    if (current === 'submitting' || current === 'ambiguous') return;
    clearSelectedTrip();
    closureController.tripUnavailable(trip.tripNumber);
  }, [closureController, clearSelectedTrip]);

  const refreshOpenTrips = useCallback(async () => {
    const requestRevision = ++listRequestRevision.current;
    if (openTripsRef.current.status !== 'ready') setOpenTripsState({ status: 'loading' });
    try {
      const result = await loadOffloadingOpenTrips();
      if (requestRevision !== listRequestRevision.current) return;
      if (result.kind === 'business_failure') {
        const selected = selectedTripRef.current;
        if (selected && closureController.current.status !== 'submitting'
          && closureController.current.status !== 'ambiguous') {
          clearSelectedTrip();
          if (result.code === 'SITE_ASSIGNMENT_REQUIRED' || result.code === 'INVALID_SITE_ASSIGNMENT'
            || result.code === 'INACTIVE_SITE') closureController.reset();
        }
        setOpenTripsState({ status: 'site_unavailable' });
        return;
      }

      const current = selectedTripRef.current;
      const selectedAssignment = assignmentRef.current;
      if (current && selectedAssignment && closureController.current.status !== 'submitting'
        && closureController.current.status !== 'ambiguous') {
        if (result.value.assignment.assignmentId !== selectedAssignment.assignmentId) {
          clearSelectedTrip();
          closureController.reset();
        } else {
          const updated = result.value.trips.find(trip => trip.id === current.id);
          if (!updated) invalidateUnavailableTrip(current);
          else if (updated.truckId !== current.truckId
            || updated.normalizedRegistration !== current.normalizedRegistration) {
            verificationController.select(updated, result.value.assignment);
            captureController.clear();
            autoLookupEvidence.current = null;
            closureController.reset();
            setSelectedTrip(updated);
            selectedTripRef.current = updated;
            assignmentRef.current = { assignmentId: result.value.assignment.assignmentId,
              siteId: result.value.assignment.siteId };
            setQuantity('');
            setResetEpoch(value => value + 1);
          } else {
            setSelectedTrip(updated);
            selectedTripRef.current = updated;
          }
        }
      }
      setOpenTripsState({ status: 'ready', value: result.value });
    } catch (error) {
      if (requestRevision !== listRequestRevision.current) return;
      if (error instanceof OffloadingAuthorizationError) {
        const selected = selectedTripRef.current;
        if (selected && closureController.current.status !== 'submitting'
          && closureController.current.status !== 'ambiguous') clearSelectedTrip();
        setOpenTripsState({ status: 'access_unavailable' });
        retry();
      } else setOpenTripsState({ status: 'error' });
    }
  }, [setOpenTripsState, closureController, clearSelectedTrip, invalidateUnavailableTrip,
    verificationController, captureController, retry]);

  useEffect(() => { void refreshOpenTrips(); }, [refreshOpenTrips, openTripsRevision]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshOpenTrips();
    };
    window.addEventListener('focus', refreshOpenTrips);
    window.addEventListener('pageshow', refreshOpenTrips);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshOpenTrips);
      window.removeEventListener('pageshow', refreshOpenTrips);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshOpenTrips]);

  useEffect(() => {
    if (openTrips.status !== 'ready' || restoreHandled.current) return;
    const draft = workflowStore.getOffloading(workflowScope);
    if (!draft) { restoreHandled.current = true; return; }
    const decision = checkOffloadingRestore(draft, openTrips);
    if (decision === 'pending') return;
    restoreHandled.current = true;
    if (decision === 'stale') {
      workflowStore.clearOffloading(workflowScope);
      return;
    }
    const trip = openTrips.value.trips.find(item => item.id === draft.tripId);
    if (!trip) { workflowStore.clearOffloading(workflowScope); return; }
    selectedTripRef.current = trip;
    assignmentRef.current = { assignmentId: openTrips.value.assignment.assignmentId,
      siteId: openTrips.value.assignment.siteId };
    setSelectedTrip(trip);
    setQuantity(draft.quantity);
    verificationController.select(trip, openTrips.value.assignment);
    // The former camera result is never restored. A new physical scan is required.
    captureController.clear();
  }, [openTrips, workflowStore, verificationController, captureController, actorId, operationalDate]);

  useEffect(() => {
    if (!selectedTrip || !assignmentRef.current) {
      if (!restoreHandled.current) return;
      workflowStore.clearOffloading(workflowScope);
      return;
    }
    workflowStore.saveOffloading(workflowScope, {
      assignmentId: assignmentRef.current.assignmentId,
      tripId: selectedTrip.id,
      quantity,
    });
  }, [selectedTrip, quantity, workflowStore, actorId, operationalDate]);

  const verification = verificationSnapshot.state;
  const verified = verification.status === 'verified' ? verification : null;
  const parsedQuantity = parseTonnage(quantity);
  const review = verified && parsedQuantity !== null ? {
    assignment: verified.assignment, trip: verified.trip, capture: verified.capture, quantityTonnes: parsedQuantity,
  } : null;
  const reviewKey = review ? JSON.stringify([review.trip.id, review.capture.confirmedPlate,
    review.assignment.assignmentId, review.quantityTonnes, review.capture.method,
    review.capture.capturedAt, review.capture.imagePath]) : null;
  useEffect(() => { closureController.setInput(review); }, [closureController, reviewKey]);

  useEffect(() => {
    if (capture.status !== 'detected' || autoLookupEvidence.current === capture.evidence.id
      || !selectedTripRef.current || closureController.current.status !== 'idle') return;
    autoLookupEvidence.current = capture.evidence.id;
    void verificationController.verify(capture.evidence);
  }, [capture, verificationController, closureController]);

  useEffect(() => {
    if (closure.status === 'success') {
      clearSelectedTrip();
      void refreshOpenTrips();
    } else if (closure.status === 'trip_unavailable') {
      clearSelectedTrip();
      void refreshOpenTrips();
    } else if (closure.status === 'site_changed' || closure.status === 'authorization') {
      clearSelectedTrip();
      if (closure.status === 'site_changed') void refreshOpenTrips();
    }
  }, [closure.status, clearSelectedTrip, refreshOpenTrips]);

  const dateKey = operationalDateKey(now);

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
  }, [actorId, operationalDate, dateKey, statisticsRevision]);

  function selectTrip(trip: OffloadingOpenTripListItem) {
    const state = openTripsRef.current;
    if (state.status !== 'ready' || closureController.current.status === 'submitting'
      || closureController.current.status === 'ambiguous'
      || !state.value.trips.some(item => item.id === trip.id)) return;
    if (!closureController.reset()) return;
    const currentTrip = state.value.trips.find(item => item.id === trip.id);
    if (!currentTrip) return;
    selectedTripRef.current = currentTrip;
    assignmentRef.current = { assignmentId: state.value.assignment.assignmentId,
      siteId: state.value.assignment.siteId };
    setSelectedTrip(currentTrip);
    setQuantity('');
    verificationController.select(currentTrip, state.value.assignment);
    captureController.clear();
    autoLookupEvidence.current = null;
    setResetEpoch(value => value + 1);
  }

  function returnToOpenTrips() {
    if (!closureController.reset()) return;
    clearSelectedTrip();
  }

  function rescan() {
    if (!selectedTripRef.current || closureController.current.status !== 'idle') return;
    closureController.setInput(null);
    verificationController.resetForRescan();
    captureController.clear();
    autoLookupEvidence.current = null;
    setQuantity('');
    setResetEpoch(value => value + 1);
  }

  function captureImage(file: File) {
    if (!selectedTripRef.current || verification.status === 'verified'
      || closureController.current.status !== 'idle') return;
    void captureController.capture(file);
  }

  function startScan() {
    if (!selectedTripRef.current || closureController.current.status !== 'idle') return;
    verificationController.resetForRescan();
    closureController.setInput(null);
    captureController.clear();
    autoLookupEvidence.current = null;
    setQuantity('');
  }

  const { toasts, dismissToast } = useRealtimeTrips({
    channelName: 'offloading-portal-trips-realtime',
    onTripChange: refreshOpenTrips,
    showToasts: true,
  });
  const verifiedLookup = verified ? { status: 'found' as const,
    assignment: verified.assignment, trip: verified.trip, capture: verified.capture } : null;
  const closurePanel = <ClosurePanel lookup={verifiedLookup} state={closure} quantity={quantity}
    onQuantity={value => { if (closureController.current.status === 'idle' && verified) setQuantity(value); }}
    onReview={() => { if (review) { closureController.setInput(review); closureController.beginReview(); } }}
    onBack={() => closureController.back()} onClose={() => { void closureController.submit(); }} />;

  return <>
    <OffloadingPortalView officerName={officerName} openTrips={openTrips}
      selectedTrip={selectedTrip} verification={verification} closure={closure}
      closurePanel={closurePanel} statistics={statistics} now={now}
      onSelectTrip={selectTrip} onRetryOpenTrips={() => { void refreshOpenTrips(); }}
      onRetryStatistics={() => setStatisticsRevision(value => value + 1)}
      onRescan={rescan} onReturnToOpenTrips={returnToOpenTrips}
      capturePanel={<PlateCapture state={capture} disabled={verificationSnapshot.pending || closure.status !== 'idle'}
        resetKey={`${actorId}:${resetEpoch}:${selectedTrip?.id ?? 'open-trips'}`}
        onCapture={captureImage} onScanStart={startScan} />} />
    <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />
  </>;
}
