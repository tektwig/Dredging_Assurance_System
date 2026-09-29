import { createWorker, PSM } from 'tesseract.js';
import { Truck } from '../types';
import { isSupabaseLive, supabase } from './supabase';

export interface OCRProgress {
  status: string;
  progress: number;
}

export interface PlateRecognitionResult {
  rawText: string;
  candidatePlate: string;
  normalizedPlate: string;
  confidence: number;
  isRecognizedMasterPlate: boolean;
  matchType: 'EXACT_FLEET' | 'FUZZY_FLEET' | 'SYNTACTIC_VALID' | 'FALLBACK';
  matchedTruck?: Truck;
  preprocessedImageUrl?: string;
}

/**
 * Common Nigerian plate banner words and noise phrases to filter out
 */
const NOISE_WORDS = [
  'FEDERAL', 'REPUBLIC', 'NIGERIA', 'CENTRE', 'EXCELLENCE',
  'LAGOS', 'OGUN', 'COMMERCIAL', 'HAULAGE', 'STATE', 'DREDGING',
  'OF', 'THE', 'SAFETY', 'FIRST', 'GATE', 'DREDGE', 'MINING',
  'GREATER', 'HEARTBEAT', 'NATION', 'PEACE', 'PROGRESS'
];

// Lagos plate prefixes used to reject/correct OCR glyphs that cannot be LGA codes.
// One-character correction is deliberately conservative (for example WSF -> KSF).
const LAGOS_LGA_PREFIXES = [
  'AAA', 'AGL', 'AKD', 'APP', 'BDG', 'EKY', 'FST', 'GGE', 'JJJ', 'KJA',
  'KSF', 'LND', 'LSR', 'MUS', 'OJO', 'SMK', 'SSD', 'TUN',
];

function correctPlatePrefix(prefix: string): string {
  if (LAGOS_LGA_PREFIXES.includes(prefix)) return prefix;

  let closest = prefix;
  let distance = Number.POSITIVE_INFINITY;
  for (const known of LAGOS_LGA_PREFIXES) {
    const currentDistance = [...known].filter((char, index) => char !== prefix[index]).length;
    if (currentDistance < distance) {
      closest = known;
      distance = currentDistance;
    }
  }

  return distance === 1 ? closest : prefix;
}

interface CloudANPRResult {
  success?: boolean;
  extractedPlate?: string | null;
  confidence?: number;
  rawText?: string;
  source?: string;
}

async function imageSourceToDataUrl(imageSource: File | Blob | string): Promise<string | null> {
  if (typeof imageSource === 'string') {
    return imageSource.startsWith('data:image/') ? imageSource : null;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => reject(reader.error || new Error('Unable to read plate image'));
    reader.readAsDataURL(imageSource);
  });
}

