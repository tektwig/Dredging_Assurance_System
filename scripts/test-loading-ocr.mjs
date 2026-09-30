// Browser workflow contract tests with mocked OCR and Supabase. No network or database writes.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const overrides = new Map();
const cache = new Map();
function load(path) {
  const full = resolve(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const source = readFileSync(full, 'utf8').replaceAll('import.meta.env', '(globalThis.__testEnv || { DEV: true })');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const { plateCandidate, selectPlateCandidate, paddleOcrOptions, createPlateOcrService } =
  load('src/features/loading/services/plateOcr.ts');
assert.equal(plateCandidate('ABC-123\n'), 'ABC-123');
assert.equal(plateCandidate('###'), null);
assert.equal(plateCandidate('COMPANY NAME'), null);
assert.deepEqual(selectPlateCandidate([{ text: 'ABC-123', score: 0.83 },
  { text: 'XYZ-999', score: 0.65 }]), { candidate: 'ABC-123', confidence: 0.83 });
assert.deepEqual(selectPlateCandidate([{ text: 'ABC-', score: 0.92 },
  { text: '123', score: 0.77 }]), { candidate: 'ABC-123', confidence: 0.77 });
assert.equal(selectPlateCandidate([{ text: 'GARAGE', score: 0.99 }]), null);
const sdkOptions = paddleOcrOptions('https://loading.example');
assert.equal(sdkOptions.ocrVersion, 'PP-OCRv5');
assert.equal(sdkOptions.worker, true);
assert.equal(sdkOptions.textDetectionModelAsset.url,
  'https://loading.example/ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar');
assert.equal(sdkOptions.textRecognitionModelAsset.url,
  'https://loading.example/ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar');
assert.deepEqual(sdkOptions.ortOptions,
  { backend: 'wasm', wasmPaths: 'https://loading.example/ocr-runtime/', numThreads: 1, simd: true });
assert(existsSync(resolve('public/ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar')));
assert(existsSync(resolve('public/ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar')));
assert(existsSync(resolve('public/ocr-runtime/ort-wasm-simd-threaded.wasm')));
assert(existsSync(resolve('public/ocr-runtime/ort-wasm-simd-threaded.jsep.mjs')));
assert(existsSync(resolve('public/ocr-runtime/ort-wasm-simd-threaded.jsep.wasm')));
assert.equal(require(resolve('package.json')).dependencies['tesseract.js'], undefined);
const localOcr = createPlateOcrService();
await assert.rejects(localOcr.recognize(new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })));
localOcr.dispose();
let paddleDisposed = false;
const prepared = new Blob(['cropped-image'], { type: 'image/jpeg' });
const mockPaddle = createPlateOcrService(async () => ({
  async predict(input) { assert.equal(input, prepared); return [{ items: [
    { text: 'ABC-123', score: 0.88 }, { text: 'GARAGE', score: 0.99 },
  ] }]; },
  async dispose() { paddleDisposed = true; },
}), async () => prepared);
assert.deepEqual(await mockPaddle.recognize(new File(['original'], 'plate.png', { type: 'image/png' })),
  { image: prepared, candidate: 'ABC-123', confidence: 0.88 });
mockPaddle.dispose();
await Promise.resolve();
assert.equal(paddleDisposed, true);
const { PlateCaptureController } = load('src/features/loading/utils/plateCaptureController.ts');
const jpeg = new Blob(['plate-image'], { type: 'image/jpeg' });
const file = new File(['original'], 'capture.jpg', { type: 'image/jpeg' });
let pending = [];
let prefills = [];
let captureState;
let ids = 0;
const capture = new PlateCaptureController('actor-a', { recognize: () => new Promise(resolve => pending.push(resolve)), dispose() {}, resume() {} },
  value => { captureState = value; }, value => prefills.push(value), () => `capture-${++ids}`,
  () => '2026-09-25T09:00:00.000Z');
