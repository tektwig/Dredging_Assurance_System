// Behavioral tests with in-memory RPC transport. No database or network writes.
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
const absolute = path => resolve(path);
function load(path) {
  const full = absolute(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const output = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx', base + '.css'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const calls = [];
let searchResponse;
let registrationResponse;
let registrationError;
overrides.set(absolute('src/lib/supabase.ts'), { supabase: {
  from(table) { assert.fail(`Unexpected direct table access: ${table}`); },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'search_loading_drivers') return { data: searchResponse, error: null };
    if (name === 'register_loading_participant') return { data: registrationResponse, error: registrationError };
    assert.fail(`Unexpected RPC: ${name}`);
  },
} });
const service = load('src/features/loading/services/driverData.ts');
const regular = { id: 'driver-a', fullName: 'John Doe', phoneNumber: '08012345678', email: null, isActive: true };
const other = { id: 'driver-b', fullName: 'James Obi', phoneNumber: '+2348011111111', email: 'james@example.invalid', isActive: true };
const truck = { id: 'truck-a', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true };
searchResponse = { ok: true, drivers: [
  { id: other.id, full_name: other.fullName, phone_number: other.phoneNumber, email: other.email, is_active: true, bank_name: 'NEVER_DISPLAY' },
] };
assert.deepEqual(await service.searchLoadingDrivers({ query: 'James' }), { kind: 'results', drivers: [other] });
assert.deepEqual(calls.at(-1), { name: 'search_loading_drivers', args: { p_query: 'James', p_limit: 10 } });
registrationResponse = { ok: true, request_id: 'req-1',
  truck: { id: truck.id, registration_number: truck.registrationNumber, normalized_registration: truck.normalizedRegistration, created: true },
  driver: { id: other.id, full_name: other.fullName, phone_number: other.phoneNumber, email: other.email, created: true },
  payment_details_captured: true, default_driver_changed: false, account_number: 'NEVER_DISPLAY' };
const sensitive = { fullName: 'James Obi', phoneNumber: other.phoneNumber, email: '',
  bankName: 'Example Bank', accountNumber: '0123456789', accountName: 'James Obi' };
const request = { requestId: 'req-1', plate: 'ABC-123', expectedTruckId: null, existingDriverId: null, newDriver: sensitive };
const registration = await service.registerLoadingParticipant(request);
assert.equal(registration.kind, 'success');
assert(!JSON.stringify(registration).includes('0123456789'));
assert(!JSON.stringify(registration).includes('Example Bank'));
assert.deepEqual(calls.at(-1).args, {
  p_request_id: 'req-1', p_plate: 'ABC-123', p_expected_truck_id: null, p_existing_driver_id: null,
  p_full_name: 'James Obi', p_phone_number: other.phoneNumber, p_email: null,
  p_bank_name: 'Example Bank', p_account_number: '0123456789', p_account_name: 'James Obi',
});
const existingRequest = { requestId: 'req-2', plate: 'NEW-123', expectedTruckId: null, existingDriverId: other.id, newDriver: null };
registrationResponse = { ...registrationResponse, request_id: 'req-2', payment_details_captured: false,
  driver: { ...registrationResponse.driver, created: false } };
await service.registerLoadingParticipant(existingRequest);
assert.equal(calls.at(-1).args.p_existing_driver_id, other.id);
assert.equal(calls.at(-1).args.p_bank_name, null);
registrationError = { code: 'PGRST000', message: 'Private transport detail' };
await assert.rejects(service.registerLoadingParticipant(existingRequest), { message: 'Registration outcome unknown' });
registrationError = null;
registrationResponse = { ok: false, code: 'DRIVER_MATCH_REQUIRES_REVIEW', details: {} };
assert.deepEqual(await service.registerLoadingParticipant(request),
  { kind: 'business_failure', code: 'DRIVER_MATCH_REQUIRES_REVIEW' });
console.log('PASS safe RPC contracts, write-only banking and ambiguous transport result');

