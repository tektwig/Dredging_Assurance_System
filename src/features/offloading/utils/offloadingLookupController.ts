import type { PlateCaptureEvidence } from '../../loading/types';
import { OffloadingAuthorizationError } from '../services/offloadingData';
import { preparedCapture, type OffloadingLookupResult, type OffloadingLookupState } from '../types';

export type OffloadingLookupSnapshot = { state: OffloadingLookupState; pending: boolean };

export class OffloadingLookupController {
  private revision = 0;
  private pending = false;
  private disposed = false;
  private snapshot: OffloadingLookupSnapshot = { state: { status: 'idle' }, pending: false };

  constructor(private readonly lookup: (plate: string) => Promise<OffloadingLookupResult>,
    private readonly notify: (snapshot: OffloadingLookupSnapshot) => void,
    private readonly now: () => string = () => new Date().toISOString()) {}

  get current() { return this.snapshot; }
  private publish(state: OffloadingLookupState) {
    if (this.disposed) return;
    this.snapshot = { state, pending: this.pending };
    this.notify(this.snapshot);
  }
  reset() { this.revision++; this.pending = false; this.publish({ status: 'idle' }); }
  dispose() { this.disposed = true; this.revision++; this.pending = false; }
  resume() { this.disposed = false; }

  async submit(plateInput: string, evidence: PlateCaptureEvidence | null): Promise<boolean> {
    if (this.pending || this.disposed) return false;
    const plate = plateInput.trim();
    if (!plate) { this.publish({ status: 'invalid_plate' }); return false; }
    const revision = ++this.revision;
    const capture = preparedCapture(plate, evidence, this.now());
    this.pending = true;
    this.publish({ status: 'looking_up', plate });
    try {
      const result = await this.lookup(plate);
      if (this.disposed || revision !== this.revision) return true;
      if (result.kind === 'found') this.publish({ status: 'found', assignment: result.assignment,
        trip: result.trip, capture });
      else if (result.code === 'NO_OPEN_TRIP') this.publish({ status: 'no_open_trip', plate });
      else if (result.code === 'INVALID_PLATE') this.publish({ status: 'invalid_plate' });
      else this.publish({ status: 'site_unavailable' });
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.publish(error instanceof OffloadingAuthorizationError
        ? { status: 'access_unavailable' } : { status: 'lookup_error', plate });
    } finally {
      if (!this.disposed && revision === this.revision) {
        this.pending = false;
        this.publish(this.snapshot.state);
      }
    }
    return true;
  }
}