const old = capture.capture(file);
assert.deepEqual(captureState, { status: 'processing', phase: 'preparing_image' });
const current = capture.capture(file);
pending[1]({ image: jpeg, candidate: 'ABC-123', confidence: 0.83 });
await current;
pending[0]({ image: jpeg, candidate: 'OLD-999', confidence: 0.7 });
await old;
assert.equal(captureState.evidence.candidate, 'ABC-123');
assert.deepEqual(prefills, ['ABC-123']);
const imagePath = captureState.evidence.imagePath;
assert.equal(imagePath, 'actor-a/capture-2.jpg');
const late = capture.capture(file);
capture.cancelPending();
pending[2]({ image: jpeg, candidate: 'LATE-999', confidence: 0.7 });
await late;
assert.equal(captureState.status, 'idle');
assert.deepEqual(prefills, ['ABC-123']);
const failed = capture.capture(file);
pending[3]({ image: jpeg, candidate: '', confidence: null });
await failed;
assert.equal(captureState.status, 'error');
assert.equal(captureState.reason, 'reading_failed');
capture.clear();
assert.equal(captureState.status, 'idle');
const phases = [];
const modelFailure = createPlateOcrService(async () => { throw new Error('private runtime detail'); },
  async () => jpeg);
await assert.rejects(modelFailure.recognize(file, phase => phases.push(phase)), { reason: 'model_unavailable' });
assert.deepEqual(phases, ['loading_model']);
modelFailure.dispose();
console.log('PASS local OCR candidate extraction, recapture race and failed OCR retry state');

const { captureMethod } = load('src/features/loading/utils/captureMethod.ts');
const baseReview = { plate: 'ABC-123', truck: { id: 'truck-a', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true },
  actualDriver: { id: 'driver-a', fullName: 'Driver A', phoneNumber: '08011111111', email: null, isActive: true },
  regularDriverId: 'driver-a', site: { assignmentId: 'site-assignment', siteId: 'site-a', siteName: 'Site A' }, makeRegular: false,
  estimatedQuantityTonnes: 18.25 };
const evidence = { id: 'capture-a', imagePath: 'actor-a/capture-a.jpg', image: jpeg,
  candidate: 'ABC-123', confidence: 0.83, capturedAt: '2026-09-25T09:00:00.000Z' };
assert.equal(captureMethod({ ...baseReview, capture: evidence }), 'OCR');
assert.equal(captureMethod({ ...baseReview, plate: 'ABC 123', capture: evidence }), 'OCR');

const calls = [];
let rpcError = null;
let uploadError = null;
let stored = jpeg;
let rpcRequest;
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  from(table) { assert.fail(`Unexpected direct table access: ${table}`); },
  storage: { from(bucket) { assert.equal(bucket, 'loading-plate-evidence'); return {
    async upload(path, body, options) { calls.push({ kind: 'upload', path, body, options }); return { data: null, error: uploadError }; },
    async download(path) { calls.push({ kind: 'download', path }); return { data: stored, error: null }; },
  }; } },
  async rpc(name, args) { assert.equal(name, 'create_loading_trip_v2'); calls.push({ kind: 'rpc', args });
    return { data: rpcRequest ? responseFor(rpcRequest) : null, error: rpcError }; },
} });
function responseFor(request) {
  const review = request.review;
  return { ok: true, request_id: request.requestId,
    trip: { id: 'trip-a', trip_number: 'TRP-0001', status: 'open', truck_id: review.truck.id,
      driver_id: review.actualDriver.id, driver_name_at_loading: review.actualDriver.fullName,
      daily_registration_id: 'daily-a', loading_site_id: review.site.siteId,
      loading_assignment_id: review.site.assignmentId, opened_at: '2026-09-25T09:05:00Z', opened_by: 'actor-a',
      quantity_tonnes: null, estimated_quantity_tonnes: review.estimatedQuantityTonnes },
    capture: { confirmed_plate: review.plate, normalized_confirmed_plate: review.plate.replace(/[ -]/g, ''),
      capture_method: captureMethod(review), image_recorded: true }, default_driver_changed: false };
}
const { openLoadingTrip } = load('src/features/loading/services/tripData.ts');
const manual = Object.freeze({ requestId: 'manual-a', capturedAt: '2026-09-25T09:05:00.000Z', review: baseReview });
rpcRequest = manual;
await assert.rejects(openLoadingTrip(manual), { message: 'Trip opening outcome unknown' });
assert.equal(calls.filter(call => call.kind === 'upload').length, 0);
assert.equal(calls.filter(call => call.kind === 'rpc').length, 0, 'request without OCR evidence cannot reach trip-opening RPC');
const ocrReview = { ...baseReview, capture: evidence };
const ocr = Object.freeze({ requestId: 'ocr-a', capturedAt: evidence.capturedAt, review: ocrReview });
rpcRequest = ocr;
assert.equal((await openLoadingTrip(ocr)).capture.captureMethod, 'OCR');
assert.equal(calls.at(-2).kind, 'upload');
assert.equal(calls.at(-2).path, evidence.imagePath);
assert.deepEqual(calls.at(-2).options, { contentType: 'image/jpeg', upsert: false });
assert.equal(calls.at(-1).args.p_ocr_confidence, 0.83);
assert.equal(calls.at(-1).args.p_image_path, evidence.imagePath);
assert.equal(calls.at(-1).args.p_captured_at, evidence.capturedAt);
assert.equal(calls.at(-1).args.p_estimated_quantity_tonnes, 18.25);
console.log('PASS OCR-only request payload, no typed-plate bypass and authoritative success parsing');

