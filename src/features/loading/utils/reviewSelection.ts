import type { OpenTripReview, PlateCaptureEvidence, SiteContextState } from '../types';
import type { LookupSnapshot } from './lookupController';
import type { DriverWorkflowSnapshot } from './driverWorkflowController';

// The regular driver is already selected by the driver workflow when active.
// Review availability depends on the selected actual driver, not on whether
// the officer opened the Different Driver branch.
export function reviewForSelection(
  site: SiteContextState, lookup: LookupSnapshot, driver: DriverWorkflowSnapshot | null,
  capture?: PlateCaptureEvidence | null,
): OpenTripReview | null {
  const state = lookup.state;
  const context = driver?.context;
  const selected = driver?.selected;
  if (site.status !== 'ready'
    || (state.status !== 'known_ready' && state.status !== 'inactive_driver')
    || context?.kind !== 'known' || context.truck.id !== state.truck.id
    || context.plate !== state.plate || context.assignmentId !== site.site.assignmentId
    || !selected?.driver.isActive || driver?.registration.status !== 'closed'
    || (driver.saved && driver.saved.status !== 'ready'
      && !(driver.saved.status === 'blocked' && driver.saved.reason === 'inactive_driver'))) return null;
  return { plate: state.plate, truck: state.truck, actualDriver: selected.driver,
    regularDriverId: context.regular.id, site: site.site, makeRegular: selected.makeRegular,
    capture: capture ?? undefined };
}