async function recognizeWithCloudANPR(
  imageSource: File | Blob | string,
  registeredTrucks: Truck[]
): Promise<PlateRecognitionResult | null> {
  const imageBase64 = await imageSourceToDataUrl(imageSource);
  if (!imageBase64) return null;

  const clientToken = (import.meta.env.VITE_PLATE_RECOGNIZER_TOKEN as string | undefined)?.trim();

  // Option A: Direct Plate Recognizer call if client token is present in .env
  if (clientToken && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      console.log('[OCR] Invoking Plate Recognizer with VITE_PLATE_RECOGNIZER_TOKEN...');
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
      const binary = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
      const formData = new FormData();
      formData.append('upload', new Blob([binary], { type: 'image/jpeg' }), 'plate.jpg');
      formData.append('regions', 'ng');

      const response = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
        method: 'POST',
        headers: { Authorization: `Token ${clientToken}` },
        body: formData,
      });

      if (response.ok) {
        const alprData = await response.json();
        const result = alprData?.results?.[0];
        if (result?.plate) {
          const rawPlate = String(result.plate).toUpperCase().trim();
          console.log('[OCR] Plate Recognizer direct response:', rawPlate, result);

          const extraction = extractNigerianPlateFromText(rawPlate, registeredTrucks);
          const cleanPlate = rawPlate.replace(/[^A-Z0-9]/g, '');

          // Standard Nigerian plate formatting: AAA-123-AA
          let candidate = rawPlate;
          if (cleanPlate.length >= 7 && cleanPlate.length <= 9) {
            const prefix = cleanPlate.slice(0, 3);
            const suffix = cleanPlate.slice(-2);
            const middle = cleanPlate.slice(3, -2);
            if (/^[A-Z]{3}$/.test(prefix) && /^\d{2,4}$/.test(middle) && /^[A-Z]{2}$/.test(suffix)) {
              candidate = `${prefix}-${middle}-${suffix}`;
            }
          }

          const finalCandidate = extraction.matchType !== 'FALLBACK' ? extraction.candidatePlate : candidate;
          const finalNormalized = extraction.matchType !== 'FALLBACK' ? extraction.normalizedPlate : cleanPlate;

          return {
            rawText: rawPlate,
            candidatePlate: finalCandidate,
            normalizedPlate: finalNormalized,
            confidence: Math.min(99, Math.max(75, Math.round(Number(result.score || 0.95) * 100))),
            isRecognizedMasterPlate: !!extraction.matchedTruck,
            matchType: extraction.matchType !== 'FALLBACK' ? extraction.matchType : 'SYNTACTIC_VALID',
            matchedTruck: extraction.matchedTruck,
          };
        }
      }
    } catch (clientErr) {
      console.warn('[OCR] Direct Plate Recognizer call error:', clientErr);
    }
  }

  // Option B: Supabase Edge Function 'ocr-extract'
  if (!isSupabaseLive || !supabase || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;

  try {
    console.log('[OCR] Calling Supabase Edge Function: ocr-extract...');
    const { data, error } = await supabase.functions.invoke<CloudANPRResult>('ocr-extract', {
      body: {
        imageBase64,
        filename: imageSource instanceof File ? imageSource.name : 'plate.jpg',
        token: clientToken || undefined,
      },
    });

    if (error) {
      console.warn('[OCR] Supabase Edge Function ocr-extract unavailable:', error.message);
      return null;
    }

    if (!data?.success || !data.extractedPlate) {
      console.warn('[OCR] ocr-extract reported no plate:', data);
      return null;
    }

    const rawPlate = String(data.extractedPlate).toUpperCase().trim();
    console.log('[OCR] ocr-extract success:', rawPlate);
    const extraction = extractNigerianPlateFromText(rawPlate, registeredTrucks);
    const cleanPlate = rawPlate.replace(/[^A-Z0-9]/g, '');

    let candidate = rawPlate;
    if (cleanPlate.length >= 7 && cleanPlate.length <= 9) {
      const prefix = cleanPlate.slice(0, 3);
      const suffix = cleanPlate.slice(-2);
      const middle = cleanPlate.slice(3, -2);
      if (/^[A-Z]{3}$/.test(prefix) && /^\d{2,4}$/.test(middle) && /^[A-Z]{2}$/.test(suffix)) {
        candidate = `${prefix}-${middle}-${suffix}`;
      }
    }

    return {
      rawText: data.rawText || rawPlate,
      candidatePlate: extraction.matchType !== 'FALLBACK' ? extraction.candidatePlate : candidate,
      normalizedPlate: extraction.matchType !== 'FALLBACK' ? extraction.normalizedPlate : cleanPlate,
      confidence: Math.min(99, Math.max(70, Math.round(data.confidence || 90))),
      isRecognizedMasterPlate: !!extraction.matchedTruck,
      matchType: extraction.matchType !== 'FALLBACK' ? extraction.matchType : 'SYNTACTIC_VALID',
      matchedTruck: extraction.matchedTruck,
    };
  } catch (err) {
    console.warn('[OCR] Cloud ANPR invocation error:', err);
    return null;
  }
}

/**
 * Disambiguates letter and digit confusion by position in standard Nigerian plate:
 * Positions 0..2: MUST be letters (LGA Code)
 * Positions 3..n-2: MUST be digits (Sequential Number)
 * Positions n-2..n: MUST be letters (Series Suffix)
 */
