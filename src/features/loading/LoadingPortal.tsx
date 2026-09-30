import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { DriverIdentification } from './components/DriverIdentification';
import { PlateCapture } from './components/PlateCapture';
import { LoadingPortalView } from './components/LoadingPortalView';
import { TripReview } from './components/TripReview';
import { RegistrationDialog } from './components/RegistrationDialog';
import { loadAssignedSite, loadLoadingStatistics, lookupLoadingTruck } from './services/loadingData';
import { registerLoadingParticipant, searchLoadingDrivers } from './services/driverData';
import { LoadingAuthorizationError } from './services/errors';
import { openLoadingTrip } from './services/tripData';
import { createPlateOcrService } from './services/plateOcr';
import type { SavedRegistrationReceipt, SiteContextState, StatisticsState } from './types';
import { LoadingLookupController, type LookupSnapshot } from './utils/lookupController';
import { DriverWorkflowController, type DriverWorkflowSnapshot } from './utils/driverWorkflowController';
import { operationalDateKey, operationalDateLabel } from './utils/operationalDate';
import { OpenTripController, type OpenTripState } from './utils/openTripController';
import { reviewForSelection } from './utils/reviewSelection';
import { PlateCaptureController, type PlateCaptureState } from './utils/plateCaptureController';
import { useRealtimeTrips } from '../../hooks/useRealtimeTrips';
import { NotificationToastContainer } from '../../components/common/NotificationToast';
import { parseTonnage } from '../offloading/utils/tonnage';
import './loading.css';

export function LoadingPortal() {
  const { account } = useAuth();
  if (account.status !== 'active' || account.profile.role !== 'loading_officer') return null;
  return <LoadingPortalContent key={account.profile.id} actorId={account.profile.id}
    officerName={account.profile.display_name.trim() || 'Loading Officer'} />;
}

