import type { PlateCaptureEvidence } from '../../loading/types';
import { OffloadingAuthorizationError } from '../services/offloadingData';
import { normalizeOffloadingPlate, preparedCapture, type OffloadingAssignment,
  type OffloadingLookupResult, type OffloadingOpenTripListItem, type OffloadingVerificationState } from '../types';

type Selection = { trip: OffloadingOpenTripListItem; assignment: OffloadingAssignment };
export type OffloadingVerificationSnapshot = { state: OffloadingVerificationState; pending: boolean };

export class OffloadingVerificationController {
  private revision = 0;
  private pending = false;
  private disposed = false;
  private selection: Selection | null = null;
  private snapshot: OffloadingVerificationSnapshot = { state: { status: 'idle' }, pending: false };

  constructor(private readonly lookup: (plate: string) => Promise<OffloadingLookupResult>,
    private readonly notify: (snapshot: OffloadingVerificationSnapshot) => void,
    private readonly now: () => string = () => new Date().toISOString()) {}

  get current() { return this.snapshot; }
  private publish(state: OffloadingVerificationState) {
    if (this.disposed) return;
    this.snapshot = { state, pending: this.pending };
    this.notify(this.snapshot);
  }

  select(trip: OffloadingOpenTripListItem, assignment: OffloadingAssignment) {
    this.revision++;
    this.pending = false;
    this.selection = { trip: { ...trip }, assignment: { ...assignment } };
    this.publish({ status: 'idle' });
  }

  clear() {
    this.revision++;
    this.pending = false;
    this.selection = null;
    this.publish({ status: 'idle' });
  }

  resetForRescan() {
    this.revision++;
    this.pending = false;
    this.publish({ status: 'idle' });
  }

  async verify(evidence: PlateCaptureEvidence): Promise<boolean> {
    const selection = this.selection;
    if (!selection || this.pending || this.disposed) return false;
    const revision = ++this.revision;
    this.pending = true;
    this.publish({ status: 'verifying', tripId: selection.trip.id, candidate: evidence.candidate });
    try {
      const result = await this.lookup(evidence.candidate);
      if (this.disposed || revision !== this.revision) return true;
      if (result.kind === 'business_failure') {
        if (result.code === 'SITE_ASSIGNMENT_REQUIRED' || result.code === 'INVALID_SITE_ASSIGNMENT'
          || result.code === 'INACTIVE_SITE') this.publish({ status: 'site_unavailable' });
        else this.publish({ status: 'mismatch', tripId: selection.trip.id, candidate: evidence.candidate });
      } else {
        const samePlate = normalizeOffloadingPlate(evidence.candidate) === selection.trip.normalizedRegistration
          && result.trip.normalizedRegistration === selection.trip.normalizedRegistration;
        const sameTrip = result.trip.id === selection.trip.id && result.trip.truckId === selection.trip.truckId;
        const sameAssignment = result.assignment.assignmentId === selection.assignment.assignmentId
          && result.assignment.siteId === selection.assignment.siteId;
        if (!samePlate || !sameTrip || !sameAssignment) {
          this.publish({ status: 'mismatch', tripId: selection.trip.id, candidate: evidence.candidate });
        } else {
          this.publish({ status: 'verified', tripId: selection.trip.id,
            assignment: result.assignment, trip: result.trip,
            capture: preparedCapture(evidence.candidate, evidence, this.now()) });
        }
      }
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.publish(error instanceof OffloadingAuthorizationError
        ? { status: 'access_unavailable' } : { status: 'error', tripId: selection.trip.id });
    } finally {
      if (!this.disposed && revision === this.revision) {
        this.pending = false;
        this.publish(this.snapshot.state);
      }
    }
    return true;
  }

  dispose() { this.disposed = true; this.revision++; this.pending = false; this.selection = null; }
  resume() { this.disposed = false; }
}
