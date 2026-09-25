import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { PlateCapture } from '../loading/components/PlateCapture';
import { createPlateOcrService } from '../loading/services/plateOcr';
import { PlateCaptureController, type PlateCaptureState } from '../loading/utils/plateCaptureController';
import { lookupOffloadingOpenTrip } from './services/offloadingData';
import { OffloadingLookupController, type OffloadingLookupSnapshot } from './utils/offloadingLookupController';
import { OffloadingPortalView } from './components/OffloadingPortalView';
import '../loading/loading.css';
import './offloading.css';

export function OffloadingPortal() {
  const { account } = useAuth();
  if (account.status !== 'active' || account.profile.role !== 'offloading_officer') return null;
  return <OffloadingPortalContent key={account.profile.id} actorId={account.profile.id}
    officerName={account.profile.display_name.trim() || 'Offloading Officer'} />;
}

function OffloadingPortalContent({ actorId, officerName }: { actorId: string; officerName: string }) {
  const [plate, setPlate] = useState('');
  const [capture, setCapture] = useState<PlateCaptureState>({ status: 'idle' });
  const [lookup, setLookup] = useState<OffloadingLookupSnapshot>({ state: { status: 'idle' }, pending: false });
  const [resetEpoch, setResetEpoch] = useState(0);
  const plateRef = useRef(plate);
  plateRef.current = plate;
  const lookupController = useMemo(() => new OffloadingLookupController(lookupOffloadingOpenTrip, setLookup), []);
  const ocrService = useMemo(() => createPlateOcrService(), []);
  const captureController = useMemo(() => new PlateCaptureController(actorId,
    (file, report) => ocrService.process(file, report), setCapture, candidate => {
      lookupController.reset();
      plateRef.current = candidate;
      setPlate(candidate);
    }), [actorId, lookupController, ocrService]);

  useEffect(() => {
    lookupController.resume(); captureController.resume(); ocrService.resume();
    return () => { lookupController.dispose(); captureController.dispose(); ocrService.dispose(); };
  }, [lookupController, captureController, ocrService]);

  function changePlate(value: string) {
    captureController.cancelPending();
    plateRef.current = value;
    setPlate(value);
    lookupController.reset();
    setResetEpoch(value => value + 1);
  }
  function captureImage(file: File) {
    if (lookupController.current.pending) return;
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    void captureController.capture(file);
  }
  function startScan() {
    // Immediately invalidate OCR from an earlier photo without changing the
    // camera reset key while a new camera session is starting.
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
  }
  function reset() {
    captureController.clear();
    lookupController.reset();
    plateRef.current = '';
    setPlate('');
    setResetEpoch(value => value + 1);
  }
  const evidence = capture.status === 'detected' ? capture.evidence : null;
  return <OffloadingPortalView officerName={officerName} plate={plate} lookup={lookup}
    onPlateChange={changePlate} onLookup={() => {
      // The officer must submit the confirmed text; OCR never calls this.
      void lookupController.submit(plateRef.current, evidence);
    }} onReset={reset}
    capturePanel={<PlateCapture state={capture} disabled={lookup.pending}
      lookupActionLabel="Find Open Trip"
      resetKey={`${actorId}:${resetEpoch}`} onCapture={captureImage}
      onScanStart={startScan} onManual={() => {
        captureController.clear(); lookupController.reset(); setResetEpoch(value => value + 1);
      }} />} />;
}
