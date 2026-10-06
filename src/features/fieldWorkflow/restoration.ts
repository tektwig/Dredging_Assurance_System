import type { LoadingWorkflowDraft, OffloadingWorkflowDraft } from './FieldWorkflowProvider';
import type { LookupState } from '../loading/types';
import type { OffloadingOpenTripsState } from '../offloading/types';

export type RestoreDecision = 'pending' | 'ready' | 'stale';

export function checkLoadingRestore(draft: LoadingWorkflowDraft, currentAssignmentId: string,
  state: LookupState): RestoreDecision {
  if (draft.assignmentId !== currentAssignmentId) return 'stale';
  if (state.status === 'idle' || state.status === 'looking_up') return 'pending';
  if (state.status !== 'known_ready' && state.status !== 'inactive_driver') return 'stale';
  return draft.truckId && state.truck.id !== draft.truckId ? 'stale' : 'ready';
}

export function checkOffloadingRestore(draft: OffloadingWorkflowDraft,
  state: OffloadingOpenTripsState): RestoreDecision {
  if (state.status === 'loading' || state.status === 'error') return 'pending';
  if (state.status !== 'ready') return 'stale';
  if (state.value.assignment.assignmentId !== draft.assignmentId) return 'stale';
  if (!state.value.trips.some(trip => trip.id === draft.tripId)) return 'stale';
  return 'ready';
}
