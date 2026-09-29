import type { OpenTripReview } from '../types';
import { platePreview } from './operationalDate';

export function captureMethod(review: OpenTripReview): 'MANUAL' | 'OCR' | 'OCR_CORRECTED' {
  if (!review.capture) return 'MANUAL';
  return platePreview(review.plate) === platePreview(review.capture.candidate) ? 'OCR' : 'OCR_CORRECTED';
}
