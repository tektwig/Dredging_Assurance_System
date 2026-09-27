import { OffloadingAuthorizationError } from '../services/offloadingData';
import type { ClosureRequest, ClosureResult, ClosureReview, ClosureSuccess } from '../types';

export type ClosureState =
  | { status: 'idle' }
  | { status: 'review'; review: ClosureReview }
  | { status: 'submitting'; review: ClosureReview }
  | { status: 'ambiguous'; review: ClosureReview }
  | { status: 'business_failure'; review: ClosureReview;
      code: Extract<ClosureResult, { kind: 'business_failure' }>['code']; tripNumber?: string }
  | { status: 'site_changed' }
  | { status: 'authorization' }
  | { status: 'success'; result: ClosureSuccess };

function reviewKey(review: ClosureReview | null) {
  return review ? JSON.stringify([review.trip.id, review.capture.confirmedPlate,
    review.assignment.assignmentId, review.quantityTonnes, review.capture.method,
    review.capture.capturedAt, review.capture.imagePath]) : null;
}

export class ClosureController {
  private state: ClosureState = { status: 'idle' };
  private candidate: ClosureReview | null = null;
  private key: string | null = null;
  private request: ClosureRequest | null = null;
  private pending = false;
  private disposed = false;
  private revision = 0;

  constructor(private readonly close: (request: ClosureRequest) => Promise<ClosureResult>,
    private readonly notify: (state: ClosureState) => void,
    private readonly onAuthorizationLost: () => void,
    private readonly newUuid: () => string = () => crypto.randomUUID(),
    private readonly onSuccess: () => void = () => {}) {}

  get current() { return this.state; }
  get frozenRequest() { return this.request; }
  get isLocked() { return this.pending || this.state.status === 'ambiguous'; }
  private publish(state: ClosureState) {
    if (this.disposed) return;
    this.state = state;
    this.notify(state);
  }
  setInput(review: ClosureReview | null) {
    if (this.pending || this.state.status === 'ambiguous' || this.state.status === 'success'
      || this.state.status === 'site_changed' || this.state.status === 'authorization') return;
    const key = reviewKey(review);
    if (key === this.key) return;
    this.revision++;
    this.key = key;
    this.candidate = review ? Object.freeze({
      assignment: Object.freeze({ ...review.assignment }),
      trip: Object.freeze({ ...review.trip }),
      capture: Object.freeze({ ...review.capture }),
      quantityTonnes: review.quantityTonnes,
    }) : null;
    this.request = null;
    this.publish({ status: 'idle' });
  }
  beginReview() {
    if (this.disposed || !this.candidate || this.state.status !== 'idle') return;
    this.publish({ status: 'review', review: this.candidate });
  }
  back() {
    if (this.state.status === 'review' && !this.pending) this.publish({ status: 'idle' });
  }
  async submit() {
    if (this.disposed || this.pending || !this.candidate
      || (this.state.status !== 'review' && this.state.status !== 'ambiguous')) return;
    const request = this.request ?? Object.freeze({ requestId: this.newUuid(), review: this.candidate });
    this.request = request;
    const revision = this.revision;
    this.pending = true;
    this.publish({ status: 'submitting', review: request.review });
    try {
      const result = await this.close(request);
      if (this.disposed || revision !== this.revision) return;
      if (result.kind === 'success') {
        this.request = null;
        this.onSuccess();
        this.publish({ status: 'success', result });
      } else if (['SITE_REVIEW_REQUIRED', 'SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT',
        'INACTIVE_SITE', 'SITE_ASSIGNMENT_CHANGED'].includes(result.code)) {
        this.request = null;
        this.candidate = null;
        this.key = null;
        this.publish({ status: 'site_changed' });
      } else {
        this.request = null;
        this.publish({ status: 'business_failure', review: request.review,
          code: result.code, tripNumber: result.tripNumber });
      }
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      if (error instanceof OffloadingAuthorizationError) {
        this.request = null;
        this.candidate = null;
        this.key = null;
        this.publish({ status: 'authorization' });
        this.onAuthorizationLost();
      } else this.publish({ status: 'ambiguous', review: request.review });
    } finally { this.pending = false; }
  }
  reset() {
    if (this.pending || this.state.status === 'ambiguous') return false;
    this.revision++;
    this.candidate = null;
    this.key = null;
    this.request = null;
    this.publish({ status: 'idle' });
    return true;
  }
  dispose() { this.disposed = true; this.revision++; this.request = null; }
  resume() { this.disposed = false; }
}