const { DriverWorkflowController, RegistrationRequestLifecycle, validateNewDriver } = load('src/features/loading/utils/driverWorkflowController.ts');
const browserIds = new RegistrationRequestLifecycle();
const generatedId = browserIds.current();
assert.match(generatedId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(browserIds.current(), generatedId);
browserIds.changed();
assert.notEqual(browserIds.current(), generatedId);
assert.equal(validateNewDriver(sensitive), null);
assert.match(validateNewDriver({ ...sensitive, accountNumber: '123456789' }), /10 digits/);
assert.equal(validateNewDriver({ ...sensitive, email: '' }), null);
let uuid = 0;
let refreshes = 0;
let publishedReady = [];
let registrations = [];
let registerBehavior = async value => {
  registrations.push(value);
  return { kind: 'success', requestId: value.requestId,
    truck: { id: value.expectedTruckId ?? 'truck-new', registrationNumber: value.plate,
      normalizedRegistration: value.plate.replace(/-/g, ''), created: !value.expectedTruckId },
    driver: { id: value.existingDriverId ?? 'driver-new', fullName: value.newDriver?.fullName ?? other.fullName,
      phoneNumber: value.newDriver?.phoneNumber ?? other.phoneNumber, email: value.newDriver?.email || null, created: !value.existingDriverId },
    paymentDetailsCaptured: !value.existingDriverId, defaultDriverChanged: false };
};
let pendingSearch;
let state;
const workflow = new DriverWorkflowController(
  query => query === 'John' ? new Promise(resolve => { pendingSearch = resolve; })
    : Promise.resolve({ kind: 'results', drivers: [other] }),
  value => registerBehavior(value),
  async plate => { assert(plate.startsWith('NEW-')); refreshes++;
    const last = registrations.at(-1);
    return { kind: 'known_ready', assignmentId: 'assignment-1',
      truck: { id: 'truck-new', registrationNumber: plate, normalizedRegistration: plate.replace(/-/g, ''), isActive: true },
      driver: { id: last.existingDriverId ?? 'driver-new', fullName: last.newDriver?.fullName ?? other.fullName,
        phoneNumber: last.newDriver?.phoneNumber ?? other.phoneNumber, email: null, isActive: true } }; },
  (plate, result) => { publishedReady.push({ plate, result }); return true; },
  value => { state = value; }, () => `uuid-${++uuid}`,
);
workflow.setContext({ kind: 'known', plate: 'ABC-123', assignmentId: 'assignment-1', truck, regular });
assert.equal(state.choice, 'regular');
assert.equal(state.selected.driver.id, regular.id);
assert.equal(state.selected.makeRegular, false);
workflow.chooseDifferent();
assert.equal(state.selected, null);
workflow.editSearch('John');
const oldSearch = workflow.search();
workflow.editSearch('James');
await workflow.search();
pendingSearch({ kind: 'results', drivers: [regular] });
await oldSearch;
assert.deepEqual(state.search.drivers, [other]);
workflow.selectExisting(other);
assert.equal(state.selected.driver.id, other.id);
workflow.setMakeRegular(true);
assert.equal(state.selected.makeRegular, true);
workflow.selectExisting({ ...other, id: 'driver-c', fullName: 'Another Driver' });
assert.equal(state.selected.driver.id, 'driver-c');
assert.equal(state.selected.makeRegular, false);
workflow.chooseRegular();
assert.equal(state.selected.driver.id, regular.id);
assert.equal(state.selected.makeRegular, false);
workflow.setMakeRegular(true);
assert.equal(state.selected.makeRegular, false);
workflow.chooseDifferent();
workflow.startNewDriver();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
await workflow.submitRegistration();
assert.equal(registrations.at(-1).expectedTruckId, truck.id);
assert.equal(registrations.at(-1).existingDriverId, null);
assert.equal(state.selected.driver.id, 'driver-new');
assert.equal(state.selected.makeRegular, false);
assert.equal(state.form.accountNumber, '');
workflow.setMakeRegular(true);
assert.equal(state.selected.makeRegular, true);
workflow.reset();
assert.equal(state.selected, null);
assert.equal(state.form.accountNumber, '');
console.log('PASS known-truck selection, stale search, new actual driver and local regular-driver intent');

workflow.setContext({ kind: 'unknown', plate: 'NEW-123', assignmentId: 'assignment-1' });
assert.equal(state.context.plate, 'NEW-123');
workflow.selectExisting(other);
await workflow.submitRegistration();
assert.equal(registrations.at(-1).plate, 'NEW-123');
assert.equal(registrations.at(-1).expectedTruckId, null);
assert.equal(registrations.at(-1).existingDriverId, other.id);
assert.equal(registrations.at(-1).newDriver, null);
assert.equal(refreshes, 1);
workflow.reset();
workflow.setContext({ kind: 'unknown', plate: 'NEW-456', assignmentId: 'assignment-1' });
workflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
let releaseRegistration;
registerBehavior = value => { registrations.push(value); return new Promise(resolve => { releaseRegistration = resolve; }); };
const firstSubmit = workflow.submitRegistration();
await workflow.submitRegistration();
assert.equal(registrations.length, 3, 'double submission blocked');
releaseRegistration({ kind: 'business_failure', code: 'DRIVER_MATCH_REQUIRES_REVIEW' });
await firstSubmit;
const duplicateAttemptId = registrations.at(-1).requestId;
assert.equal(state.registration.status, 'duplicate_review');
assert.equal(state.registration.candidates[0].id, other.id);
assert(!JSON.stringify(state.registration.candidates).includes('NEVER_DISPLAY'));
const { DriverIdentification } = load('src/features/loading/components/DriverIdentification.tsx');
const callbacks = { onRegular() {}, onDifferent() {}, onSearchEdit() {}, onSearch() {}, onSelectExisting() {},
  onStartUnknown() {}, onStartNewDriver() {}, onFormEdit() {}, onCancel() {}, onRegister() {},
  onBackFromDuplicate() {}, onMakeRegular() {} };
let html = renderToStaticMarkup(React.createElement(DriverIdentification, { state, ...callbacks }));
assert(html.includes('Possible existing driver') && html.includes(other.fullName));
assert(!html.includes('NEVER_DISPLAY') && !html.includes('0123456789'));
workflow.selectExisting(other);
assert.equal(state.registration.mode, 'new_truck_existing_driver');
assert.equal(state.form.accountNumber, '');
registerBehavior = async value => {
  registrations.push(value);
  return { kind: 'success', requestId: value.requestId,
    truck: { id: 'truck-new', registrationNumber: value.plate,
      normalizedRegistration: value.plate.replace(/-/g, ''), created: true },
    driver: { id: other.id, fullName: other.fullName, phoneNumber: other.phoneNumber,
      email: other.email, created: false }, paymentDetailsCaptured: false, defaultDriverChanged: false };
};
await workflow.submitRegistration();
assert.notEqual(registrations.at(-1).requestId, duplicateAttemptId);
assert.equal(registrations.at(-1).existingDriverId, other.id);
assert.equal(registrations.at(-1).newDriver, null);
assert.equal(state.saved.status, 'ready');
assert.equal(refreshes, 2);
workflow.setContext({ kind: 'unknown', plate: 'NEW-456', assignmentId: 'assignment-1' });
workflow.cancelRegistration();
workflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
registerBehavior = async value => { registrations.push(value); return { kind: 'business_failure', code: 'DRIVER_MATCH_REQUIRES_REVIEW' }; };
await workflow.submitRegistration();
workflow.backFromDuplicate();
workflow.editForm('phoneNumber', '+2348099999999');
assert.equal(state.registration.status, 'editing');
workflow.cancelRegistration();
assert.equal(state.form.accountNumber, '');
console.log('PASS unknown-truck modes, duplicate-phone review, double-submit guard and banking cleanup');

workflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
registerBehavior = async value => { registrations.push(value); throw new (load('src/features/loading/services/errors.ts').RegistrationOutcomeUnknownError)(); };
await workflow.submitRegistration();
assert.equal(state.registration.status, 'ambiguous');
const ambiguousId = registrations.at(-1).requestId;
await workflow.submitRegistration();
assert.equal(registrations.at(-1).requestId, ambiguousId, 'unchanged ambiguous retry reuses UUID');
workflow.editForm('accountName', 'Another Name');
await workflow.submitRegistration();
assert.notEqual(registrations.at(-1).requestId, ambiguousId, 'changed payload gets new UUID');
workflow.cancelRegistration();
workflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
registerBehavior = async value => { registrations.push(value); return { kind: 'success', requestId: value.requestId,
  truck: { id: 'truck-new', registrationNumber: value.plate, normalizedRegistration: 'NEW456', created: true },
  driver: { id: 'driver-new', fullName: sensitive.fullName, phoneNumber: sensitive.phoneNumber, email: null, created: true },
  paymentDetailsCaptured: true, defaultDriverChanged: false }; };
await workflow.submitRegistration();
assert.equal(refreshes, 3);
assert.equal(state.form.accountNumber, '');
assert.notEqual(registrations.at(-1).requestId, ambiguousId);
const successfulId = registrations.at(-1).requestId;
workflow.setContext({ kind: 'unknown', plate: 'NEW-789', assignmentId: 'assignment-1' });
workflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
await workflow.submitRegistration();
assert.notEqual(registrations.at(-1).requestId, successfulId, 'new registration does not replay success ID');
console.log('PASS request-ID retry/change/new-operation lifecycle and authoritative refresh');

workflow.setContext({ kind: 'known', plate: 'ABC-123', assignmentId: 'assignment-1', truck, regular });
html = renderToStaticMarkup(React.createElement(DriverIdentification, { state, ...callbacks }));
assert(html.includes('Regular Driver') && html.includes('Who is driving this trip?'));
assert(!html.includes('Set John Doe as this truck'));
workflow.chooseDifferent(); workflow.selectExisting(other);
html = renderToStaticMarkup(React.createElement(DriverIdentification, { state, ...callbacks }));
assert(html.includes('Set James Obi as this truck'));
assert(!html.includes('bank_name') && !html.includes('NEVER_DISPLAY'));
workflow.startNewDriver();
html = renderToStaticMarkup(React.createElement(DriverIdentification, { state, ...callbacks }));
assert(html.includes('Payment Details') && html.includes('name="accountNumber"') && html.includes('type="text"'));
assert(html.includes('name="email"') && !html.includes('name="email" type="email" required'));
assert(!calls.some(call => call.name === 'create_loading_trip_v2'));
console.log('PASS field UI terminology, conditional regular-driver option and no trip opening');

for (const [field, value] of Object.entries(sensitive)) workflow.editForm(field, value);
registerBehavior = async value => { registrations.push(value); return { kind: 'business_failure', code: 'DRIVER_MATCH_REQUIRES_REVIEW' }; };
await workflow.submitRegistration();
assert.equal(state.registration.status, 'duplicate_review');
const beforeCandidateChoice = registrations.length;
workflow.selectExisting(other);
assert.equal(registrations.length, beforeCandidateChoice);
assert.equal(state.registration.status, 'closed');
assert.equal(state.selected.driver.id, other.id);
assert.equal(state.selected.makeRegular, false);
console.log('PASS known-truck duplicate candidate becomes actual driver without another registration');

const { registrationReceipt, registrationResponseMatchesMode, validateRegistrationRefresh } = load('src/features/loading/utils/registrationValidation.ts');
const savedResponse = {
  kind: 'success', requestId: 'saved-request',
  truck: { id: 'saved-truck', registrationNumber: 'NEW-123', normalizedRegistration: 'NEW123', created: true },
  driver: { id: 'saved-driver', fullName: sensitive.fullName, phoneNumber: sensitive.phoneNumber, email: null, created: true },
  paymentDetailsCaptured: true, defaultDriverChanged: false,
};
const savedReceipt = registrationReceipt('NEW-123', 'assignment-1', savedResponse);
assert(!JSON.stringify(savedReceipt).includes('0123456789'));
const refreshed = { kind: 'known_ready', assignmentId: 'assignment-1',
  truck: { id: 'saved-truck', registrationNumber: 'NEW-123', normalizedRegistration: 'NEW123', isActive: true },
  driver: { id: 'saved-driver', fullName: sensitive.fullName, phoneNumber: sensitive.phoneNumber, email: null, isActive: true } };
assert.equal(validateRegistrationRefresh(savedReceipt, savedResponse, refreshed).outcome.status, 'ready');
const existingDriverResponse = { ...savedResponse, driver: { ...savedResponse.driver, created: false }, paymentDetailsCaptured: false };
assert.equal(validateRegistrationRefresh(savedReceipt, existingDriverResponse, refreshed).outcome.status, 'ready');
const newModeRequest = { requestId: 'saved-request', plate: 'NEW-123', expectedTruckId: null,
  existingDriverId: null, newDriver: sensitive };
assert(registrationResponseMatchesMode(newModeRequest, savedResponse));
assert(!registrationResponseMatchesMode(newModeRequest, existingDriverResponse));
assert(registrationResponseMatchesMode({ ...newModeRequest, existingDriverId: 'saved-driver', newDriver: null }, existingDriverResponse));
assert(!registrationResponseMatchesMode({ ...newModeRequest, existingDriverId: 'other-driver', newDriver: null }, existingDriverResponse));
for (const changed of [
  { kind: 'unknown_truck', assignmentId: 'assignment-1' },
  { ...refreshed, truck: { ...refreshed.truck, id: 'different-truck' } },
  { ...refreshed, truck: { ...refreshed.truck, normalizedRegistration: 'OTHER999' } },
  { ...refreshed, truck: { ...refreshed.truck, registrationNumber: 'OTHER-999' } },
  { ...refreshed, driver: { ...refreshed.driver, id: 'different-driver' } },
  { ...refreshed, assignmentId: 'different-assignment' },
]) {
  const decision = validateRegistrationRefresh(savedReceipt, savedResponse, changed);
  assert.equal(decision.outcome.status, 'review_required');
  assert.equal(decision.publishableTruck, null);
}
for (const [changed, reason] of [
  [{ ...refreshed, kind: 'inactive_truck', truck: { ...refreshed.truck, isActive: false } }, 'inactive_truck'],
  [{ ...refreshed, kind: 'inactive_driver', driver: { ...refreshed.driver, isActive: false } }, 'inactive_driver'],
  [{ ...refreshed, kind: 'open_trip_exists', trip: { tripId: 'trip-1', tripNumber: 'TRP-1' } }, 'open_trip_exists'],
  [{ ...refreshed, kind: 'blocking_exception' }, 'blocking_exception'],
]) {
  const decision = validateRegistrationRefresh(savedReceipt, savedResponse, changed);
  assert.equal(decision.outcome.status, 'blocked');
  assert.equal(decision.outcome.reason, reason);
  assert.equal(decision.publishableTruck?.kind === 'inactive_driver', reason === 'inactive_driver');
}
console.log('PASS pure post-registration identity and operational-block decisions');

const { LoadingPortalView } = load('src/features/loading/components/LoadingPortalView.tsx');
const viewProps = {
  officerName: 'Officer', now: new Date('2026-09-24T10:00:00Z'),
  site: { status: 'ready', site: { assignmentId: 'assignment-1', siteId: 'site-1', siteName: 'Loading Yard' } },
  statistics: { status: 'ready', statistics: { tripsOpened: 0, openTrips: 0, tripsClosed: 0, trucksProcessed: 0 } },
  plate: 'NEW-123', manualEntry: false, estimatedTonnage: '', truckConfirmed: false,
  lookup: { state: { status: 'unknown_truck', plate: 'NEW-123' }, pending: false },
  onPlateChange() {}, onLookup() {}, onConfirmTruck() {}, onEstimatedTonnageChange() {},
  onRetrySite() {}, onRetryStatistics() {},
};
const renderSaved = saved => renderToStaticMarkup(React.createElement(LoadingPortalView,
  { ...viewProps, savedRegistration: saved }));
let savedHtml = renderSaved({ status: 'review_required', receipt: savedReceipt, reason: 'identity_mismatch' });
assert(savedHtml.includes('Registration saved') && savedHtml.includes('review required'));
assert(!savedHtml.includes('Register Truck &amp; Driver') && !savedHtml.includes('Truck not registered'));
savedHtml = renderSaved({ status: 'blocked', receipt: savedReceipt, reason: 'open_trip_exists',
  trip: { tripId: 'trip-1', tripNumber: 'TRP-1' } });
assert(savedHtml.includes('Registration saved') && savedHtml.includes('TRP-1'));
for (const reason of ['inactive_truck', 'inactive_driver', 'blocking_exception']) {
  savedHtml = renderSaved({ status: 'blocked', receipt: savedReceipt, reason });
  assert(savedHtml.includes('Registration saved'));
  assert(savedHtml.includes(reason === 'inactive_driver' ? 'choose the actual driver' : 'cannot continue'));
  assert(!savedHtml.includes('Truck not registered'));
}
const transientState = { ...state, context: { kind: 'unknown', plate: 'NEW-123', assignmentId: 'assignment-1' },
  saved: { status: 'ready', receipt: savedReceipt }, registration: { status: 'closed' } };
assert.equal(renderToStaticMarkup(React.createElement(DriverIdentification,
  { state: transientState, ...callbacks })), '');
console.log('PASS saved registration remains visible without duplicate-registration action');

async function validateThroughController(lookup, expectedStatus, response = savedResponse, existingDriver = false) {
  let snapshot;
  const accepted = [];
  const controller = new DriverWorkflowController(
    async () => ({ kind: 'results', drivers: [] }),
    async requestValue => ({ ...response, requestId: requestValue.requestId }),
    async () => lookup,
    (plateValue, candidate) => { accepted.push({ plateValue, candidate }); return true; },
    value => { snapshot = value; }, () => crypto.randomUUID(),
  );
  controller.setContext({ kind: 'unknown', plate: 'NEW-123', assignmentId: 'assignment-1' });
  if (existingDriver) controller.selectExisting({ ...refreshed.driver });
  else {
    controller.startUnknownRegistration();
    for (const [field, value] of Object.entries(sensitive)) controller.editForm(field, value);
  }
  await controller.submitRegistration();
  assert.equal(snapshot.saved.status, expectedStatus);
  assert.equal(snapshot.form.accountNumber, '');
  assert.equal(accepted.length, expectedStatus === 'ready' || lookup.kind === 'inactive_driver' ? 1 : 0);
  return snapshot;
}
await validateThroughController(refreshed, 'ready');
await validateThroughController(refreshed, 'ready', existingDriverResponse, true);
await validateThroughController({ kind: 'unknown_truck', assignmentId: 'assignment-1' }, 'review_required');
await validateThroughController({ ...refreshed, truck: { ...refreshed.truck, id: 'other' } }, 'review_required');
await validateThroughController({ ...refreshed, driver: { ...refreshed.driver, id: 'other' } }, 'review_required');
await validateThroughController({ ...refreshed, kind: 'inactive_truck', truck: { ...refreshed.truck, isActive: false } }, 'blocked');
await validateThroughController({ ...refreshed, kind: 'open_trip_exists', trip: { tripId: 'trip-1', tripNumber: 'TRP-1' } }, 'blocked');
await validateThroughController({ ...refreshed, kind: 'blocking_exception' }, 'blocked');
console.log('PASS controller publishes only validated ready truck after registration');

const inactiveRegular = { ...regular, isActive: false };
workflow.setContext({ kind: 'known', plate: 'ABC-123', assignmentId: 'assignment-1', truck, regular: inactiveRegular });
assert.equal(state.choice, 'different');
assert.equal(state.selected, null);
workflow.chooseRegular();
assert.equal(state.selected, null);
html = renderToStaticMarkup(React.createElement(DriverIdentification, { state, ...callbacks }));
assert(html.includes('Regular Driver (Inactive)') && html.includes('Different Driver'));
assert(html.includes('disabled=""') && html.includes('Register New Driver'));
workflow.selectExisting(other);
assert.equal(state.selected.driver.id, other.id);
workflow.startNewDriver();
assert.equal(state.registration.mode, 'existing_truck_new_driver');
workflow.cancelRegistration();
assert.equal(state.form.accountNumber, '');
console.log('PASS inactive regular driver cannot be selected but has replacement paths');

let rejectOldSearch;
let siteRefreshes = 0;
let raceState;
const searchRace = new DriverWorkflowController(
  query => query === 'Old' ? new Promise((_, reject) => { rejectOldSearch = reject; })
    : Promise.resolve({ kind: 'results', drivers: [other] }),
  async () => ({ kind: 'business_failure', code: 'INVALID_PLATE' }),
  async () => refreshed, () => true,
  value => { raceState = value; }, undefined, () => { siteRefreshes++; },
);
searchRace.setContext({ kind: 'known', plate: 'ABC-123', assignmentId: 'assignment-1', truck, regular });
searchRace.editSearch('Old');
const pendingOldSearch = searchRace.search();
searchRace.editSearch('James');
await searchRace.search();
rejectOldSearch(new (load('src/features/loading/services/errors.ts').LoadingAuthorizationError)());
await pendingOldSearch;
assert.equal(siteRefreshes, 0);
assert.deepEqual(raceState.search.drivers, [other]);
console.log('PASS stale search authorization error cannot disturb newer search');

let releaseLateRegistration;
let lateReceipt;
let lateState;
const registrationRace = new DriverWorkflowController(
  async () => ({ kind: 'results', drivers: [] }),
  requestValue => new Promise(resolve => { releaseLateRegistration = () => resolve({ ...savedResponse, requestId: requestValue.requestId }); }),
  async () => refreshed, () => true,
  value => { lateState = value; }, undefined, undefined, receipt => { lateReceipt = receipt; },
);
registrationRace.setContext({ kind: 'unknown', plate: 'NEW-123', assignmentId: 'assignment-1' });
registrationRace.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) registrationRace.editForm(field, value);
const pendingRegistration = registrationRace.submitRegistration();
registrationRace.reset();
registrationRace.setContext({ kind: 'unknown', plate: 'OTHER-999', assignmentId: 'assignment-1' });
releaseLateRegistration();
await pendingRegistration;
assert.equal(lateState.context.plate, 'OTHER-999');
assert.equal(lateState.saved, null);
assert.equal(lateState.form.accountNumber, '');
assert.equal(lateReceipt.plate, 'NEW-123');
assert(!JSON.stringify(lateReceipt).includes('0123456789'));
console.log('PASS late successful registration reports safe notice without replacing new context');

