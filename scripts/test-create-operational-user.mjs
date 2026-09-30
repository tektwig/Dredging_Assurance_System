import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path) {
  const full = resolve(path);
  const source = readFileSync(full, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (!name.startsWith('.')) return require(name);
    const target = resolve(dirname(full), name);
    return load(target.endsWith('.ts') ? target : `${target}.ts`);
  }, module, module.exports);
  return module.exports;
}

const { createOperationalUserHandler } = load('supabase/functions/create-operational-user/handler.ts');
const ids = {
  ops: '10000000-0000-4000-8000-000000000001',
  user: '20000000-0000-4000-8000-000000000001',
  site: '30000000-0000-4000-8000-000000000001',
};
const validBody = { action: 'create', fullName: 'Loading Officer', email: 'worker@example.test', role: 'loading_officer',
  password: 'Strong-demo-password-9', siteId: ids.site };
function setup(overrides = {}) {
  const calls = { authenticate: 0, profile: 0, create: [], finalize: [], cleanup: [], sites: 0, list: [], views: [], updates: [], statuses: [], passwordAudit: [], passwords: [], bans: [] };
  const deps = {
    configured: true,
    async authenticate(token) { calls.authenticate++; return token === 'valid-session' ? { id: ids.ops } : null; },
    async getProfile() { calls.profile++; return { role: 'operations_manager', is_active: true }; },
    async createAuthUser(input) { calls.create.push(input); return { id: ids.user }; },
    async completeSetup(input) { calls.finalize.push(input); return { ok: true, profile_id: ids.user,
      display_name: input.displayName, role: input.role, site_id: ids.site, site_name: 'Loading Yard' }; },
    async compensateIncompleteUser(id, createdBy) { calls.cleanup.push({ id, createdBy }); },
    async listSites(actorId) { calls.sites++; return { ok: true, sites: [] }; },
    async listUsers(input) { calls.list.push(input); return { ok: true, page: input.page, page_size: input.pageSize, total: 0, users: [] }; },
    async getUser(actorId, userId) { calls.views.push({ actorId, userId }); return { ok: true, user: { id: userId, role: 'loading_officer' } }; },
    async updateProfile(input) { calls.updates.push(input); return { ok: true }; },
    async setActive(actorId, userId, active) { calls.statuses.push({ actorId, userId, active }); return { ok: true, changed: true }; },
    async auditPasswordReset(actorId, userId, completed) { calls.passwordAudit.push({ actorId, userId, completed }); return { ok: true }; },
    async updateAuthPassword(userId, password) { calls.passwords.push({ userId, password }); return true; },
    async setAuthBanned(userId, banned) { calls.bans.push({ userId, banned }); return true; },
    ...overrides,
  };
  return { handler: createOperationalUserHandler(deps), deps, calls };
}
const request = (body = validBody, token = 'valid-session') => new Request('https://example.test/functions/v1/create-operational-user', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const json = async response => response.json();

{
  const { handler, calls } = setup();
  const result = await handler(request());
  assert.equal(result.status, 201);
  const body = await json(result);
  assert.deepEqual(body.user, { id: ids.user, fullName: 'Loading Officer', email: 'worker@example.test',
    role: 'loading_officer', siteId: ids.site, siteName: 'Loading Yard' });
  assert(!JSON.stringify(body).includes(validBody.password));
assert.equal(calls.create[0].password, validBody.password);
  assert.deepEqual(calls.finalize[0], { profileId: ids.user, displayName: 'Loading Officer',
    role: 'loading_officer', siteId: ids.site, createdBy: ids.ops });
  assert.equal(calls.cleanup.length, 0);
}
{
  const { handler, calls } = setup();
  const result = await handler(request({ ...validBody, role: 'offloading_officer' }));
  assert.equal(result.status, 201);
assert.equal(calls.finalize[0].role, 'offloading_officer');
}

for (const caller of [null, { role: 'finance_officer', is_active: true },
  { role: 'operations_manager', is_active: false }]) {
  const { handler, calls } = setup({
    authenticate: async token => token === 'valid-session' ? { id: ids.ops } : null,
    getProfile: async () => caller,
  });
  const result = await handler(request());
  assert([401, 403].includes(result.status));
  assert.equal(calls.create.length, 0, 'unauthorized and inactive callers cannot create Auth users');
}

{
  const { handler, calls } = setup();
  const result = await handler(new Request('https://example.test/create', { method: 'POST', body: JSON.stringify(validBody) }));
  assert.equal(result.status, 401);
  assert.equal(calls.profile, 0);
}

for (const invalid of [
  { ...validBody, role: 'system_administrator' },
  { ...validBody, role: 'finance_officer' },
  { ...validBody, role: 'invented_role' },
  { ...validBody, siteId: null },
  { ...validBody, password: 'short' },
  { ...validBody, password: 'x'.repeat(129) },
  { ...validBody, confirmPassword: validBody.password },
]) {
  const { handler, calls } = setup();
  assert.equal((await handler(request(invalid))).status, 400);
  assert.equal(calls.create.length, 0);
}

{
  const { handler, calls } = setup({ createAuthUser: async () => ({ errorStatus: 422 }) });
  const result = await handler(request());
  assert.equal(result.status, 409);
  assert.equal((await json(result)).error, 'EMAIL_UNAVAILABLE');
  assert.equal(calls.finalize.length, 0);
}

{
  const { handler, calls } = setup({ completeSetup: async () => ({ ok: false, code: 'INACTIVE_SITE' }) });
  const result = await handler(request());
  assert.equal(result.status, 400);
  assert.equal((await json(result)).error, 'INVALID_SITE');
  assert.deepEqual(calls.cleanup, [{ id: ids.user, createdBy: ids.ops }]);
}

{
  const { handler, calls } = setup({ completeSetup: async () => { throw new Error('database detail with secret'); } });
  const result = await handler(request());
  const body = await json(result);
  assert.equal(result.status, 500);
  assert(!JSON.stringify(body).includes('database detail'));
  assert.deepEqual(calls.cleanup, [{ id: ids.user, createdBy: ids.ops }]);
}

{
  const { handler, calls } = setup();
  const result = await handler(request({ action: 'sites' }));
  assert.equal(result.status, 200);
  assert.equal(calls.sites, 1);
}
{
  const { handler, calls } = setup();
  const result = await handler(request({ action: 'list', search: 'Worker', role: 'loading_officer', active: true, page: 2, pageSize: 25 }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls.list[0], { actorId: ids.ops, search: 'Worker', role: 'loading_officer', active: true, page: 2, pageSize: 25 });
  for (const bad of [{ page: 0 }, { pageSize: 101 }, { role: 'bogus' }, { active: 'true' }]) {
    assert.equal((await handler(request({ action: 'list', ...bad }))).status, 400);
  }
}
{
  const { handler, calls } = setup();
  assert.equal((await handler(request({ action: 'view', userId: ids.user }))).status, 200);
  assert.deepEqual(calls.views[0], { actorId: ids.ops, userId: ids.user });
}
{
  const { handler, calls } = setup();
  const result = await handler(request({ action: 'update_profile', userId: ids.user,
    fullName: 'Updated User', role: 'offloading_officer', siteId: ids.site }));
  assert.equal(result.status, 200);
  assert.equal(calls.updates[0].role, 'offloading_officer');
  assert.equal((await handler(request({ action: 'update_profile', userId: ids.user,
    fullName: 'Updated User', role: 'operations_manager', siteId: ids.site }))).status, 400);
}
{
  const { handler, calls } = setup();
  const secret = 'New-demo-password-123';
  const result = await handler(request({ action: 'reset_password', userId: ids.user, password: secret }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls.passwordAudit, [{ actorId: ids.ops, userId: ids.user, completed: false },
    { actorId: ids.ops, userId: ids.user, completed: true }]);
  assert.equal(calls.passwords[0].password, secret);
  assert(!JSON.stringify(await json(result)).includes(secret));
  assert.equal((await handler(request({ action: 'reset_password', userId: ids.user, password: 'short' }))).status, 400);
}
{
  const { handler, calls } = setup();
  const result = await handler(request({ action: 'deactivate', userId: ids.user }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls.bans, [{ userId: ids.user, banned: true }]);
  assert.deepEqual(calls.statuses[0], { actorId: ids.ops, userId: ids.user, active: false });
  assert.equal((await handler(request({ action: 'deactivate', userId: ids.ops }))).status, 409);
  assert.equal(calls.statuses.length, 1, 'self-deactivation is rejected before profile mutation');
}
{
  const { handler, calls } = setup({ getUser: async (actorId, userId) => ({ ok: true, user: { id: userId, role: 'system_administrator' } }) });
  assert.equal((await handler(request({ action: 'deactivate', userId: ids.user }))).status, 409);
  assert.equal(calls.bans.length, 0, 'privileged accounts cannot be temporarily banned by rejected Operations action');
}

const routeTests = readFileSync(resolve('scripts/test-management-portal-foundation.mjs'), 'utf8');
assert(routeTests.includes('/operations/manage-credentials'));
assert(readFileSync(resolve('src/App.tsx'), 'utf8').includes('path="manage-credentials"'));
assert(readFileSync(resolve('src/layouts/AuthenticatedLayout.tsx'), 'utf8').includes('accountAction'));
const pageSource = readFileSync(resolve('src/features/operations/credentials/CreateCredentialsPage.tsx'), 'utf8');
assert(pageSource.includes('Full Name') && pageSource.includes('Confirm Password')
  && pageSource.includes('Create Another User') && pageSource.includes('Show password'));
assert(pageSource.includes('value="loading_officer"') && pageSource.includes('value="offloading_officer"'));
assert(!pageSource.includes('value="system_administrator"') && !pageSource.includes('value="finance_officer"'));
assert(pageSource.includes("setPassword('')") && pageSource.includes("setConfirmPassword('')"));
const serviceSource = readFileSync(resolve('src/features/operations/credentials/credentialService.ts'), 'utf8');
assert(!serviceSource.includes(".from('sites')") && serviceSource.includes("supabase.functions.invoke('create-operational-user'"));
const managementPage = readFileSync(resolve('src/features/operations/credentials/ManageCredentialsPage.tsx'), 'utf8');
for (const copy of ['Users', 'Create User', 'Full Name', 'Assigned Site', 'Active', 'Inactive', 'View', 'Edit', 'Reset Password', 'Deactivate', 'Reactivate']) assert(managementPage.includes(copy));
assert(managementPage.includes('readOnly') && managementPage.includes('Password cannot be retrieved'));
assert(managementPage.includes('listCredentialUsers') && managementPage.includes('pageSize: 25'));
const edgeSource = readFileSync(resolve('supabase/functions/create-operational-user/index.ts'), 'utf8');
const edgeCompile = ts.transpileModule(edgeSource, { reportDiagnostics: true, compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} });
assert.equal(edgeCompile.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
assert(edgeSource.includes('SUPABASE_SERVICE_ROLE_KEY') && edgeSource.includes('Deno.serve'));
assert(!pageSource.includes('SUPABASE_SERVICE_ROLE_KEY') && !serviceSource.includes('SUPABASE_SERVICE_ROLE_KEY'));
console.log('PASS Operations-only credential handler, role/site allowlists, password safety, duplicate and compensation behavior');
