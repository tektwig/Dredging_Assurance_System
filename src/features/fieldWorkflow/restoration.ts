import type { LoadingWorkflowDraft, OffloadingWorkflowDraft } from './FieldWorkflowProvider';
import type { LookupState } from '../loading/types';
import type { OffloadingLookupState } from '../offloading/types';

export type RestoreDecision = 'pending' | 'ready' | 'stale';

export function checkLoadingRestore(draft: LoadingWorkflowDraft, currentAssignmentId: string,
  state: LookupState): RestoreDecision {
  if (draft.assignmentId !== currentAssignmentId) return 'stale';
  if (state.status === 'idle' || state.status === 'looking_up') return 'pending';
  if (state.status !== 'known_ready' && state.status !== 'inactive_driver') return 'stale';
  return draft.truckId && state.truck.id !== draft.truckId ? 'stale' : 'ready';
}

export function checkOffloadingRestore(draft: OffloadingWorkflowDraft,
  state: OffloadingLookupState): RestoreDecision {
  if (state.status === 'idle' || state.status === 'looking_up' || state.status === 'lookup_error') return 'pending';
  if (state.status !== 'found') return 'stale';
  if (draft.assignmentId && state.assignment.assignmentId !== draft.assignmentId) return 'stale';
  if (draft.tripId && state.trip.id !== draft.tripId) return 'stale';
  return 'ready';
}
