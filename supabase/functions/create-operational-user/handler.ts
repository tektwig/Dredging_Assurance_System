const allowedRoles = ['loading_officer', 'offloading_officer'] as const;
const credentialManagerRole = 'operations_manager';
type AllowedRole = typeof allowedRoles[number];
type SafeUser = { id: string; full_name: string; email: string; role: string; is_active: boolean;
  site_id: string | null; site_name: string | null; site_type?: string | null; created_at?: string; updated_at?: string };
export type SetupResult = { ok: true; profile_id: string; display_name: string; role: AllowedRole;
  site_id: string; site_name: string } | { ok: false; code: string };

export type CredentialDependencies = {
  configured: boolean;
  authenticate: (token: string) => Promise<{ id: string } | null>;
  getProfile: (id: string) => Promise<{ role: string | null; is_active: boolean } | null>;
  createAuthUser: (input: { email: string; password: string; displayName: string }) => Promise<{ id: string } | { errorStatus: number }>;
  completeSetup: (input: { profileId: string; displayName: string; role: AllowedRole; siteId: string; createdBy: string }) => Promise<SetupResult>;
  compensateIncompleteUser: (id: string, createdBy: string) => Promise<void>;
  listSites: (actorId: string) => Promise<unknown>;
  listUsers: (input: { actorId: string; search: string | null; role: string | null; active: boolean | null; page: number; pageSize: number }) => Promise<unknown>;
  getUser: (actorId: string, userId: string) => Promise<unknown>;
  updateProfile: (input: { actorId: string; userId: string; fullName: string; role: AllowedRole; siteId: string }) => Promise<{ ok: boolean; code?: string }>;
  setActive: (actorId: string, userId: string, active: boolean) => Promise<{ ok: boolean; code?: string; changed?: boolean }>;
  auditPasswordReset: (actorId: string, userId: string, completed: boolean) => Promise<{ ok: boolean; code?: string }>;
  updateAuthPassword: (userId: string, password: string) => Promise<boolean>;
  setAuthBanned: (userId: string, banned: boolean) => Promise<boolean>;
};

const corsHeaders = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function response(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: corsHeaders });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > 16_384) { await reader.cancel(); return null; } chunks.push(value); } }
  catch { return null; }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function cleanup(dependencies: CredentialDependencies, id: string, createdBy: string): Promise<void> {
  try { await dependencies.compensateIncompleteUser(id, createdBy); } catch { /* Keep the account unusable. */ }
}
function dbFailure(result: { ok: boolean; code?: string }): Response {
  if (result.ok) return response(200, { ok: true });
  const code = result.code ?? 'OPERATION_FAILED';
  const status = code === 'CALLER_NOT_AUTHORIZED' ? 403 : code === 'USER_NOT_FOUND' ? 404
    : code.includes('STALE') ? 409 : code === 'INVALID_ROLE' || code === 'INVALID_SITE'
      || code === 'INVALID_REQUEST' ? 400 : 409;
  return response(status, { error: code });
}

