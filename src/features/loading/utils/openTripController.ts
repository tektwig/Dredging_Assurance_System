import type { OpenTripRequest, OpenTripResult, OpenTripReview, OpenTripSuccess } from '../types';
import { LoadingAuthorizationError, TripOutcomeUnknownError } from '../services/errors';

export type OpenTripState =
  | { status: 'idle' }
  | { status: 'review'; review: OpenTripReview }
  | { status: 'submitting'; review: OpenTripReview }
  | { status: 'ambiguous'; review: OpenTripReview }
  | { status: 'business_failure'; review: OpenTripReview; code: Extract<OpenTripResult, { kind: 'business_failure' }>['code']; tripNumber?: string }
  | { status: 'site_changed' }
  | { status: 'authorization' }
  | { status: 'success'; result: OpenTripSuccess; review: OpenTripReview };

function key(review: OpenTripReview): string {
  return JSON.stringify([review.plate, review.truck.id, review.actualDriver.id,
    review.site.assignmentId, review.makeRegular, review.estimatedQuantityTonnes, review.capture.id]);
}

function snapshot(review: OpenTripReview): OpenTripReview {
  return Object.freeze({ ...review,
    truck: Object.freeze({ ...review.truck }),
    actualDriver: Object.freeze({ ...review.actualDriver }),
    site: Object.freeze({ ...review.site }),
    capture: Object.freeze({ ...review.capture }),
  });
}

export class OpenTripController {
  private state: OpenTripState = { status: 'idle' };
  private candidate: OpenTripReview | null = null;
  private candidateKey: string | null = null;
  private request: OpenTripRequest | null = null;
  private revision = 0;
  private pending = false;
  private disposed = false;

  constructor(
    private readonly open: (request: OpenTripRequest) => Promise<OpenTripResult>,
    private readonly notify: (state: OpenTripState) => void,
    private readonly opened: () => void,
    private readonly siteChanged: () => void,
    private readonly accessLost: () => void,
    private readonly newUuid: () => string = () => crypto.randomUUID(),
    _now: () => string = () => new Date().toISOString(),
    private readonly staleSuccess?: (result: OpenTripSuccess) => void,
  ) {}

  get current(): OpenTripState { return this.state; }
  get frozenRequest(): OpenTripRequest | null { return this.request; }
  private publish(state: OpenTripState) {
    if (this.disposed) return;
    this.state = state;
    this.notify(state);
  }
  setInput(input: OpenTripReview | null) {
    const nextKey = input ? key(input) : null;
    if (nextKey === this.candidateKey) return;
    this.revision++;
    this.candidateKey = nextKey;
    this.candidate = input ? snapshot(input) : null;
    this.request = null;
    this.publish({ status: 'idle' });
  }
  beginReview() {
    if (!this.candidate || this.pending || this.state.status === 'success') return;
    this.publish({ status: 'review', review: this.candidate });
  }
  backToDriver() {
    if (this.pending || this.state.status === 'success' || this.state.status === 'ambiguous') return;
    this.request = null;
    this.publish({ status: 'idle' });
  }
  async submit(): Promise<void> {
    if (this.pending || this.disposed || !this.candidate) return;
    if (this.state.status !== 'review' && this.state.status !== 'ambiguous') return;
    const request = this.request ?? Object.freeze({
      requestId: this.newUuid(), capturedAt: this.candidate.capture.capturedAt, review: this.candidate,
    });
    this.request = request;
    const revision = this.revision;
    this.pending = true;
    this.publish({ status: 'submitting', review: request.review });
    try {
      const result = await this.open(request);
      if (this.disposed) return;
      if (revision !== this.revision) {
        if (result.kind === 'success') this.staleSuccess?.(result);
        return;
      }
      if (result.kind === 'success') {
        this.request = null;
        this.publish({ status: 'success', result, review: request.review });
        this.opened();
      } else if (result.code === 'SITE_ASSIGNMENT_CHANGED' || result.code === 'SITE_ASSIGNMENT_REQUIRED'
        || result.code === 'INVALID_SITE_ASSIGNMENT' || result.code === 'INACTIVE_SITE'
        || result.code === 'SITE_REVIEW_REQUIRED') {
        this.request = null;
        this.candidate = null;
        this.candidateKey = null;
        this.publish({ status: 'site_changed' });
        this.siteChanged();
      } else {
        this.request = null;
        this.publish({ status: 'business_failure', review: request.review, code: result.code,
          tripNumber: result.tripNumber });
      }
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      if (error instanceof LoadingAuthorizationError) {
        this.request = null;
        this.candidate = null;
        this.candidateKey = null;
        this.publish({ status: 'authorization' });
        this.accessLost();
      } else if (error instanceof TripOutcomeUnknownError || error instanceof Error) {
        this.publish({ status: 'ambiguous', review: request.review });
      } else this.publish({ status: 'ambiguous', review: request.review });
    } finally { this.pending = false; }
  }
  nextTruck() {
    this.revision++;
    this.request = null;
    this.candidate = null;
    this.candidateKey = null;
    this.publish({ status: 'idle' });
  }
  dispose() { this.disposed = true; this.nextTruck(); }
  resume() { this.disposed = false; }
}