function LoadingPortalContent({ actorId, officerName }: { actorId: string; officerName: string }) {
  const [site, setSite] = useState<SiteContextState>({ status: 'loading' });
  const [statistics, setStatistics] = useState<StatisticsState>({ status: 'loading' });
  const [siteRevision, setSiteRevision] = useState(0);
  const [statisticsRevision, setStatisticsRevision] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [plate, setPlate] = useState('');
  const [truckConfirmed, setTruckConfirmed] = useState(false);
  const truckConfirmedRef = useRef(truckConfirmed);
  truckConfirmedRef.current = truckConfirmed;
  const [estimatedTonnage, setEstimatedTonnage] = useState('');
  const [lookupSnapshot, setLookupSnapshot] = useState<LookupSnapshot>({ state: { status: 'idle' }, pending: false });
  const [driverSnapshot, setDriverSnapshot] = useState<DriverWorkflowSnapshot | null>(null);
  const [lateRegistration, setLateRegistration] = useState<SavedRegistrationReceipt | null>(null);
  const [openState, setOpenState] = useState<OpenTripState>({ status: 'idle' });
  const [lateOpenedTrip, setLateOpenedTrip] = useState<string | null>(null);
  const [capture, setCapture] = useState<PlateCaptureState>({ status: 'idle' });
  const siteRef = useRef(site);
  const lookupAssignmentRef = useRef<string | null>(null);
  siteRef.current = site;
  const controller = useMemo(() => new LoadingLookupController(
    plateValue => lookupLoadingTruck({ plate: plateValue }),
    setLookupSnapshot, () => setSiteRevision(value => value + 1),
  ), []);
  const driverController = useMemo(() => new DriverWorkflowController(
    query => searchLoadingDrivers({ query }), registerLoadingParticipant,
    plateValue => lookupLoadingTruck({ plate: plateValue }),
    (plateValue, result) => {
      const currentSite = siteRef.current;
      if (currentSite.status !== 'ready' || result.assignmentId !== currentSite.site.assignmentId) return false;
      lookupAssignmentRef.current = currentSite.site.assignmentId;
      const accepted = controller.acceptValidatedRegistration(plateValue, result);
      if (accepted) { truckConfirmedRef.current = true; setTruckConfirmed(true); }
      return accepted;
    }, setDriverSnapshot,
    undefined,
    () => { setSite({ status: 'loading' }); setSiteRevision(value => value + 1); },
    receipt => setLateRegistration(receipt),
  ), [controller]);
  const openController = useMemo(() => new OpenTripController(
    openLoadingTrip, setOpenState, () => setStatisticsRevision(value => value + 1),
    () => { setSite({ status: 'loading' }); setSiteRevision(value => value + 1); },
    () => { setSite({ status: 'blocked', reason: 'unauthorized' }); setSiteRevision(value => value + 1); },
    undefined, undefined, result => { setLateOpenedTrip(result.trip.tripNumber); setStatisticsRevision(value => value + 1); },
  ), []);
  const ocrService = useMemo(() => createPlateOcrService(), []);
  const captureController = useMemo(() => new PlateCaptureController(actorId,
    ocrService, state => { if (!truckConfirmedRef.current) setCapture(state); }, candidate => {
      if (truckConfirmedRef.current) return;
      openController.setInput(null);
      lookupAssignmentRef.current = null;
      controller.editPlate();
      driverController.reset();
      setTruckConfirmed(false);
      setEstimatedTonnage('');
      setPlate(candidate);
      const currentSite = siteRef.current;
      if (currentSite.status === 'ready') {
        lookupAssignmentRef.current = currentSite.site.assignmentId;
        void controller.submit(candidate, currentSite.site.assignmentId);
      }
    }), [actorId, ocrService, openController, controller, driverController]);
  const dateKey = operationalDateKey(now);

  useEffect(() => {
    controller.resume();
    driverController.resume();
    openController.resume();
    captureController.resume();
    ocrService.resume();
    return () => { controller.dispose(); driverController.dispose(); openController.dispose();
      captureController.dispose(); ocrService.dispose(); };
  }, [controller, driverController, openController, captureController, ocrService]);

  useEffect(() => {
    if (site.status !== 'ready' || lookupAssignmentRef.current !== site.site.assignmentId) return;
    const state = lookupSnapshot.state;
    if (state.status === 'known_ready') driverController.setContext({
      kind: 'known', plate: state.plate, assignmentId: site.site.assignmentId,
      truck: state.truck, regular: state.driver,
    });
    else if (state.status === 'inactive_driver') driverController.setContext({
      kind: 'known', plate: state.plate, assignmentId: site.site.assignmentId,
      truck: state.truck, regular: state.driver,
    });
    else if (state.status === 'unknown_truck') driverController.setContext({
      kind: 'unknown', plate: state.plate, assignmentId: site.site.assignmentId,
    });
  }, [driverController, site, lookupSnapshot.state]);

  const assignmentId = site.status === 'ready' ? site.site.assignmentId : null;
  const evidence = capture.status === 'detected' ? capture.evidence : null;
  const openInput = reviewForSelection(site, lookupSnapshot, driverSnapshot,
    parseTonnage(estimatedTonnage), evidence);
  const inputKey = openInput ? JSON.stringify([openInput.plate, openInput.truck.id, openInput.actualDriver.id,
    openInput.site.assignmentId, openInput.makeRegular, openInput.estimatedQuantityTonnes,
    openInput.capture?.id ?? null]) : null;
  useEffect(() => { openController.setInput(openInput); }, [openController, inputKey]);
  useEffect(() => {
    const saved = driverController.current.saved;
    if (saved) setLateRegistration(saved.receipt);
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
    captureController.clear();
    truckConfirmedRef.current = false;
    setTruckConfirmed(false);
    setEstimatedTonnage('');
  }, [assignmentId, controller, driverController, captureController]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let current = true;
    setSite({ status: 'loading' });
    void loadAssignedSite(actorId).then(result => {
      if (!current) return;
      setSite(result.kind === 'ready' ? { status: 'ready', site: result.site }
        : { status: 'blocked', reason: result.reason });
    }).catch(error => { if (current) setSite(error instanceof LoadingAuthorizationError
      ? { status: 'blocked', reason: 'unauthorized' } : { status: 'error' }); });
    return () => { current = false; };
  }, [actorId, siteRevision]);

  useEffect(() => {
    let current = true;
    setStatistics({ status: 'loading' });
    void loadLoadingStatistics().then(value => {
      if (current) setStatistics({ status: 'ready', statistics: value });
    }).catch(() => { if (current) setStatistics({ status: 'error' }); });
    return () => { current = false; };
    // now changes every minute; dateKey is the intended daily refresh boundary.
  }, [actorId, dateKey, statisticsRevision]);

  function onLookup() {
    if (site.status !== 'ready') return;
    openController.setInput(null);
    const saved = driverController.current.saved;
    if (saved && saved.status !== 'ready') setLateRegistration(saved.receipt);
    lookupAssignmentRef.current = site.site.assignmentId;
    setTruckConfirmed(false);
    setEstimatedTonnage('');
    driverController.reset();
    void controller.submit(plate, site.site.assignmentId);
  }

  function onCapture(file: File) {
    if (truckConfirmedRef.current || siteRef.current.status !== 'ready' || openState.status === 'submitting'
      || openState.status === 'ambiguous' || openState.status === 'success'
      || driverController.current.registration.status === 'submitting'
      || driverController.current.registration.status === 'refreshing') return;
    const saved = driverController.current.saved;
    if (saved && saved.status !== 'ready') setLateRegistration(saved.receipt);
    openController.setInput(null);
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
    setPlate('');
    setTruckConfirmed(false);
    setEstimatedTonnage('');
    void captureController.capture(file);
  }

  const driverPanel = driverSnapshot && (lookupSnapshot.state.status === 'known_ready'
    || lookupSnapshot.state.status === 'unknown_truck'
    || lookupSnapshot.state.status === 'inactive_driver')
    ? <DriverIdentification state={driverSnapshot} onRegular={() => driverController.chooseRegular()}
      onDifferent={() => driverController.chooseDifferent()}
      onSearchEdit={query => driverController.editSearch(query)}
      onSearch={() => { void driverController.search(); }}
      onSelectExisting={driver => driverController.selectExisting(driver)}
      onStartUnknown={() => driverController.startUnknownRegistration()}
      onStartNewDriver={() => driverController.startNewDriver()}
      onFormEdit={(field, value) => driverController.editForm(field, value)}
      onCancel={() => driverController.cancelRegistration()}
      onRegister={() => { if (siteRef.current.status === 'ready') void driverController.submitRegistration(); }}
      onBackFromDuplicate={() => driverController.backFromDuplicate()}
      onMakeRegular={value => driverController.setMakeRegular(value)} /> : undefined;

  function nextTruck() {
    openController.nextTruck();
    setPlate('');
    truckConfirmedRef.current = false;
    setTruckConfirmed(false);
    setEstimatedTonnage('');
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
    captureController.clear();
    setLateRegistration(null);
    setLateOpenedTrip(null);
  }
  function cancelTruckWorkflow() {
    if (['submitting', 'ambiguous', 'success'].includes(openController.current.status)
      || driverController.current.registration.status === 'submitting'
      || driverController.current.registration.status === 'refreshing') return;
    openController.nextTruck();
    setPlate('');
    truckConfirmedRef.current = false;
    setTruckConfirmed(false);
    setEstimatedTonnage('');
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
    captureController.clear();
    truckConfirmedRef.current = false;
    setLateRegistration(null);
  }
  const tripPanel = <TripReview state={openState} canReview={!!openInput} operationalDate={operationalDateLabel(now)}
    onReview={() => { openController.setInput(openInput); openController.beginReview(); }}
    onBack={() => openController.backToDriver()}
    onOpen={() => { void openController.submit(); }} onNext={nextTruck} />;
  const showDriverPanel = openState.status === 'idle' || openState.status === 'site_changed'
    || openState.status === 'authorization';
  const locked = driverSnapshot?.registration.status === 'submitting' || driverSnapshot?.registration.status === 'refreshing'
    || openState.status === 'submitting' || openState.status === 'ambiguous' || openState.status === 'success';
  const registrationOpen = !!driverSnapshot && driverSnapshot.registration.status !== 'closed';
  const capturePanel = truckConfirmed ? undefined : <PlateCapture state={capture} disabled={locked}
    resetKey={JSON.stringify([plate, assignmentId, openState.status])}
    onCapture={onCapture}
    onScanStart={() => {
      truckConfirmedRef.current = false;
      captureController.clear();
      openController.setInput(null);
      lookupAssignmentRef.current = null;
      controller.editPlate();
      driverController.reset();
      setPlate('');
      setTruckConfirmed(false);
      setEstimatedTonnage('');
    }} />;
  const { toasts, dismissToast } = useRealtimeTrips({
    channelName: 'loading-portal-trips-realtime',
    onTripChange: () => setStatisticsRevision(value => value + 1),
    showToasts: true,
  });

  return (
    <>
      <LoadingPortalView officerName={officerName} now={now} site={site} statistics={statistics}
        estimatedTonnage={estimatedTonnage}
        onEstimatedTonnageChange={setEstimatedTonnage} onConfirmTruck={() => { truckConfirmedRef.current = true; setTruckConfirmed(true); }}
        truckConfirmed={truckConfirmed} onCancelTruckWorkflow={cancelTruckWorkflow}
        lookup={lookupSnapshot} driverPanel={showDriverPanel && !registrationOpen ? driverPanel : undefined}
        registrationDialog={registrationOpen && driverPanel ? <RegistrationDialog open onCancel={() => driverController.cancelRegistration()}>
          {driverPanel}
        </RegistrationDialog> : undefined}
        tripPanel={tripPanel} tripStage={openState.status}
        capturePanel={capturePanel}
        lateOpenedTrip={lateOpenedTrip} onDismissLateOpenedTrip={() => setLateOpenedTrip(null)}
        savedRegistration={driverSnapshot?.saved ?? null} lateRegistration={lateRegistration}
        onDismissLateRegistration={() => setLateRegistration(null)}
        onRetryRegistrationCheck={() => { void driverController.retrySavedValidation(); }}
        onLookup={onLookup}
        onRetrySite={() => { openController.setInput(null); truckConfirmedRef.current = false; lookupAssignmentRef.current = null;
          controller.editPlate(); driverController.reset(); captureController.clear(); setSiteRevision(value => value + 1); }}
        onRetryStatistics={() => setStatisticsRevision(value => value + 1)} />
      <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
