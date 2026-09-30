import type { LookupState, TruckLookupResult } from '../types';
import { LoadingAuthorizationError } from '../services/errors';

export type LookupSnapshot = { state: LookupState; pending: boolean };

export class LoadingLookupController {
  private revision = 0;
  private pending = false;
  private disposed = false;
  private snapshot: LookupSnapshot = { state: { status: 'idle' }, pending: false };

  constructor(
    private readonly lookup: (plate: string) => Promise<TruckLookupResult>,
    private readonly notify: (snapshot: LookupSnapshot) => void,
    private readonly assignmentChanged: () => void,
  ) {}

  get current(): LookupSnapshot { return this.snapshot; }

  private publish(state: LookupState) {
    if (this.disposed) return;
    this.snapshot = { state, pending: this.pending };
    this.notify(this.snapshot);
  }

  editPlate() {
    this.revision += 1;
    this.pending = false;
    this.publish({ status: 'idle' });
  }

  dispose() { this.disposed = true; this.revision += 1; }
  resume() { this.disposed = false; }

  // Called only after the independent registration refresh has passed identity
  // validation. An inactive regular driver stays unselectable in the driver flow.
  acceptValidatedRegistration(plate: string, result: Extract<TruckLookupResult, { kind: 'known_ready' | 'inactive_driver' }>): boolean {
    if (this.disposed || this.pending) return false;
    this.revision += 1;
    this.publish({ status: result.kind, plate, truck: result.truck, driver: result.driver });
    return true;
  }

  async submit(plateInput: string, expectedAssignmentId: string): Promise<boolean> {
    if (this.pending || this.disposed) return false;
    const plate = plateInput.trim();
    if (!plate) { this.publish({ status: 'invalid_plate', plate }); return false; }
    this.pending = true;
    const revision = ++this.revision;
    this.publish({ status: 'looking_up', plate });
    try {
      const result = await this.lookup(plate);
      if (this.disposed || revision !== this.revision) return true;
      if (result.kind === 'business_failure') {
        if (result.code === 'INVALID_PLATE') this.publish({ status: 'invalid_plate', plate });
        else { this.publish({ status: 'site_unavailable' }); this.assignmentChanged(); }
      } else if (result.assignmentId !== expectedAssignmentId) {
        this.publish({ status: 'site_unavailable' });
        this.assignmentChanged();
      } else {
        switch (result.kind) {
          case 'known_ready': this.publish({ status: 'known_ready', plate, truck: result.truck, driver: result.driver }); break;
          case 'unknown_truck': this.publish({ status: 'unknown_truck', plate }); break;
          case 'inactive_truck': this.publish({ status: 'inactive_truck', plate, truck: result.truck }); break;
          case 'inactive_driver': this.publish({ status: 'inactive_driver', plate, truck: result.truck, driver: result.driver }); break;
          case 'open_trip_exists': this.publish({ status: 'open_trip_exists', plate, truck: result.truck, trip: result.trip }); break;
          case 'blocking_exception': this.publish({ status: 'blocking_exception', plate, truck: result.truck }); break;
        }
      }
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.publish(
        error instanceof LoadingAuthorizationError ? { status: 'access_unavailable' } : { status: 'lookup_error', plate },
      );
    } finally {
      if (!this.disposed && revision === this.revision) {
        this.pending = false;
        this.publish(this.snapshot.state);
      }
    }
    return true;
  }
}
