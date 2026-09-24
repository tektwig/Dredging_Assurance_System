import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { DriverIdentification } from './components/DriverIdentification';
import { LoadingPortalView } from './components/LoadingPortalView';
import { loadAssignedSite, loadLoadingStatistics, lookupLoadingTruck } from './services/loadingData';
import { registerLoadingParticipant, searchLoadingDrivers } from './services/driverData';
import { LoadingAuthorizationError } from './services/errors';
import type { SavedRegistrationReceipt, SiteContextState, StatisticsState } from './types';
import { LoadingLookupController, type LookupSnapshot } from './utils/lookupController';
import { DriverWorkflowController, type DriverWorkflowSnapshot } from './utils/driverWorkflowController';
import { operationalDateKey } from './utils/operationalDate';
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
  const [lookupSnapshot, setLookupSnapshot] = useState<LookupSnapshot>({ state: { status: 'idle' }, pending: false });
  const [driverSnapshot, setDriverSnapshot] = useState<DriverWorkflowSnapshot | null>(null);
  const [lateRegistration, setLateRegistration] = useState<SavedRegistrationReceipt | null>(null);
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
      return controller.acceptValidatedRegistration(plateValue, result);
    }, setDriverSnapshot,
    undefined,
    () => { setSite({ status: 'loading' }); setSiteRevision(value => value + 1); },
    receipt => setLateRegistration(receipt),
  ), [controller]);
  const dateKey = operationalDateKey(now);

  useEffect(() => {
    controller.resume();
    driverController.resume();
    return () => { controller.dispose(); driverController.dispose(); };
  }, [controller, driverController]);

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
  useEffect(() => {
    const saved = driverController.current.saved;
    if (saved) setLateRegistration(saved.receipt);
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
  }, [assignmentId, controller, driverController]);

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

  function onPlateChange(value: string) {
    const saved = driverController.current.saved;
    if (saved && saved.status !== 'ready') setLateRegistration(saved.receipt);
    setPlate(value);
    lookupAssignmentRef.current = null;
    controller.editPlate();
    driverController.reset();
  }

  function onLookup() {
    if (site.status !== 'ready') return;
    const saved = driverController.current.saved;
    if (saved && saved.status !== 'ready') setLateRegistration(saved.receipt);
    lookupAssignmentRef.current = site.site.assignmentId;
    driverController.reset();
    void controller.submit(plate, site.site.assignmentId);
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

  return <LoadingPortalView officerName={officerName} now={now} site={site} statistics={statistics}
    plate={plate} lookup={lookupSnapshot} driverPanel={driverPanel}
    savedRegistration={driverSnapshot?.saved ?? null} lateRegistration={lateRegistration}
    onDismissLateRegistration={() => setLateRegistration(null)}
    onRetryRegistrationCheck={() => { void driverController.retrySavedValidation(); }}
    plateLocked={driverSnapshot?.registration.status === 'submitting' || driverSnapshot?.registration.status === 'refreshing'}
    onPlateChange={onPlateChange} onLookup={onLookup}
    onRetrySite={() => { lookupAssignmentRef.current = null; controller.editPlate(); driverController.reset(); setSiteRevision(value => value + 1); }}
    onRetryStatistics={() => setStatisticsRevision(value => value + 1)} />;
}
