import { PlateOcrError, type PlateOcrPhase, type PlateOcrProvider, type ProcessedPlateImage } from '../utils/plateCaptureController';
import type { PaddleOCRCreateOptions } from '@paddleocr/paddleocr-js';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

async function reencodePlateImage(file: File): Promise<Blob> {
  if ((file.type !== 'image/jpeg' && file.type !== 'image/png')
    || file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('Invalid image');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Invalid image dimensions');
    // Guide the officer to centre the plate; crop the outer edges and bound
    // dimensions before OCR/upload. Canvas encoding strips original metadata.
    const sourceWidth = Math.max(1, Math.round(bitmap.width * 0.9));
    const sourceHeight = Math.max(1, Math.round(bitmap.height * 0.7));
    const scale = Math.min(1, 1600 / sourceWidth, 1000 / sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.drawImage(bitmap, Math.floor((bitmap.width - sourceWidth) / 2),
      Math.floor((bitmap.height - sourceHeight) / 2), sourceWidth, sourceHeight,
      0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!image || image.type !== 'image/jpeg' || image.size < 1 || image.size > MAX_EVIDENCE_BYTES) {
      throw new Error('Image too large');
    }
    return image;
  } finally { bitmap.close(); }
}

type PaddleItem = { text: string; score: number };

export function plateCandidate(text: string): string | null {
  const candidate = text.toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim().replace(/\s+/g, ' ');
  const compact = candidate.replace(/[ -]/g, '');
  return candidate.length <= 64 && compact.length >= 4 && compact.length <= 32
    && /[A-Z]/.test(compact) && /[0-9]/.test(compact) ? candidate : null;
}

export function selectPlateCandidate(items: readonly PaddleItem[]): { candidate: string; confidence: number | null } | null {
  const candidates = items.map(item => ({ candidate: plateCandidate(item.text), score: item.score }))
    .filter((item): item is { candidate: string; score: number } => item.candidate !== null)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) return { candidate: best.candidate,
    confidence: Number.isFinite(best.score) && best.score >= 0 && best.score <= 1 ? best.score : null };
  // A detection model can split one plate into adjacent letter and number regions.
  if (items.length < 2 || items.length > 3) return null;
  const candidate = plateCandidate(items.map(item => item.text).join(''));
  if (!candidate) return null;
  const scores = items.map(item => item.score);
  const confidence = scores.every(score => Number.isFinite(score) && score >= 0 && score <= 1)
    ? Math.min(...scores) : null;
  return { candidate, confidence };
}

type PaddleEngine = { predict: (image: Blob) => Promise<Array<{ items: PaddleItem[] }>>;
  dispose: () => Promise<void> | void };

export function paddleOcrOptions(origin: string): PaddleOCRCreateOptions {
  return {
    ocrVersion: 'PP-OCRv5',
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textDetectionModelAsset: { url: `${origin}/ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar` },
    textRecognitionModelName: 'PP-OCRv5_mobile_rec',
    textRecognitionModelAsset: { url: `${origin}/ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar` },
    worker: true,
    ortOptions: { backend: 'wasm', wasmPaths: `${origin}/ocr-runtime/`, numThreads: 1, simd: true },
  };
}

async function loadPaddleEngine(): Promise<PaddleEngine> {
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
  return PaddleOCR.create(paddleOcrOptions(window.location.origin));
}

export function createPlateOcrService(
  loadEngine: () => Promise<PaddleEngine> = loadPaddleEngine,
  prepareImage: (file: File) => Promise<Blob> = reencodePlateImage,
): PlateOcrProvider {
  let enginePromise: Promise<PaddleEngine> | null = null;
  let disposed = false;
  const engine = async () => {
    if (!enginePromise) {
      const pending = loadEngine();
      const retryable = pending.catch(error => { if (enginePromise === retryable) enginePromise = null; throw error; });
      enginePromise = retryable;
    }
    return enginePromise;
  };
  return {
    async recognize(file: File, report: (phase: PlateOcrPhase) => void = () => {}): Promise<ProcessedPlateImage> {
      let image: Blob;
      try { image = await prepareImage(file); }
      catch { throw new PlateOcrError('invalid_image'); }
      report('loading_model');
      let instance: PaddleEngine;
      try { instance = await engine(); }
      catch { throw new PlateOcrError('model_unavailable'); }
      if (disposed) throw new PlateOcrError('model_unavailable');
      report('reading_plate');
      let result: { items: PaddleItem[] } | undefined;
      try { [result] = await instance.predict(image); }
      catch { throw new PlateOcrError('reading_failed'); }
      const selected = result && selectPlateCandidate(result.items);
      if (!selected) throw new PlateOcrError('no_plate');
      return { image, ...selected };
    },
    dispose() {
      disposed = true;
      const previous = enginePromise;
      enginePromise = null;
      if (previous) void previous.then(instance => instance.dispose()).catch(() => {});
    },
    resume() { disposed = false; },
  };
}