// An ambiguous RPC outcome leaves the uploaded image and frozen request intact.
const { OpenTripController } = load('src/features/loading/utils/openTripController.ts');
let sequence = 0;
const opening = new OpenTripController(async request => { rpcRequest = request; return openLoadingTrip(request); },
  () => {}, () => {}, () => {}, () => {}, () => `request-${++sequence}`,
  () => 'wrong-manual-timestamp');
opening.setInput(ocrReview);
opening.beginReview();
rpcError = { code: 'PGRST000' };
await opening.submit();
assert.equal(opening.current.status, 'ambiguous');
const frozen = opening.frozenRequest;
assert.equal(frozen.capturedAt, evidence.capturedAt);
const uploadsBeforeRetry = calls.filter(call => call.kind === 'upload').length;
rpcError = null;
await opening.submit();
assert.equal(opening.current.status, 'success');
assert.equal(rpcRequest, frozen);
assert.equal(calls.filter(call => call.kind === 'upload').length, uploadsBeforeRetry);
assert.equal(calls.at(-1).args.p_request_id, frozen.requestId);
assert.equal(calls.at(-1).args.p_captured_at, frozen.capturedAt);
opening.nextTruck();
assert.equal(opening.current.status, 'idle');
const nextCapture = { ...evidence, id: 'capture-next', imagePath: 'actor-a/capture-next.jpg',
  capturedAt: '2026-09-25T09:10:00.000Z' };
opening.setInput({ ...ocrReview, capture: nextCapture });
opening.beginReview();
await opening.submit();
assert.notEqual(rpcRequest.requestId, frozen.requestId, 'recapture starts a new logical request');
assert.equal(rpcRequest.capturedAt, nextCapture.capturedAt);
console.log('PASS ambiguous retry retains request ID, capture time, evidence and uploaded object');

// An ambiguous upload may have committed: same path, private download, byte check.
const collision = Object.freeze({ requestId: 'collision', capturedAt: evidence.capturedAt,
  review: { ...baseReview, capture: { ...evidence, id: 'capture-c', imagePath: 'actor-a/capture-c.jpg' } } });
rpcRequest = collision;
uploadError = { statusCode: '409' };
assert.equal((await openLoadingTrip(collision)).kind, 'success');
assert.equal(calls.at(-2).kind, 'download');
stored = new Blob(['other-image'], { type: 'image/jpeg' });
assert.equal(stored.size, jpeg.size, 'hash mismatch test must not pass from size alone');
const mismatch = Object.freeze({ ...collision, requestId: 'mismatch', review: {
  ...collision.review, capture: { ...collision.review.capture, id: 'capture-d', imagePath: 'actor-a/capture-d.jpg' },
} });
rpcRequest = mismatch;
await assert.rejects(openLoadingTrip(mismatch), { message: 'Trip opening outcome unknown' });
assert.equal(calls.at(-1).kind, 'download');
uploadError = null;
console.log('PASS duplicate upload resolves only when private stored bytes match');