export function normalizePlateStructure(candidate: string): { formatted: string; normalized: string } | null {
  const clean = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 7 || clean.length > 9) return null;

  const prefixLen = 3;
  const suffixLen = 2;
  const middleLen = clean.length - prefixLen - suffixLen;

  if (middleLen < 2 || middleLen > 4) return null;

  const rawPrefix = clean.substring(0, prefixLen);
  const rawMiddle = clean.substring(prefixLen, prefixLen + middleLen);
  const rawSuffix = clean.substring(clean.length - suffixLen);

  // Position 1..3: Strictly letters
  const prefix = correctPlatePrefix(rawPrefix
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B')
    .replace(/5/g, 'S')
    .replace(/2/g, 'Z')
    .replace(/6/g, 'G')
    .replace(/4/g, 'A'));

  // Middle positions: Strictly digits
  const middle = rawMiddle
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/B/g, '8')
    .replace(/S/g, '5')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
    .replace(/A/g, '4')
    .replace(/D/g, '0')
    .replace(/Q/g, '0');

  // Suffix positions: Strictly letters
  const suffix = rawSuffix
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B')
    .replace(/5/g, 'S')
    .replace(/2/g, 'Z')
    .replace(/6/g, 'G')
    .replace(/4/g, 'A');

  // Do not accept leftover letters in the numeric run (or digits in letter runs).
  // The previous implementation formatted these malformed candidates as valid plates.
  if (!/^[A-Z]{3}$/.test(prefix) || !/^\d{2,4}$/.test(middle) || !/^[A-Z]{2}$/.test(suffix)) {
    return null;
  }

  return {
    formatted: `${prefix}-${middle}-${suffix}`,
    normalized: `${prefix}${middle}${suffix}`,
  };
}

/**
 * Calculate Levenshtein string similarity score between 0.0 and 1.0
 */
export function calculateSimilarity(s1: string, s2: string): number {
  const a = s1.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const b = s2.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0;

  const track: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) track[0][i] = i;
  for (let j = 0; j <= b.length; j++) track[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + cost
      );
    }
  }

  const distance = track[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);
  return (maxLen - distance) / maxLen;
}

/**
 * Preprocess image in browser to optimize contrast, sharpness, and resolution for Tesseract OCR
 */
export async function preprocessImageForOCR(imageSource: File | Blob | string): Promise<string> {
  return new Promise((resolve) => {
    // If running in environment without DOM, return source as is
    if (typeof document === 'undefined') {
      resolve(typeof imageSource === 'string' ? imageSource : '');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    let objectUrl = '';
    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      objectUrl = URL.createObjectURL(imageSource);
      img.src = objectUrl;
    }

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 1600;
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        const isExtremePortrait = sourceHeight > sourceWidth * 1.6;

        // Only apply vehicle band crop if the photo is an extreme full-height portrait capture.
        // For standard or close-up captures, preserve the full image to avoid cutting out the plate.
        const crop = isExtremePortrait
          ? {
              x: Math.round(sourceWidth * 0.05),
              y: Math.round(sourceHeight * 0.50),
              width: Math.round(sourceWidth * 0.90),
              height: Math.round(sourceHeight * 0.35),
            }
          : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

        let width = crop.width;
        let height = crop.height;

        // Downscale large camera photos for speed and memory efficiency
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        } else if (height < 320) {
          const scale = Math.min(2.5, maxDim / width);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(typeof imageSource === 'string' ? imageSource : '');
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);

        // Dynamic contrast stretch & grayscale conversion (preserves anti-aliased glyph strokes for Tesseract)
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        let minLuma = 255;
        let maxLuma = 0;
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          if (gray < minLuma) minLuma = gray;
          if (gray > maxLuma) maxLuma = gray;
        }

        const lumaRange = Math.max(20, maxLuma - minLuma);
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const enhanced = Math.min(255, Math.max(0, Math.round(((gray - minLuma) / lumaRange) * 255)));
          data[i] = enhanced;
          data[i + 1] = enhanced;
          data[i + 2] = enhanced;
        }

        ctx.putImageData(imageData, 0, 0);

        const processedUrl = canvas.toDataURL('image/jpeg', 0.9);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(processedUrl);
      } catch (err) {
        console.warn('Preprocessing canvas warning, falling back to original:', err);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(typeof imageSource === 'string' ? imageSource : '');
      }
    };

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(typeof imageSource === 'string' ? imageSource : '');
    };
  });
}

