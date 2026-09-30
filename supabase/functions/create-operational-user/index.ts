import { createOperationalUserHandler, type CredentialDependencies, type SetupResult } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const configured = !!supabaseUrl && !!serviceRoleKey;
function serviceHeaders() { return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }; }
async function readJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }
async function rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { ...serviceHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error('Credential RPC unavailable');
  return readJson(response);
}

const dependencies: CredentialDependencies = {
  configured,
  async authenticate(token) {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const user = await readJson(response) as { id?: unknown } | null;
    return typeof user?.id === 'string' ? { id: user.id } : null;
  },
  async getProfile(id) {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_operational_credential_creator`, {
      method: 'POST', headers: { ...serviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_profile_id: id }),
    });
    if (!response.ok) throw new Error('Caller verification unavailable');
    const profile = await readJson(response) as { role?: unknown; is_active?: unknown } | null;
    if (!profile || typeof profile.is_active !== 'boolean' || (profile.role !== null && typeof profile.role !== 'string')) return null;
    return { role: profile.role as string | null, is_active: profile.is_active };
  },
  async createAuthUser(input) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, { method: 'POST',
      headers: { ...serviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true,
        user_metadata: { display_name: input.displayName } }) });
    if (!response.ok) return { errorStatus: response.status };
    const user = await readJson(response) as { id?: unknown } | null;
    if (typeof user?.id !== 'string') throw new Error('Auth response invalid');
    return { id: user.id };
  },
  async completeSetup(input) {
    const setup = await rpc('complete_operational_user_setup', { p_profile_id: input.profileId,
      p_display_name: input.displayName, p_role: input.role, p_site_id: input.siteId, p_created_by: input.createdBy }) as Record<string, unknown> | null;
    if (setup?.ok === true && typeof setup.profile_id === 'string' && typeof setup.display_name === 'string'
      && typeof setup.role === 'string' && typeof setup.site_id === 'string' && typeof setup.site_name === 'string') return setup as SetupResult;
    if (setup?.ok === false && typeof setup.code === 'string') return setup as SetupResult;
    throw new Error('Credential setup response invalid');
  },
  async compensateIncompleteUser(id, createdBy) {
    let profileRemoved = false;
    try { const result = await rpc('discard_incomplete_operational_user', { p_profile_id: id, p_created_by: createdBy }) as { ok?: unknown };
      profileRemoved = result?.ok === true; } catch { /* Fall through to disabling Auth account. */ }
    if (profileRemoved) {
      const deleted = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: serviceHeaders() });
      if (deleted.ok) return;
    }
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT',
      headers: { ...serviceHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ban_duration: '876000h' }) });
  },
  async listSites(actorId) { return rpc('list_operational_credential_sites', { p_actor_id: actorId }); },
  async listUsers(input) { return rpc('list_operational_credential_users', { p_actor_id: input.actorId,
    p_search: input.search, p_role: input.role, p_active: input.active, p_page: input.page, p_page_size: input.pageSize }); },
  async getUser(actorId, userId) { return rpc('get_operational_credential_user', { p_actor_id: actorId, p_user_id: userId }); },
  async updateProfile(input) { return await rpc('update_operational_credential_profile', { p_actor_id: input.actorId,
    p_user_id: input.userId, p_full_name: input.fullName, p_role: input.role, p_site_id: input.siteId }) as { ok: boolean; code?: string }; },
  async setActive(actorId, userId, active) { return await rpc('set_operational_credential_active', {
    p_actor_id: actorId, p_user_id: userId, p_is_active: active }) as { ok: boolean; code?: string; changed?: boolean }; },
  async auditPasswordReset(actorId, userId, completed) { return await rpc('audit_operational_credential_password_reset', {
    p_actor_id: actorId, p_user_id: userId, p_completed: completed }) as { ok: boolean; code?: string }; },
  async updateAuthPassword(userId, password) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT',
      headers: { ...serviceHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    return response.ok;
  },
  async setAuthBanned(userId, banned) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT',
      headers: { ...serviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ban_duration: banned ? '876000h' : 'none' }) });
    return response.ok;
  },
};

Deno.serve(createOperationalUserHandler(dependencies));