let replacementState;
let replacementCalls = 0;
const replacementWorkflow = new DriverWorkflowController(
  async () => ({ kind: 'results', drivers: [] }),
  async requestValue => {
    replacementCalls++;
    if (requestValue.expectedTruckId === null) return { ...savedResponse, requestId: requestValue.requestId };
    return { kind: 'success', requestId: requestValue.requestId,
      truck: { id: 'saved-truck', registrationNumber: 'NEW-123', normalizedRegistration: 'NEW123', created: false },
      driver: { id: 'replacement-driver', fullName: sensitive.fullName, phoneNumber: sensitive.phoneNumber,
        email: null, created: true }, paymentDetailsCaptured: true, defaultDriverChanged: false };
  },
  async () => ({ ...refreshed, kind: 'inactive_driver', driver: { ...refreshed.driver, isActive: false } }),
  () => true, value => { replacementState = value; }, () => crypto.randomUUID(),
);
replacementWorkflow.setContext({ kind: 'unknown', plate: 'NEW-123', assignmentId: 'assignment-1' });
replacementWorkflow.startUnknownRegistration();
for (const [field, value] of Object.entries(sensitive)) replacementWorkflow.editForm(field, value);
await replacementWorkflow.submitRegistration();
assert.equal(replacementState.saved.status, 'blocked');
replacementWorkflow.setContext({ kind: 'known', plate: 'NEW-123', assignmentId: 'assignment-1',
  truck: refreshed.truck, regular: { ...refreshed.driver, isActive: false } });
