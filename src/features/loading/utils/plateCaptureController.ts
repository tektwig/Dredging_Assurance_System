import type { PlateCaptureEvidence } from '../types';

export type PlateCaptureState =
  | { status: 'idle' }
  | { status: 'processing'; phase: PlateOcrPhase }
  | { status: 'detected'; evidence: PlateCaptureEvidence }
  | { status: 'error'; reason: PlateOcrFailure };

export type PlateOcrPhase = 'preparing_image' | 'loading_model' | 'reading_plate';
export type PlateOcrFailure = 'invalid_image' | 'model_unavailable' | 'reading_failed' | 'no_plate';

export class PlateOcrError extends Error {
  constructor(readonly reason: PlateOcrFailure) { super('Plate OCR unavailable'); }
}

export type ProcessedPlateImage = { image: Blob; candidate: string; confidence: number | null };

export class PlateCaptureController {
  private state: PlateCaptureState = { status: 'idle' };
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly actorId: string,
    private readonly processImage: (file: File, report: (phase: PlateOcrPhase) => void) => Promise<ProcessedPlateImage>,
    private readonly notify: (state: PlateCaptureState) => void,
    private readonly prefill: (plate: string) => void,
    private readonly newUuid: () => string = () => crypto.randomUUID(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get current() { return this.state; }
  private publish(state: PlateCaptureState) {
    if (this.disposed) return;
    this.state = state;
    this.notify(state);
  }
  clear() { this.revision++; this.publish({ status: 'idle' }); }
  // Editing while OCR runs must prevent a late result from replacing manual text.
  cancelPending() { if (this.state.status === 'processing') this.clear(); }
  async capture(file: File): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    const id = this.newUuid();
    const capturedAt = this.now();
    this.publish({ status: 'processing', phase: 'preparing_image' });
    try {
      const result = await this.processImage(file, phase => {
        if (!this.disposed && revision === this.revision) this.publish({ status: 'processing', phase });
      });
      if (this.disposed || revision !== this.revision) return;
      if (!result.candidate || result.candidate.length > 64 || result.image.type !== 'image/jpeg'
        || result.image.size < 1 || result.image.size > 5242880
        || (result.confidence !== null && (!Number.isFinite(result.confidence)
          || result.confidence < 0 || result.confidence > 1))) throw new Error('Invalid capture');
      const evidence: PlateCaptureEvidence = Object.freeze({ id,
        imagePath: `${this.actorId}/${id}.jpg`, image: result.image,
        candidate: result.candidate, confidence: result.confidence, capturedAt });
      this.publish({ status: 'detected', evidence });
      this.prefill(result.candidate);
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.publish({ status: 'error',
        reason: error instanceof PlateOcrError ? error.reason : 'reading_failed' });
    }
  }
  dispose() { this.disposed = true; this.revision++; this.state = { status: 'idle' }; }
  resume() { this.disposed = false; }
}
