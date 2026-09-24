import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { LoadingPortalView } from './components/LoadingPortalView';
import { loadAssignedSite, loadLoadingStatistics, lookupLoadingTruck } from './services/loadingData';
import { LoadingAuthorizationError } from './services/errors';
import type { SiteContextState, StatisticsState } from './types';
import { LoadingLookupController, type LookupSnapshot } from './utils/lookupController';
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
  const controller = useMemo(() => new LoadingLookupController(
    plateValue => lookupLoadingTruck({ plate: plateValue }),
    setLookupSnapshot, () => setSiteRevision(value => value + 1),
  ), []);
  const dateKey = operationalDateKey(now);

  useEffect(() => {
    controller.resume();
    return () => controller.dispose();
  }, [controller]);

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
    setPlate(value);
    controller.editPlate();
  }

  function onLookup() {
    if (site.status !== 'ready') return;
    void controller.submit(plate, site.site.assignmentId);
  }

  return <LoadingPortalView officerName={officerName} now={now} site={site} statistics={statistics}
    plate={plate} lookup={lookupSnapshot} onPlateChange={onPlateChange} onLookup={onLookup}
    onRetrySite={() => { controller.editPlate(); setSiteRevision(value => value + 1); }}
    onRetryStatistics={() => setStatisticsRevision(value => value + 1)} />;
}
