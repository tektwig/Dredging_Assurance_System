import type { DriverSearchResult, NewDriverForm, RegistrationFailureCode, RegistrationMode, RegistrationRequest, RegistrationResult, RegistrationSafeResponse, SafeDriverSummary, SavedRegistrationOutcome, SavedRegistrationReceipt, SelectedActualDriver, TruckLookupResult, TruckSummary } from '../types';
import { LoadingAuthorizationError, RegistrationOutcomeUnknownError } from '../services/errors';
import { registrationReceipt, registrationResponseMatchesMode, validateRegistrationRefresh } from './registrationValidation';

export const emptyDriverForm = (): NewDriverForm => ({
  fullName: '', phoneNumber: '', email: '', bankName: '', accountNumber: '', accountName: '',
});

export type DriverContext =
  | { kind: 'known'; plate: string; assignmentId: string; truck: TruckSummary; regular: SafeDriverSummary }
  | { kind: 'unknown'; plate: string; assignmentId: string };
export type DriverSearchState =
  | { status: 'idle'; query: string }
  | { status: 'searching'; query: string }
  | { status: 'results'; query: string; drivers: SafeDriverSummary[] }
  | { status: 'error'; query: string }
  | { status: 'invalid'; query: string };
export type RegistrationState =
  | { status: 'closed' }
  | { status: 'editing'; mode: RegistrationMode }
  | { status: 'submitting'; mode: RegistrationMode }
  | { status: 'ambiguous'; mode: RegistrationMode }
  | { status: 'duplicate_review'; mode: RegistrationMode; candidates: SafeDriverSummary[] }
  | { status: 'business_failure'; mode: RegistrationMode; code: RegistrationFailureCode }
  | { status: 'refreshing'; mode: RegistrationMode }
  | { status: 'refresh_error'; mode: RegistrationMode }
  | { status: 'authorization'; mode: RegistrationMode };
export type DriverWorkflowSnapshot = {
  context: DriverContext | null;
  choice: 'regular' | 'different' | null;
  selected: SelectedActualDriver | null;
  search: DriverSearchState;
  registration: RegistrationState;
  existingForNewTruck: SafeDriverSummary | null;
  form: NewDriverForm;
  saved: SavedRegistrationOutcome | null;
};

export function validateNewDriver(form: NewDriverForm): string | null {
  if (!form.fullName.trim() || form.fullName.trim().length > 200) return 'Enter the driver’s full name.';
  if (!form.phoneNumber.trim() || form.phoneNumber.length > 40) return 'Enter a valid phone number.';
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Check the email address.';
  if (!form.bankName.trim() || form.bankName.trim().length > 200) return 'Enter the bank name.';
  if (!/^[0-9]{10}$/.test(form.accountNumber.trim())) return 'Account number must be exactly 10 digits.';
  if (!form.accountName.trim() || form.accountName.trim().length > 200) return 'Enter the account name.';
  return null;
}

// A request ID belongs to one immutable payload. Editing any input discards it.
export class RegistrationRequestLifecycle {
  private requestId: string | null = null;
  constructor(private readonly newUuid: () => string = () => crypto.randomUUID()) {}
  current(): string { return this.requestId ??= this.newUuid(); }
  changed() { this.requestId = null; }
  completed() { this.requestId = null; }
}

export class DriverWorkflowController {
  private state: DriverWorkflowSnapshot = {
    context: null, choice: null, selected: null, search: { status: 'idle', query: '' },
    registration: { status: 'closed' }, existingForNewTruck: null, form: emptyDriverForm(), saved: null,
  };
  private revision = 0;
  private searchRevision = 0;
  private pending = false;
  private disposed = false;
  private requests: RegistrationRequestLifecycle;
  private savedResponse: RegistrationSafeResponse | null = null;

