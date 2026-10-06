import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

const frontendFiles = sourceFiles('src');
for (const path of frontendFiles) {
  const source = readFileSync(path, 'utf8');
  assert(!source.includes('TripClosureInvoiceModal'), `Removed completion modal reference remains in ${path}`);
  assert(!source.includes('send-invoice-email'), `Direct invoice-email caller remains in ${path}`);
}

assert(!existsSync('src/components/operations/TripClosureInvoiceModal.tsx'));
assert(!existsSync('src/services/emailService.ts'));
assert(!existsSync('supabase/functions/send-invoice-email/index.ts'));
const config = readFileSync('supabase/config.toml', 'utf8');
assert(!config.includes('[functions.send-invoice-email]'));

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert(!packageJson.dependencies.jspdf, 'jsPDF should be removed with its only feature');
assert(packageJson.dependencies['tesseract.js'], 'Tesseract remains an OCR dependency');

const waybillService = readFileSync('src/features/operations/services/operationsWaybills.ts', 'utf8');
assert.match(waybillService, /storage\.from\(['"]waybills['"]\)\.download/);
const notificationWorker = readFileSync('supabase/functions/process-trip-notifications/worker.ts', 'utf8');
assert(notificationWorker.includes('claim_trip_notifications'));
assert(notificationWorker.includes('finish_trip_notification'));
assert(notificationWorker.includes('enqueue_waybill_ready_notifications'));
assert(notificationWorker.includes('Idempotency-Key'));
const pdfWorker = readFileSync('supabase/functions/process-waybill-pdfs/worker.ts', 'utf8');
assert(pdfWorker.includes('claim_waybill_pdf_jobs'));
assert(pdfWorker.includes('get_waybill_pdf_snapshot'));

const unchangedOcrFiles = [
  'src/features/loading/services/plateOcr.ts',
  'src/features/loading/components/PlateCapture.tsx',
  'src/services/ocrService.ts',
  'supabase/functions/ocr-extract/index.ts',
];
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...unchangedOcrFiles]);
console.log('PASS removed browser invoice/email path; authenticated Waybill and backend workers remain; OCR files unchanged');
