import { supabase } from '../../../lib/supabase';

export type CredentialRole = 'loading_officer' | 'offloading_officer';
export type CredentialRoleFilter = CredentialRole | 'operations_manager' | 'system_administrator' | 'finance_officer' | 'audit_reviewer';
export type CredentialSite = { id: string; name: string; site_type: 'loading' | 'offloading'; is_active: true };
export type CreatedCredentialUser = { id: string; fullName: string; email: string; role: CredentialRole; siteId: string; siteName: string };
export type ManagedCredentialUser = { id: string; full_name: string; email: string; role: string; is_active: boolean;
  site_id: string | null; site_name: string | null; site_type?: string | null; created_at?: string; updated_at?: string };
export type CredentialUserPage = { page: number; page_size: number; total: number; users: ManagedCredentialUser[] };
export class CredentialCreationError extends Error { constructor(readonly code: string) { super(code); } }

const safeErrors: Record<string, string> = {
  UNAUTHORIZED: 'Your session could not be verified. Sign in again.', FORBIDDEN: 'Your account is not authorized to manage credentials.',
  EMAIL_UNAVAILABLE: 'This email is already registered or cannot be used.', INVALID_REQUEST: 'Check the form values and try again.',
  INVALID_ROLE: 'Choose an allowed operational role.', SITE_REQUIRED: 'Choose an active site for this role.',
  INVALID_SITE: 'The selected site is inactive or does not match the role.', ACCOUNT_CREATION_FAILED: 'The account could not be created. Check the email and try again.',
  SETUP_FAILED: 'Account setup could not be completed. Contact an administrator before retrying.', SERVER_NOT_CONFIGURED: 'Credential management is temporarily unavailable.',
  INVALID_FILTER: 'Adjust the search or filters and try again.', READ_FAILED: 'User information could not be loaded.',
  UPDATE_FAILED: 'The profile could not be updated.', USER_NOT_FOUND: 'This user no longer exists.', TARGET_NOT_MANAGEABLE: 'This account cannot be managed from Operations.',
  SELF_EDIT_DENIED: 'You cannot change your own Operations account here.', SELF_DEACTIVATION_DENIED: 'You cannot deactivate your own account.',
  INVALID_ACTION: 'This credential-management action is unavailable.',
  AUTH_ACCESS_UPDATE_FAILED: 'Authentication access could not be updated.', ACCOUNT_STATUS_UPDATE_FAILED: 'The account status could not be changed.',
  PASSWORD_RESET_FAILED: 'The password could not be reset.', PASSWORD_RESET_AUDIT_FAILED: 'Password was updated, but its audit record needs administrator review.',
};
async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new CredentialCreationError('SERVER_NOT_CONFIGURED');
  const { data, error } = await supabase.functions.invoke('create-operational-user', { body });
  if (error) {
    let code = 'ACCOUNT_CREATION_FAILED';
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) try { const result = await context.clone().json() as { error?: unknown };
      if (typeof result.error === 'string' && safeErrors[result.error]) code = result.error; } catch { /* Safe generic response. */ }
    throw new CredentialCreationError(code);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CredentialCreationError('ACCOUNT_CREATION_FAILED');
  const result = data as Record<string, unknown>;
  if (result.ok === false) throw new CredentialCreationError(typeof result.code === 'string' ? result.code : 'ACCOUNT_CREATION_FAILED');
  if (typeof result.error === 'string' && safeErrors[result.error]) throw new CredentialCreationError(result.error);
  return result;
}
function parseSites(value: unknown): CredentialSite[] {
  if (!Array.isArray(value)) throw new CredentialCreationError('READ_FAILED');
  return value.map(row => {
    if (!row || typeof row !== 'object') throw new CredentialCreationError('READ_FAILED');
    const site = row as Record<string, unknown>;
    if (typeof site.id !== 'string' || typeof site.name !== 'string' || (site.site_type !== 'loading' && site.site_type !== 'offloading')) throw new CredentialCreationError('READ_FAILED');
    return { id: site.id, name: site.name, site_type: site.site_type, is_active: true };
  });
}
function parseUser(value: unknown): ManagedCredentialUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CredentialCreationError('READ_FAILED');
  const user = value as Record<string, unknown>;
  if (typeof user.id !== 'string' || typeof user.full_name !== 'string' || typeof user.email !== 'string'
    || typeof user.role !== 'string' || typeof user.is_active !== 'boolean'
    || !(user.site_id === null || typeof user.site_id === 'string') || !(user.site_name === null || typeof user.site_name === 'string')) throw new CredentialCreationError('READ_FAILED');
  return user as ManagedCredentialUser;
}
export async function loadCredentialSites(): Promise<CredentialSite[]> {
  const result = await invoke({ action: 'sites' });
  if (result.ok !== true) throw new CredentialCreationError('READ_FAILED');
  return parseSites(result.sites);
}
export async function listCredentialUsers(input: { search?: string; role?: CredentialRoleFilter | ''; active?: boolean | null; page?: number; pageSize?: number } = {}): Promise<CredentialUserPage> {
  const result = await invoke({ action: 'list', search: input.search ?? '', role: input.role ?? '', active: input.active ?? '', page: input.page ?? 1, pageSize: input.pageSize ?? 25 });
  if (result.ok !== true || !Array.isArray(result.users) || !Number.isInteger(result.page) || !Number.isInteger(result.page_size) || !Number.isInteger(result.total)) throw new CredentialCreationError('READ_FAILED');
  return { page: result.page as number, page_size: result.page_size as number, total: result.total as number, users: result.users.map(parseUser) };
}
export async function getCredentialUser(userId: string): Promise<ManagedCredentialUser> {
  const result = await invoke({ action: 'view', userId });
  if (result.ok !== true) throw new CredentialCreationError(typeof result.code === 'string' ? result.code : 'READ_FAILED');
  return parseUser(result.user);
}
export async function createOperationalCredential(input: { fullName: string; email: string; role: CredentialRole; password: string; siteId: string }): Promise<CreatedCredentialUser> {
  const result = await invoke({ action: 'create', ...input });
  const user = result.user && typeof result.user === 'object' ? result.user as Record<string, unknown> : null;
  if (!user || typeof user.id !== 'string' || typeof user.fullName !== 'string' || typeof user.email !== 'string'
    || (user.role !== 'loading_officer' && user.role !== 'offloading_officer') || typeof user.siteId !== 'string' || typeof user.siteName !== 'string') throw new CredentialCreationError('ACCOUNT_CREATION_FAILED');
  return user as CreatedCredentialUser;
}
export async function updateCredentialProfile(input: { userId: string; fullName: string; role: CredentialRole; siteId: string }): Promise<void> {
  await invoke({ action: 'update_profile', ...input });
}
export async function resetCredentialPassword(userId: string, password: string): Promise<void> { await invoke({ action: 'reset_password', userId, password }); }
export async function setCredentialActive(userId: string, active: boolean): Promise<void> { await invoke({ action: active ? 'reactivate' : 'deactivate', userId }); }
export function credentialErrorMessage(code: string): string { return safeErrors[code] ?? 'Credential management could not be completed.'; }
