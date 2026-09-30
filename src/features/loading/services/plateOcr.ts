import { PlateOcrError, type PlateOcrPhase, type ProcessedPlateImage } from '../utils/plateCaptureController';
import { recognizeLicensePlate } from '../../../services/ocrService';
import { supabase } from '../../../services/supabase';
import type { Truck } from '../../../types';


const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

async function reencodePlateImage(file: File): Promise<Blob> {
  if ((file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp')
    || file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('Invalid image');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Invalid image dimensions');
    // Scale image if larger than 1600px while preserving 100% of the field of view
    // so vehicle and license plate detectors receive the full uncropped frame.
    const scale = Math.min(1, 1600 / bitmap.width, 1600 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!image || image.type !== 'image/jpeg' || image.size < 1 || image.size > MAX_EVIDENCE_BYTES) {
      throw new Error('Image too large');
    }
    return image;
  } finally { bitmap.close(); }
}

export function plateCandidate(text: string): string | null {
  const candidate = text.toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim().replace(/\s+/g, ' ');
  const compact = candidate.replace(/[ -]/g, '');
  return candidate.length <= 64 && compact.length >= 4 && compact.length <= 32
    && /[A-Z]/.test(compact) && /[0-9]/.test(compact) ? candidate : null;
}

type PaddleItem = { text: string; score: number };

export function selectPlateCandidate(items: readonly PaddleItem[]): { candidate: string; confidence: number | null } | null {
  const candidates = items.map(item => ({ candidate: plateCandidate(item.text), score: item.score }))
    .filter((item): item is { candidate: string; score: number } => item.candidate !== null)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) return { candidate: best.candidate,
    confidence: Number.isFinite(best.score) && best.score >= 0 && best.score <= 1 ? best.score : null };
  if (items.length < 2 || items.length > 3) return null;
  const candidate = plateCandidate(items.map(item => item.text).join(''));
  if (!candidate) return null;
  const scores = items.map(item => item.score);
  const confidence = scores.every(score => Number.isFinite(score) && score >= 0 && score <= 1)
    ? Math.min(...scores) : null;
  return { candidate, confidence };
}

let cachedFleet: Truck[] | null = null;
let lastFleetFetch = 0;

async function getRegisteredFleet(): Promise<Truck[]> {
  const now = Date.now();
  if (cachedFleet && (now - lastFleetFetch < 60_000)) {
    return cachedFleet;
  }
  if (!supabase) return cachedFleet || [];
  try {
    const { data } = await supabase.from('trucks').select('*').eq('is_active', true);
    if (data && Array.isArray(data)) {
      cachedFleet = data as Truck[];
      lastFleetFetch = now;
      return cachedFleet;
    }
  } catch {
    // Fleet query error is non-fatal for OCR
  }
  return cachedFleet || [];
}

export function createPlateOcrService(
  prepareImage: (file: File) => Promise<Blob> = reencodePlateImage,
) {
  let disposed = false;
  return {
    async recognize(file: File, report: (phase: PlateOcrPhase) => void = () => {}): Promise<ProcessedPlateImage> {
      return this.process(file, report);
    },
    async process(file: File, report: (phase: PlateOcrPhase) => void = () => {}): Promise<ProcessedPlateImage> {
      let image: Blob;
      try {
        image = await prepareImage(file);
      } catch {
        throw new PlateOcrError('invalid_image');
      }

      if (disposed) throw new PlateOcrError('model_unavailable');

      report('loading_model');
      let fleet: Truck[] = [];
      try {
        fleet = await getRegisteredFleet();
      } catch {
        // Fallback to syntactic matching without registered fleet
      }

      report('reading_plate');
      let result;
      try {
        result = await recognizeLicensePlate(image, fleet, (progress) => {
          if (progress.progress < 0.3) {
            report('loading_model');
          } else {
            report('reading_plate');
          }
        });
      } catch (err) {
        console.error('[OCR Recognition Error]:', err);
        if (disposed) throw new PlateOcrError('model_unavailable');
        throw new PlateOcrError('reading_failed');
      }

      console.log('[OCR Process Result]:', result);
      if (disposed) throw new PlateOcrError('model_unavailable');

      if (!result || !result.candidatePlate || result.candidatePlate === 'UNREADABLE') {
        throw new PlateOcrError('no_plate');
      }

      const rawConf = typeof result.confidence === 'number' && Number.isFinite(result.confidence)
        ? (result.confidence > 1 ? result.confidence / 100 : result.confidence)
        : null;
      const confidence = rawConf !== null ? Math.min(1, Math.max(0, rawConf)) : null;

      return {
        image,
        candidate: result.candidatePlate,
        confidence,
      };
    },
    dispose() {
      disposed = true;
    },
    resume() {
      disposed = false;
    },
  };
}

