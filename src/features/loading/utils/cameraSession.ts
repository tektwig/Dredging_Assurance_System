export type CameraFailure = 'permission_denied' | 'unavailable' | 'initialization_failed';

export function classifyCameraFailure(error: unknown): CameraFailure {
  const name = error instanceof DOMException ? error.name :
    error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return 'permission_denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError'
    || name === 'NotReadableError' || name === 'TrackStartError') return 'unavailable';
  return 'initialization_failed';
}

export class CameraSession {
  private stream: MediaStream | null = null;
  private revision = 0;

  constructor(private readonly request: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {}

  get generation() { return this.revision; }
  isActive(stream: MediaStream) { return this.stream === stream; }

  async start(): Promise<MediaStream | null> {
    this.stop();
    const revision = this.revision;
    let stream: MediaStream;
    try {
      stream = await this.request({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    } catch (error) {
      if (revision !== this.revision) return null;
      throw error;
    }
    if (revision !== this.revision) {
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    this.stream = stream;
    return stream;
  }

  stop() {
    this.revision++;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}

// The preview uses object-fit: cover. Map its visible guide back to source pixels.
export function guideSourceRect(videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number) {
  if (![videoWidth, videoHeight, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Camera frame unavailable');
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  const visibleWidth = viewWidth / scale;
  const visibleHeight = viewHeight / scale;
  return {
    x: (videoWidth - visibleWidth) / 2 + visibleWidth * 0.1,
    y: (videoHeight - visibleHeight) / 2 + visibleHeight * 0.32,
    width: visibleWidth * 0.8,
    height: visibleHeight * 0.36,
  };
}

export async function captureGuideFrame(video: HTMLVideoElement): Promise<File> {
  const frame = video.getBoundingClientRect();
  const source = guideSourceRect(video.videoWidth, video.videoHeight, frame.width, frame.height);
  const scale = Math.min(1, 1600 / source.width, 1000 / source.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Camera frame unavailable');
  context.drawImage(video, source.x, source.y, source.width, source.height,
    0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.type !== 'image/jpeg' || blob.size < 1 || blob.size > 20 * 1024 * 1024)
    throw new Error('Camera frame unavailable');
  return new File([blob], 'plate-capture.jpg', { type: 'image/jpeg' });
}