const { PlateCapture } = load('src/features/loading/components/PlateCapture.tsx');
const { LoadingPortalView } = load('src/features/loading/components/LoadingPortalView.tsx');
const { reviewForSelection } = load('src/features/loading/utils/reviewSelection.ts');
assert.equal(reviewForSelection({ status: 'ready', site: baseReview.site },
  { state: { status: 'idle' }, pending: false }, null, 18.25, evidence), null);
const scanner = React.createElement(PlateCapture, { state: { status: 'detected', evidence }, disabled: false,
  onCapture() {}, onScanStart() {} });
const html = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  officerName: 'Officer', now: new Date('2026-09-25T09:00:00Z'),
  site: { status: 'ready', site: baseReview.site },
  statistics: { status: 'ready', statistics: { tripsOpened: 0, openTrips: 0, tripsClosed: 0, trucksProcessed: 0 } },
  estimatedTonnage: '', truckConfirmed: false,
  lookup: { state: { status: 'idle' }, pending: false },
  capturePanel: scanner, onLookup() {}, onConfirmTruck() {}, onCancelTruckWorkflow() {}, onEstimatedTonnageChange() {},
  onRetrySite() {}, onRetryStatistics() {},
}));
assert(html.includes('Plate scanner') && !html.includes('name="plate"'));
assert.match(html, /Scan Number Plate/);
assert(!html.includes('Choose Photo') && !html.includes('type="file"') && !html.includes('accept="image/'));
assert.match(html, /Detected plate/);
assert.match(html, /Looking up this candidate automatically/);
assert(!html.includes('Find Truck'));
assert(!html.includes('Correct recognized plate') && !html.includes('Correct plate') && !html.includes('Enter plate manually'));
const completedHtml = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  officerName: 'Officer', now: new Date('2026-09-25T09:00:00Z'),
  site: { status: 'ready', site: baseReview.site }, statistics: { status: 'error' },
  estimatedTonnage: '', truckConfirmed: false,
  lookup: { state: { status: 'idle' }, pending: false },
  capturePanel: scanner, tripStage: 'success', onLookup() {}, onConfirmTruck() {}, onCancelTruckWorkflow() {}, onEstimatedTonnageChange() {},
  onRetrySite() {}, onRetryStatistics() {},
}));
assert(!completedHtml.includes('Detected plate'), 'completed workspace must not show stale scanner instructions');
const selectedTruckHtml = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  officerName: 'Officer', now: new Date('2026-09-25T09:00:00Z'),
  site: { status: 'ready', site: baseReview.site }, statistics: { status: 'error' },
  estimatedTonnage: '', truckConfirmed: true, lookup: { state: { status: 'known_ready', plate: 'ABC-123',
    truck: baseReview.truck, driver: { ...baseReview.actualDriver, isActive: true } }, pending: false },
  driverPanel: React.createElement('span', null, 'Driver selection'), capturePanel: scanner,
  onLookup() {}, onConfirmTruck() {}, onCancelTruckWorkflow() {}, onEstimatedTonnageChange() {},
  onRetrySite() {}, onRetryStatistics() {},
}));
assert(!selectedTruckHtml.includes('Plate scanner') && !selectedTruckHtml.includes('Scan Plate'),
  'confirmed truck unmounts the scanner section');