  constructor(
    private readonly searchDrivers: (query: string) => Promise<DriverSearchResult>,
    private readonly register: (request: RegistrationRequest) => Promise<RegistrationResult>,
    private readonly refreshTruck: (plate: string) => Promise<TruckLookupResult>,
    private readonly publishReady: (plate: string, truck: Extract<TruckLookupResult, { kind: 'known_ready' | 'inactive_driver' }>) => boolean,
    private readonly notify: (state: DriverWorkflowSnapshot) => void,
    newUuid?: () => string,
    private readonly siteUnavailable?: () => void,
    private readonly staleSuccess?: (receipt: SavedRegistrationReceipt) => void,
  ) { this.requests = new RegistrationRequestLifecycle(newUuid); }

  get current(): DriverWorkflowSnapshot { return this.state; }
  private publish(change: Partial<DriverWorkflowSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...change };
    this.notify(this.state);
  }
  reset() {
    this.revision++; this.searchRevision++; this.requests.changed();
    this.savedResponse = null;
    this.publish({ context: null, choice: null, selected: null, search: { status: 'idle', query: '' },
      registration: { status: 'closed' }, existingForNewTruck: null, form: emptyDriverForm(), saved: null });
  }
  dispose() {
    this.disposed = true; this.revision++; this.searchRevision++; this.requests.changed();
    this.savedResponse = null;
    this.state = { context: null, choice: null, selected: null, search: { status: 'idle', query: '' },
      registration: { status: 'closed' }, existingForNewTruck: null, form: emptyDriverForm(), saved: null };
  }
  resume() { this.disposed = false; }
  setContext(context: DriverContext) {
    const saved = (this.state.saved?.status === 'ready'
      || (this.state.saved?.status === 'blocked' && this.state.saved.reason === 'inactive_driver'))
      && context.kind === 'known'
      && context.truck.id === this.state.saved.receipt.truckId ? this.state.saved : null;
    this.reset();
    this.publish({ context, saved, choice: context.kind === 'known'
      ? context.regular.isActive ? 'regular' : 'different' : null,
      selected: context.kind === 'known' && context.regular.isActive
        ? { driver: context.regular, source: 'regular', makeRegular: false } : null });
  }
  chooseRegular() {
    const context = this.state.context;
    if (context?.kind !== 'known' || !context.regular.isActive) return;
    this.searchRevision++;
    this.cancelRegistration();
    this.publish({ choice: 'regular', selected: { driver: context.regular, source: 'regular', makeRegular: false },
      search: { status: 'idle', query: '' } });
  }
  chooseDifferent() {
    if (this.state.context?.kind !== 'known') return;
    this.cancelRegistration();
    this.publish({ choice: 'different', selected: null, search: { status: 'idle', query: '' } });
  }
  editSearch(query: string) {
    this.searchRevision++;
    this.publish({ search: { status: 'idle', query } });
  }
  async search(query = this.state.search.query): Promise<void> {
    if (!this.state.context || this.disposed) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) { this.publish({ search: { status: 'invalid', query } }); return; }
    const revision = ++this.searchRevision;
    const contextRevision = this.revision;
    this.publish({ search: { status: 'searching', query } });
    try {
      const result = await this.searchDrivers(trimmed);
      if (revision !== this.searchRevision || contextRevision !== this.revision || this.disposed) return;
      if (result.kind === 'results') this.publish({ search: { status: 'results', query, drivers: result.drivers } });
      else if (result.code === 'INVALID_SEARCH') this.publish({ search: { status: 'invalid', query } });
      else {
        this.publish({ search: { status: 'error', query } });
        this.siteUnavailable?.();
      }
    } catch (error) {
      if (revision === this.searchRevision && contextRevision === this.revision) this.publish({ search: { status: 'error', query } });
      if (error instanceof LoadingAuthorizationError && revision === this.searchRevision
        && contextRevision === this.revision && !this.disposed) this.siteUnavailable?.();
    }
  }
  selectExisting(driver: SafeDriverSummary) {
    if (!this.state.context || !driver.isActive || this.pending) return;
    const context = this.state.context;
    this.requests.changed();
    if (context.kind === 'known') {
      if (driver.id === context.regular.id) { this.chooseRegular(); return; }
      this.publish({ choice: 'different', selected: { driver, source: 'existing', makeRegular: false },
        registration: { status: 'closed' }, form: emptyDriverForm() });
    } else {
      this.publish({ existingForNewTruck: driver, registration: { status: 'editing', mode: 'new_truck_existing_driver' },
        form: emptyDriverForm() });
    }
  }
  startNewDriver() {
    const context = this.state.context;
    if (!context || this.pending) return;
    this.requests.changed();
    this.publish({ registration: { status: 'editing', mode: context.kind === 'known'
      ? 'existing_truck_new_driver' : 'new_truck_new_driver' }, existingForNewTruck: null, form: emptyDriverForm() });
  }
  startUnknownRegistration() {
    if (this.state.context?.kind !== 'unknown') return;
    this.publish({ registration: { status: 'editing', mode: 'new_truck_new_driver' } });
  }
  editForm(field: keyof NewDriverForm, value: string) {
    if (this.pending || this.state.registration.status === 'closed') return;
    const mode = this.state.registration.mode;
    this.requests.changed();
    this.publish({ form: { ...this.state.form, [field]: value },
      registration: { status: 'editing', mode } });
  }
  cancelRegistration() {
    if (this.pending) return;
    this.requests.changed(); this.searchRevision++;
    this.publish({ registration: { status: 'closed' }, form: emptyDriverForm(), existingForNewTruck: null });
  }
  setMakeRegular(value: boolean) {
    const { context, selected } = this.state;
    if (context?.kind !== 'known' || !selected || selected.driver.id === context.regular.id) return;
    this.publish({ selected: { ...selected, makeRegular: value } });
  }
  async submitRegistration(): Promise<void> {
    const { context, registration, form, existingForNewTruck } = this.state;
    const replacingInactiveRegular = context?.kind === 'known' && this.state.saved?.status === 'blocked'
      && this.state.saved.reason === 'inactive_driver';
    if (!context || this.pending || (this.state.saved && !replacingInactiveRegular)
      || (registration.status !== 'editing' && registration.status !== 'ambiguous'
      && registration.status !== 'business_failure')) return;
    if (registration.status === 'business_failure' && registration.code === 'DRIVER_MATCH_REQUIRES_REVIEW') return;
    const mode = registration.mode;
    if (mode !== 'new_truck_existing_driver' && validateNewDriver(form)) return;
    if (mode === 'new_truck_existing_driver' && !existingForNewTruck) return;
    const request: RegistrationRequest = {
      requestId: this.requests.current(), plate: context.plate,
      expectedTruckId: context.kind === 'known' ? context.truck.id : null,
      existingDriverId: mode === 'new_truck_existing_driver' ? existingForNewTruck!.id : null,
      newDriver: mode === 'new_truck_existing_driver' ? null : { ...form },
    };
    this.pending = true;
    const revision = this.revision;
    this.publish({ registration: { status: 'submitting', mode } });
    try {
      const result = await this.register(request);
      if (this.disposed) return;
      if (revision !== this.revision) {
        if (result.kind === 'success') this.staleSuccess?.(registrationReceipt(context.plate, context.assignmentId, result));
        return;
      }
      this.requests.completed();
      if (result.kind === 'business_failure') {
        if (['SITE_ASSIGNMENT_REQUIRED', 'INVALID_SITE_ASSIGNMENT', 'INACTIVE_SITE'].includes(result.code)) {
          this.publish({ registration: { status: 'business_failure', mode, code: result.code }, form: emptyDriverForm() });
          this.siteUnavailable?.();
          return;
        }
        if (result.code === 'DRIVER_MATCH_REQUIRES_REVIEW') {
          // The registration RPC returns no candidate. Search the entered phone
          // through the approved safe lookup before presenting a review choice.
          let candidates: SafeDriverSummary[] = [];
          try {
            const found = await this.searchDrivers(form.phoneNumber);
            if (found.kind === 'results') candidates = found.drivers;
          } catch { /* The officer can retry review or correct the form. */ }
          if (this.disposed || revision !== this.revision) return;
          this.publish({ registration: { status: 'duplicate_review', mode, candidates } });
        } else this.publish({ registration: { status: 'business_failure', mode, code: result.code } });
        return;
      }
      this.publish({ form: emptyDriverForm(), existingForNewTruck: null });
      if (!registrationResponseMatchesMode(request, result)) {
        this.publish({ registration: { status: 'closed' },
          saved: { status: 'review_required', receipt: registrationReceipt(context.plate, context.assignmentId, result),
            reason: 'identity_mismatch' } });
        return;
      }
      if (context.kind === 'unknown') {
        const receipt = registrationReceipt(context.plate, context.assignmentId, result);
        this.savedResponse = result;
        this.publish({ registration: { status: 'refreshing', mode }, saved: { status: 'validating', receipt } });
        await this.validateSavedRegistration(receipt, result, revision);
      } else {
        if (result.truck.normalizedRegistration !== context.truck.normalizedRegistration) {
          this.publish({ registration: { status: 'closed' },
            saved: { status: 'review_required', receipt: registrationReceipt(context.plate, context.assignmentId, result),
              reason: 'identity_mismatch' } });
          return;
        }
        const driver: SafeDriverSummary = { ...result.driver, isActive: true };
        this.publish({ registration: { status: 'closed' }, choice: 'different',
          selected: { driver, source: 'new', makeRegular: false } });
      }
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      if (error instanceof LoadingAuthorizationError) {
        this.requests.changed();
        this.publish({ registration: { status: 'authorization', mode }, form: emptyDriverForm() });
        this.siteUnavailable?.();
      } else if (error instanceof RegistrationOutcomeUnknownError) {
        this.publish({ registration: { status: 'ambiguous', mode } });
      } else this.publish({ registration: { status: 'ambiguous', mode } });
    } finally { this.pending = false; }
  }

  private async validateSavedRegistration(
    receipt: SavedRegistrationReceipt, response: RegistrationSafeResponse, revision: number,
  ): Promise<void> {
    try {
      const lookup = await this.refreshTruck(receipt.plate);
      if (this.disposed) return;
      if (revision !== this.revision) { this.staleSuccess?.(receipt); return; }
      const decision = validateRegistrationRefresh(receipt, response, lookup);
      if (decision.publishableTruck && !this.publishReady(receipt.plate, decision.publishableTruck)) {
        this.publish({ saved: { status: 'review_required', receipt, reason: 'identity_mismatch' },
          registration: { status: 'closed' } });
      } else this.publish({ saved: decision.outcome, registration: { status: 'closed' } });
    } catch {
      if (this.disposed) return;
      if (revision !== this.revision) { this.staleSuccess?.(receipt); return; }
      this.publish({ saved: { status: 'review_required', receipt, reason: 'lookup_unavailable' },
        registration: { status: 'closed' } });
    }
  }

  async retrySavedValidation(): Promise<void> {
    const saved = this.state.saved;
    if (!saved || saved.status !== 'review_required' || saved.reason !== 'lookup_unavailable'
      || !this.savedResponse || this.pending || this.disposed) return;
    this.pending = true;
    const revision = this.revision;
    this.publish({ saved: { status: 'validating', receipt: saved.receipt } });
    try { await this.validateSavedRegistration(saved.receipt, this.savedResponse, revision); }
    finally { this.pending = false; }
  }
  backFromDuplicate() {
    if (this.state.registration.status !== 'duplicate_review') return;
    this.publish({ registration: { status: 'editing', mode: this.state.registration.mode } });
  }
}
