// In-memory TypeScript compilation and React rendering; no network or database writes.
// Test doubles supply account states and expose router decisions without a browser.
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
  const source = readFileSync(full, 'utf8').replaceAll('import.meta.env', 'globalThis.__testEnv');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx'].find(existsSync);
    assert(target, 'Local import must resolve');
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

let account = { status: 'unauthenticated' };
overrides.set(absolute('src/auth/AuthProvider.tsx'), {
  useAuth: () => ({ account, retry() {}, signOut() {}, signIn: async () => false, signingOut: false, signOutError: null }),
});
overrides.set('react-router-dom', {
  Navigate: ({ to }) => React.createElement('span', { 'data-redirect': to }),
  Outlet: () => React.createElement('span', { 'data-outlet': 'allowed' }),
  Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children),
});
const { APP_ROLES, isProfile } = load('src/types/profile.ts');
const { PORTALS, destinationForRole } = load('src/routing/roleRoutes.ts');
const guards = load('src/routing/RouteGuards.tsx');
const { AccessDeniedPage } = load('src/pages/AccessDeniedPage.tsx');
const { AuthenticatedLayout } = load('src/layouts/AuthenticatedLayout.tsx');
const { LoginPage } = load('src/pages/LoginPage.tsx');
const { DISABLED_ACCOUNT } = load('src/auth/authState.ts');

const profile = role => ({
  id: 'test-user', display_name: 'Test Officer', role, is_active: true,
  created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
});
const render = (component, props = {}) => renderToStaticMarkup(React.createElement(component, props));
const redirect = (component, destination, props) =>
  assert(render(component, props).includes('data-redirect="' + destination + '"'));
const allowed = (component, props) => assert(render(component, props).includes('data-outlet="allowed"'));

for (const role of APP_ROLES) {
  account = { status: 'active', session: {}, profile: profile(role) };
  assert(isProfile(account.profile));
  const destination = PORTALS[role]?.path ?? '/access-denied';
  assert.equal(destinationForRole(role), destination);
  redirect(guards.LoginOnly, destination);
  redirect(guards.HomeRedirect, destination);
  allowed(guards.RequireSession);
  for (const portalRole of Object.keys(PORTALS)) {
    if (role === portalRole) allowed(guards.RequireRole, { role: portalRole });
    else redirect(guards.RequireRole, '/access-denied', { role: portalRole });
  }
  if (destination === '/access-denied') {
    assert(render(AccessDeniedPage).includes('Portal not available for your role'));
    assert(!render(AccessDeniedPage).includes('Go to my portal'));
  } else {
    assert(render(AccessDeniedPage).includes('href="' + destination + '"'));
    assert(render(AuthenticatedLayout).includes('Test Officer'));
  }
}
console.log('PASS six-role destination matrix, cross-portal denial, login redirects and shell');

for (const status of ['inactive', 'missing-profile', 'profile-error']) {
  account = { status, session: {}, profile: { ...profile('loading_officer'), is_active: false } };
  for (const role of Object.keys(PORTALS)) redirect(guards.RequireRole, '/access-denied', { role });
  redirect(guards.LoginOnly, '/access-denied');
  const page = render(AccessDeniedPage);
  assert(page.includes('Sign Out'));
  assert(!page.includes('Go to my portal'));
  if (status === 'inactive') assert(page.includes(DISABLED_ACCOUNT));
  if (status === 'missing-profile') assert(page.includes('Account profile missing'));
  if (status === 'profile-error') assert(page.includes('Unable to verify your account'));
}
console.log('PASS inactive, missing-profile and database-error states deny every portal');

account = { status: 'unauthenticated' };
allowed(guards.LoginOnly);
redirect(guards.RequireSession, '/login');
redirect(guards.HomeRedirect, '/login');
for (const role of Object.keys(PORTALS)) redirect(guards.RequireRole, '/login', { role });
const login = render(LoginPage);
assert(login.includes('type="email"') && login.includes('type="password"'));
assert(!/Forgot Password|Sign Up|Google|Facebook/i.test(login));
console.log('PASS unauthenticated redirects and centralized password-only login');

for (const status of ['restoring', 'loading-profile', 'session-error']) {
  account = { status, session: {} };
  const output = render(guards.AccountGate);
  assert(!output.includes('data-outlet'));
  if (status !== 'session-error') assert(output.includes('aria-busy="true"'));
  else assert(output.includes('Try again'));
}
console.log('PASS startup/profile loading and session-error gates');

assert(!isProfile(null));
assert(!isProfile({ ...profile('loading_officer'), role: 'invented_role' }));
assert(!isProfile({ ...profile('loading_officer'), role: null }));
assert(!isProfile({ ...profile('loading_officer'), is_active: 'true' }));
assert(isProfile({ ...profile(null), is_active: false }));
const migration = readFileSync('supabase/migrations/20260921000100_mvp_foundation.sql', 'utf8');
const actualRoles = [...migration.match(/create type public.app_role as enum \(([^;]+)\);/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual([...APP_ROLES].sort(), actualRoles.sort());
console.log('PASS profile runtime validation and actual migration role contract');

let configurationCalls = [];
overrides.set('@supabase/supabase-js', {
  createClient: (...args) => { configurationCalls.push(args); return { mocked: true }; },
});
function configure(env) {
  configurationCalls = [];
  globalThis.__testEnv = env;
  cache.delete(absolute('src/lib/supabase.ts'));
  return load('src/lib/supabase.ts');
}
const jwt = role => 'fixture.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixture';
assert(configure({ DEV: true }).configurationError.includes('VITE_SUPABASE_URL'));
assert.equal(configurationCalls.length, 0);
assert(configure({ DEV: false }).configurationError.includes('contact your administrator'));
for (const key of [jwt('service_role'), 'sb_secret_test', 'not-a-key']) {
  assert.equal(configure({ DEV: true, VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: key }).supabase, null);
  assert.equal(configurationCalls.length, 0);
}
assert(configure({ DEV: true, VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: jwt('anon') }).supabase);
assert.equal(configurationCalls[0][2].auth.storageKey, 'dredging-frontend-backup-auth');
delete globalThis.__testEnv;
console.log('PASS configuration failure handling and privileged-key rejection');