assert(selectedTruckHtml.includes('Cancel Truck Workflow'), 'pre-open reset explicitly returns to scan workflow');
const processing = renderToStaticMarkup(React.createElement(PlateCapture, {
  state: { status: 'processing', phase: 'loading_model' }, disabled: false,
  onCapture() {}, onScanStart() {},
}));
assert.match(processing, /Loading on-device OCR model/);
const ocrFailure = renderToStaticMarkup(React.createElement(PlateCapture, {
  state: { status: 'error', reason: 'model_unavailable' }, disabled: false,
  onCapture() {}, onScanStart() {},
}));
assert.match(ocrFailure, /On-device OCR could not load/);
assert.match(ocrFailure, /Try Again/);
assert.match(ocrFailure, /retry the scan/);
assert(!ocrFailure.includes('Enter plate manually') && !ocrFailure.includes('Correct plate'));
assert(!ocrFailure.includes('Choose Photo') && !ocrFailure.includes('type="file"'));
assert(readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8').includes('void controller.submit(candidate'));
assert(!readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8').includes('confirmCorrection'));
console.log('PASS scan-first view, automatic OCR lookup, no manual plate entry, OCR retry');

const { CameraSession, classifyCameraFailure, guideSourceRect } = load('src/features/loading/utils/cameraSession.ts');
const stopped = [];
let resolveCamera;
let requestedConstraints;
const session = new CameraSession(constraints => {
  requestedConstraints = constraints;
  return new Promise(resolve => { resolveCamera = resolve; });
});
const firstStart = session.start();
assert.deepEqual(requestedConstraints, { audio: false, video: { facingMode: { ideal: 'environment' } } });
session.stop(); // Cancel or unmount before the browser resolves permission.
resolveCamera({ getTracks: () => [{ stop: () => stopped.push('late') }] });
assert.equal(await firstStart, null);
assert.deepEqual(stopped, ['late']);
const activeStart = session.start();
const activeStream = { getTracks: () => [{ stop: () => stopped.push('active') }] };
resolveCamera(activeStream);
assert.equal(await activeStart, activeStream);
assert.equal(session.isActive(activeStream), true);
session.stop(); // Capture, close, next truck, assignment change and unmount use this path.
assert.equal(session.isActive(activeStream), false);
assert.deepEqual(stopped, ['late', 'active']);
// Scan B invalidates OCR A before opening the new preview. A late OCR result cannot
// prefill the plate or trigger a workflow reset that closes B's camera session.
let resolveOcrA;
const latePrefills = [];
let scanState;
const scanCapture = new PlateCaptureController('actor-a', { recognize: () => new Promise(resolve => { resolveOcrA = resolve; }), dispose() {}, resume() {} },
  value => { scanState = value; }, value => latePrefills.push(value));
const ocrA = scanCapture.capture(file);
const scanB = new CameraSession(() => Promise.resolve({
  getTracks: () => [{ stop: () => stopped.push('scan-b') }],
}));
scanCapture.clear(); // PlateCapture.onScanStart runs this before CameraSession.start.
const streamB = await scanB.start();
assert.equal(scanB.isActive(streamB), true);
resolveOcrA({ image: jpeg, candidate: 'OLD-999', confidence: 0.7 });
await ocrA;
assert.deepEqual(scanState, { status: 'idle' });
assert.deepEqual(latePrefills, []);
assert.equal(scanB.isActive(streamB), true);
assert(!stopped.includes('scan-b'));
scanB.stop();
assert(readFileSync(resolve('src/features/loading/components/PlateCapture.tsx'), 'utf8')
  .includes('onScanStart();'));
assert(readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8')
  .includes('void controller.submit(candidate, currentSite.site.assignmentId)'));
assert(readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8').includes('truckConfirmed ? undefined : <PlateCapture'));
assert(readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8').includes('if (truckConfirmedRef.current) return'));
assert.equal(classifyCameraFailure({ name: 'NotAllowedError' }), 'permission_denied');
assert.equal(classifyCameraFailure({ name: 'NotFoundError' }), 'unavailable');
assert.equal(classifyCameraFailure(new Error('start failed')), 'initialization_failed');
assert.deepEqual(guideSourceRect(1920, 1080, 960, 540),
  { x: 192, y: 345.6, width: 1536, height: 388.8 });
console.log('PASS rear-camera preference, cancelled permission race, track stop, guide crop and safe failure classes');
console.log('PASS pending OCR cannot prefill or close a newly started camera session');