/**
 * Multi-pattern Nigerian plate extractor from OCR raw text output
 */
export function extractNigerianPlateFromText(
  rawText: string,
  fleet: Truck[]
): {
  candidatePlate: string;
  normalizedPlate: string;
  confidence: number;
  matchType: 'EXACT_FLEET' | 'FUZZY_FLEET' | 'SYNTACTIC_VALID' | 'FALLBACK';
  matchedTruck?: Truck;
} {
  // Step 1: Clean raw text and filter known noise phrases
  let text = rawText.toUpperCase();
  for (const word of NOISE_WORDS) {
    const reg = new RegExp(`\\b${word}\\b`, 'gi');
    text = text.replace(reg, ' ');
  }
  const cleaned = text.replace(/[^A-Z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter((w) => w.length >= 2);

  const candidateList: { formatted: string; normalized: string }[] = [];

  const addCandidateWindows = (value: string) => {
    const compact = value.replace(/[^A-Z0-9]/g, '');
    for (const length of [8, 7, 9]) {
      for (let start = 0; start <= compact.length - length; start++) {
        const parsed = normalizePlateStructure(compact.slice(start, start + length));
        if (parsed && !candidateList.some((item) => item.normalized === parsed.normalized)) {
          candidateList.push(parsed);
        }
      }
    }
  };

  // OCR often adds one character at an edge. Sliding valid-length
  // windows recovers the plate rather than treating the entire noisy token as one.
  words.forEach(addCandidateWindows);
  const compactLine = cleaned.replace(/[^A-Z0-9]/g, '');
  if (compactLine.length <= 12) addCandidateWindows(compactLine);

  // Strategy A: Check 3-token sequences (e.g. ["APP", "482", "XA"] or ["AP8", "4B2", "XA"])
  for (let i = 0; i <= words.length - 3; i++) {
    const combined = words[i] + words[i + 1] + words[i + 2];
    const parsed = normalizePlateStructure(combined);
    if (parsed) candidateList.push(parsed);
  }

  // Strategy B: Check 2-token sequences (e.g. ["APP482", "XA"] or ["APP", "482XA"])
  for (let i = 0; i <= words.length - 2; i++) {
    const combined = words[i] + words[i + 1];
    const parsed = normalizePlateStructure(combined);
    if (parsed) candidateList.push(parsed);
  }

  // Strategy C: Check individual OCR tokens with or without separators.
  for (const word of words) {
    const parsed = normalizePlateStructure(word);
    if (parsed) candidateList.push(parsed);
  }

  // Strategy D: Regex scan across cleaned lines
  const regexPattern = /\b([A-Z0-9]{2,3})[\s\-_.:]*([A-Z0-9]{2,4})[\s\-_.:]*([A-Z0-9]{2,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regexPattern.exec(cleaned)) !== null) {
    const combined = match[1] + match[2] + match[3];
    const parsed = normalizePlateStructure(combined);
    if (parsed) candidateList.push(parsed);
  }

  // Step 2: Cross-reference with registered fleet (BRD FR-08 & BR-01)
  let bestCandidate: { formatted: string; normalized: string } | null = candidateList[0] || null;
  let bestMatchTruck: Truck | undefined;
  let highestSim = 0;

  for (const cand of candidateList) {
    // Exact fleet match
    const exact = fleet.find((t) => t.normalized_registration === cand.normalized);
    if (exact) {
      return {
        candidatePlate: exact.registration_number,
        normalizedPlate: exact.normalized_registration,
        matchedTruck: exact,
        confidence: 98,
        matchType: 'EXACT_FLEET',
      };
    }

    // Fuzzy fleet match
    for (const truck of fleet) {
      const sim = calculateSimilarity(cand.normalized, truck.normalized_registration);
      if (sim > highestSim) {
        highestSim = sim;
        bestCandidate = cand;
        bestMatchTruck = truck;
      }
    }
  }

  // Also check direct text substring against fleet in case token splitting was disjointed
  if (!bestMatchTruck || highestSim < 0.8) {
    const noSpaceCleaned = cleaned.replace(/[^A-Z0-9]/g, '');
    for (const truck of fleet) {
      if (noSpaceCleaned.includes(truck.normalized_registration)) {
        return {
          candidatePlate: truck.registration_number,
          normalizedPlate: truck.normalized_registration,
          matchedTruck: truck,
          confidence: 96,
          matchType: 'EXACT_FLEET',
        };
      }
      const subSim = calculateSimilarity(noSpaceCleaned.slice(0, 12), truck.normalized_registration);
      if (subSim > highestSim) {
        highestSim = subSim;
        bestMatchTruck = truck;
      }
    }
  }

  if (highestSim >= 0.875 && bestMatchTruck) {
    return {
      candidatePlate: bestMatchTruck.registration_number,
      normalizedPlate: bestMatchTruck.normalized_registration,
      matchedTruck: bestMatchTruck,
      confidence: Math.round(highestSim * 100),
      matchType: 'FUZZY_FLEET',
    };
  }

  // Syntactically valid plate but not currently registered in the local fleet (Exception BR-01)
  if (bestCandidate) {
    return {
      candidatePlate: bestCandidate.formatted,
      normalizedPlate: bestCandidate.normalized,
      matchedTruck: undefined,
      confidence: 84,
      matchType: 'SYNTACTIC_VALID',
    };
  }

  // Fallback if OCR returned raw words that couldn't be strictly formatted
  const fallbackText = words.slice(0, 3).join('-') || cleaned.slice(0, 10) || 'UNREADABLE';
  return {
    candidatePlate: fallbackText,
    normalizedPlate: fallbackText.replace(/[^A-Z0-9]/g, ''),
    matchedTruck: undefined,
    confidence: 45,
    matchType: 'FALLBACK',
  };
}

/**
 * Performs client-side OCR recognition on an image file, blob, or base64 URL
 * with automatic image contrast preprocessing and Nigerian ANPR heuristic parsing.
 */
export async function recognizeLicensePlate(
  imageSource: File | Blob | string,
  registeredTrucks: Truck[],
  onProgress?: (progress: OCRProgress) => void
): Promise<PlateRecognitionResult> {
  onProgress?.({ status: 'Checking precision cloud ANPR...', progress: 0.05 });

  try {
    const cloudResult = await recognizeWithCloudANPR(imageSource, registeredTrucks);
    if (cloudResult) {
      onProgress?.({ status: 'Precision ANPR recognition complete', progress: 1 });
      return cloudResult;
    }
  } catch (error) {
    console.warn('Cloud ANPR unavailable; using on-device recognition:', error);
  }

  onProgress?.({ status: 'Optimizing plate image contrast & resolution...', progress: 0.1 });

  // Preprocess image
  const preprocessedUrl = await preprocessImageForOCR(imageSource);

  onProgress?.({ status: 'Loading Tesseract WebAssembly engine...', progress: 0.25 });

  let worker;
  try {
    worker = await createWorker('eng', 1, {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          onProgress?.({
            status: `Analyzing plate characters (${Math.round((m.progress || 0) * 100)}%)...`,
            progress: 0.3 + (m.progress || 0) * 0.6,
          });
        }
      },
    });

    // Whitelist uppercase letters, digits, dashes and spaces to prevent punctuation noise
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -',
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: '300',
    });

    onProgress?.({ status: 'Extracting plate text...', progress: 0.65 });

    const ret = await worker.recognize(preprocessedUrl || imageSource);
    const rawText = ret.data.text || '';

    await worker.terminate();

    onProgress?.({ status: 'Disambiguating Nigerian ANPR pattern...', progress: 0.95 });

    const extraction = extractNigerianPlateFromText(rawText, registeredTrucks);

    onProgress?.({ status: 'Recognition complete', progress: 1.0 });

    return {
      rawText: rawText.trim(),
      candidatePlate: extraction.candidatePlate,
      normalizedPlate: extraction.normalizedPlate,
      confidence: extraction.confidence,
      isRecognizedMasterPlate: !!extraction.matchedTruck,
      matchType: extraction.matchType,
      matchedTruck: extraction.matchedTruck,
      preprocessedImageUrl: preprocessedUrl,
    };
  } catch (err) {
    if (worker) {
      try {
        await worker.terminate();
      } catch (_) {
        // ignore
      }
    }
    throw err;
  }
}