assert.equal(replacementState.selected, null);
replacementWorkflow.startNewDriver();
for (const [field, value] of Object.entries(sensitive)) replacementWorkflow.editForm(field, value);
await replacementWorkflow.submitRegistration();
assert.equal(replacementCalls, 2);
assert.equal(replacementState.selected.driver.id, 'replacement-driver');
assert.equal(replacementState.selected.makeRegular, false);
assert.equal(replacementState.form.accountNumber, '');
console.log('PASS saved truck with inactive regular driver can register a replacement');

const { RegistrationDialog } = load('src/features/loading/components/RegistrationDialog.tsx');
const modalMarkup = renderToStaticMarkup(React.createElement(RegistrationDialog, { open: true, onCancel() {} },
  React.createElement('form', { id: 'loading-driver-registration' }, React.createElement('input', { autoFocus: true }))));
assert.match(modalMarkup, /<dialog[^>]*aria-label="Register truck and driver"/);
assert.match(modalMarkup, /loading-driver-registration/);
const modalSource = readFileSync(resolve('src/features/loading/components/RegistrationDialog.tsx'), 'utf8');
assert(modalSource.includes('showModal()') && modalSource.includes('querySelector<HTMLElement>(\'input, button\')?.focus()'));
assert(modalSource.includes('onCancel={event =>') && modalSource.includes('element.close()'));
assert(readFileSync(resolve('src/features/loading/loading.css'), 'utf8').includes('.loading-registration-dialog::backdrop'));
const loadingSource = readFileSync(resolve('src/features/loading/LoadingPortal.tsx'), 'utf8');
assert(loadingSource.includes('driverController.cancelRegistration()'));
assert(loadingSource.includes('driverController.submitRegistration()'));
assert(loadingSource.includes('RegistrationDialog open'));
console.log('PASS native modal overlay, focus, Escape/cancel, dimmed inert background and reused registration workflow');