export function createOperationalUserHandler(dependencies: CredentialDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    if (!dependencies.configured) return response(503, { error: 'SERVER_NOT_CONFIGURED' });
    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return response(401, { error: 'UNAUTHORIZED' });
    let caller: { id: string } | null = null;
    try { caller = await dependencies.authenticate(token); } catch { /* deny below */ }
    if (!caller || !isUuid(caller.id)) return response(401, { error: 'UNAUTHORIZED' });
    let profile: { role: string | null; is_active: boolean } | null = null;
    try { profile = await dependencies.getProfile(caller.id); } catch { /* deny below */ }
    if (!profile?.is_active || profile.role !== credentialManagerRole) return response(403, { error: 'FORBIDDEN' });
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > 16_384) return response(400, { error: 'INVALID_REQUEST' });
    let body: unknown;
    try { const text = await readBoundedBody(request); if (!text) return response(400, { error: 'INVALID_REQUEST' }); body = JSON.parse(text); }
    catch { return response(400, { error: 'INVALID_REQUEST' }); }
    if (!isObject(body) || typeof body.action !== 'string') return response(400, { error: 'INVALID_REQUEST' });
    const { action } = body;

    if (action === 'sites') {
      if (Object.keys(body).some(key => !['action'].includes(key))) return response(400, { error: 'INVALID_REQUEST' });
      try { return response(200, await dependencies.listSites(caller.id) as Record<string, unknown>); }
      catch { return response(503, { error: 'READ_FAILED' }); }
    }
    if (action === 'list') {
      if (Object.keys(body).some(key => !['action','search','role','active','page','pageSize'].includes(key))) return response(400, { error: 'INVALID_REQUEST' });
      const page = body.page === undefined ? 1 : body.page; const pageSize = body.pageSize === undefined ? 25 : body.pageSize;
      const search = body.search === undefined || body.search === '' ? null : body.search;
      const role = body.role === undefined || body.role === '' ? null : body.role;
      const active = body.active === undefined || body.active === '' ? null : body.active;
      if (!Number.isInteger(page) || (page as number) < 1 || !Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100
        || (search !== null && (typeof search !== 'string' || search.length > 100))
        || (role !== null && !['loading_officer','offloading_officer','operations_manager','system_administrator','finance_officer','audit_reviewer'].includes(String(role)))
        || (active !== null && typeof active !== 'boolean')) return response(400, { error: 'INVALID_FILTER' });
      try { return response(200, await dependencies.listUsers({ actorId: caller.id, search: search as string | null,
        role: role as string | null, active: active as boolean | null, page: page as number, pageSize: pageSize as number }) as Record<string, unknown>); }
      catch { return response(503, { error: 'READ_FAILED' }); }
    }
    if (action === 'view') {
      if (Object.keys(body).some(key => !['action','userId'].includes(key)) || !isUuid(body.userId)) return response(400, { error: 'INVALID_REQUEST' });
      try { return response(200, await dependencies.getUser(caller.id, body.userId) as Record<string, unknown>); }
      catch { return response(503, { error: 'READ_FAILED' }); }
    }
    if (action === 'create') {
      if (Object.keys(body).some(key => !['action','fullName','email','role','password','siteId'].includes(key))) return response(400, { error: 'INVALID_REQUEST' });
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (fullName.length < 1 || fullName.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || typeof body.role !== 'string' || !allowedRoles.includes(body.role as AllowedRole)
        || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128 || !isUuid(body.siteId)) {
        return response(400, { error: 'INVALID_REQUEST' });
      }
      let created: { id: string } | { errorStatus: number };
      try { created = await dependencies.createAuthUser({ email, password: body.password, displayName: fullName }); }
      catch { return response(503, { error: 'ACCOUNT_CREATION_FAILED' }); }
      if ('errorStatus' in created) return created.errorStatus === 422 ? response(409, { error: 'EMAIL_UNAVAILABLE' }) : response(503, { error: 'ACCOUNT_CREATION_FAILED' });
      let setup: SetupResult;
      try { setup = await dependencies.completeSetup({ profileId: created.id, displayName: fullName, role: body.role as AllowedRole, siteId: body.siteId, createdBy: caller.id }); }
      catch { try { setup = await dependencies.completeSetup({ profileId: created.id, displayName: fullName, role: body.role as AllowedRole, siteId: body.siteId, createdBy: caller.id }); }
        catch { await cleanup(dependencies, created.id, caller.id); return response(500, { error: 'SETUP_FAILED' }); } }
      if (setup.ok === false) {
        await cleanup(dependencies, created.id, caller.id);
        if (setup.code === 'CALLER_NOT_AUTHORIZED') return response(403, { error: 'FORBIDDEN' });
        if (setup.code === 'INVALID_ROLE') return response(400, { error: 'INVALID_ROLE' });
        if (['SITE_NOT_FOUND','INACTIVE_SITE','INVALID_SITE_ASSIGNMENT'].includes(setup.code)) return response(400, { error: 'INVALID_SITE' });
        return response(500, { error: 'SETUP_FAILED' });
      }
      return response(201, { user: { id: setup.profile_id, fullName: setup.display_name, email, role: setup.role, siteId: setup.site_id, siteName: setup.site_name } });
    }
    if (action === 'update_profile') {
      if (Object.keys(body).some(key => !['action','userId','fullName','role','siteId'].includes(key)) || !isUuid(body.userId)
        || typeof body.fullName !== 'string' || body.fullName.trim().length < 1 || body.fullName.trim().length > 200
        || typeof body.role !== 'string' || !allowedRoles.includes(body.role as AllowedRole) || !isUuid(body.siteId)) return response(400, { error: 'INVALID_REQUEST' });
      try { return dbFailure(await dependencies.updateProfile({ actorId: caller.id, userId: body.userId, fullName: body.fullName.trim(), role: body.role as AllowedRole, siteId: body.siteId })); }
      catch { return response(503, { error: 'UPDATE_FAILED' }); }
    }
    if (action === 'reset_password') {
      if (Object.keys(body).some(key => !['action','userId','password'].includes(key)) || !isUuid(body.userId)
        || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return response(400, { error: 'INVALID_REQUEST' });
      try {
        const audit = await dependencies.auditPasswordReset(caller.id, body.userId, false);
        if (!audit.ok) return dbFailure(audit);
        if (!await dependencies.updateAuthPassword(body.userId, body.password)) return response(503, { error: 'PASSWORD_RESET_FAILED' });
        const completed = await dependencies.auditPasswordReset(caller.id, body.userId, true);
        if (!completed.ok) return response(500, { error: 'PASSWORD_RESET_AUDIT_FAILED' });
        return response(200, { ok: true });
      } catch { return response(503, { error: 'PASSWORD_RESET_FAILED' }); }
    }
    if (action === 'deactivate' || action === 'reactivate') {
      if (Object.keys(body).some(key => !['action','userId'].includes(key)) || !isUuid(body.userId)) return response(400, { error: 'INVALID_REQUEST' });
      const active = action === 'reactivate';
      try {
        const target = await dependencies.getUser(caller.id, body.userId) as { ok?: unknown; user?: { role?: unknown } } | null;
        if (target?.ok !== true || !target.user) return response(404, { error: 'USER_NOT_FOUND' });
        if (target.user.role !== 'loading_officer' && target.user.role !== 'offloading_officer') return response(409, { error: 'TARGET_NOT_MANAGEABLE' });
        if (!active && body.userId === caller.id) return response(409, { error: 'SELF_DEACTIVATION_DENIED' });
        if (!await dependencies.setAuthBanned(body.userId, !active)) return response(503, { error: 'AUTH_ACCESS_UPDATE_FAILED' });
        const result = await dependencies.setActive(caller.id, body.userId, active);
        if (!result.ok) { await dependencies.setAuthBanned(body.userId, active); return dbFailure(result); }
        return response(200, { ok: true, changed: result.changed ?? true });
      } catch { await dependencies.setAuthBanned(body.userId, active); return response(503, { error: 'ACCOUNT_STATUS_UPDATE_FAILED' }); }
    }
    return response(400, { error: 'INVALID_ACTION' });
  };
}
