import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const router = require('react-router-dom');
const { renderToStaticMarkup } = require('react-dom/server');
const overrides = new Map();
const cache = new Map();
let account = { status: 'unauthenticated' };
globalThis.__portalTestPath = '/';

function load(path) {
  const full = resolve(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const output = ts.transpileModule(readFileSync(full, 'utf8').replaceAll('import.meta.env', 'globalThis.__testEnv'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`].find(existsSync);
    assert(target, `Local import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

overrides.set('react-router-dom', {
  ...router,
  BrowserRouter: ({ children }) => React.createElement(router.MemoryRouter,
    { initialEntries: [globalThis.__portalTestPath] }, children),
});
overrides.set(resolve('src/auth/AuthProvider.tsx'), {
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ account, signOut() {}, signingOut: false, signOutError: null }),
});
overrides.set(resolve('src/lib/supabase.ts'), { configurationError: null });
overrides.set(resolve('src/components/SignOutButton.tsx'), {
  SignOutButton: () => React.createElement('button', null, 'Sign Out'),
});
overrides.set(resolve('src/features/loading/LoadingPortal.tsx'), {
  LoadingPortal: () => React.createElement('p', null, 'Loading workflow'),
});
overrides.set(resolve('src/features/offloading/OffloadingPortal.tsx'), {
  OffloadingPortal: () => React.createElement('p', null, 'Offloading workflow'),
});

const { default: App } = load('src/App.tsx');
const { ADMIN_NAVIGATION, OPERATIONS_NAVIGATION, PORTALS, destinationForRole } = load('src/routing/roleRoutes.ts');
const { APP_ROLES } = load('src/types/profile.ts');
const renderApp = (path, role, status = 'active') => {
  globalThis.__portalTestPath = path;
  account = { status, session: {}, profile: { id: 'actor', role, display_name: 'Test Actor', is_active: status === 'active' } };
  return renderToStaticMarkup(React.createElement(App));
};

const operationsPaths = ['/operations', '/operations/trips', '/operations/trucks-drivers',
  '/operations/waybills-payouts', '/operations/exceptions', '/operations/reports'];
const operationsTripDetailPath = '/operations/trips/00000000-0000-0000-0000-000000000001';
const adminPaths = ['/admin', '/admin/users', '/admin/sites', '/admin/configuration', '/admin/audit'];
assert.deepEqual(OPERATIONS_NAVIGATION.map(item => item.route ? `/operations/${item.route}` : '/operations'), operationsPaths);
assert.deepEqual(ADMIN_NAVIGATION.map(item => item.route ? `/admin/${item.route}` : '/admin'), adminPaths);

const trucksDriversRoute = findElement(App(), element => element.type === router.Route && element.props.path === 'trucks-drivers');
assert(trucksDriversRoute && trucksDriversRoute.props.element.type === router.Navigate);
const trucksDriversTarget = router.resolvePath(trucksDriversRoute.props.element.props.to, '/operations/trucks-drivers').pathname;
assert.equal(trucksDriversTarget, '/operations/trucks-drivers/trucks');
assert(renderApp(trucksDriversTarget, 'operations_manager').includes('Search plate'));
assert(renderApp(trucksDriversTarget, 'operations_manager').includes('aria-current="page"'));
assert(!renderApp(trucksDriversTarget, 'loading_officer').includes('Search plate'));
console.log('PASS Trucks & Drivers navigation resolves within its module and retains exact-role protection');

for (const path of operationsPaths) {
  const output = renderApp(path, 'operations_manager');
  if (path === '/operations') {
    assert(output.includes('Loading results'));
    assert(!output.includes('This module is a Phase 1 placeholder'));
  } else if (path === '/operations/trips') {
    assert(output.includes('Trip register filters'));
    assert(output.includes('Loading results'));
    assert(!output.includes('This module is a Phase 1 placeholder'));
  } else if (path === '/operations/trucks-drivers') {
    assert(!output.includes('This module is a Phase 1 placeholder'));
  } else if (path === '/operations/waybills-payouts') {
    assert(output.includes('Loading results'));
    assert(!output.includes('This module is a Phase 1 placeholder'));
  } else assert(output.includes('This module is a Phase 1 placeholder'));
  assert(output.includes('Operations navigation'));
  assert(!renderApp(path, 'system_administrator').includes('This module is a Phase 1 placeholder'));
}
const tripDetail = renderApp(operationsTripDetailPath, 'operations_manager');
assert(tripDetail.includes('Loading results'));
assert(tripDetail.includes('href="/operations/trips"'));
assert(tripDetail.includes('aria-current="page"'));
assert(!tripDetail.includes('This module is a Phase 1 placeholder'));
for (const role of APP_ROLES.filter(role => role !== 'operations_manager')) {
  assert(!renderApp(operationsTripDetailPath, role).includes('Read-only lifecycle record'));
}
for (const path of ['/operations/trucks-drivers/trucks', '/operations/trucks-drivers/drivers',
  '/operations/trucks-drivers/trucks/00000000-0000-0000-0000-000000000001',
  '/operations/trucks-drivers/drivers/00000000-0000-0000-0000-000000000001']) {
  assert(renderApp(path, 'operations_manager').includes('Loading results'));
  assert(renderApp(path, 'operations_manager').includes('aria-current="page"'));
  for (const role of APP_ROLES.filter(role => role !== 'operations_manager')) {
    assert(!renderApp(path, role).includes('Loading results'));
  }
}
const waybillDetailPath = '/operations/waybills-payouts/00000000-0000-0000-0000-000000000001';
assert(renderApp(waybillDetailPath, 'operations_manager').includes('Loading results'));
assert(renderApp(waybillDetailPath, 'operations_manager').includes('aria-current="page"'));
for (const role of APP_ROLES.filter(role => role !== 'operations_manager')) {
  assert(!renderApp(waybillDetailPath, role).includes('Loading results'));
}
for (const path of adminPaths) {
  const output = renderApp(path, 'system_administrator');
  assert(output.includes('This module is a Phase 1 placeholder'));
  assert(output.includes('Administration navigation'));
  assert(!renderApp(path, 'operations_manager').includes('This module is a Phase 1 placeholder'));
}
for (const role of APP_ROLES.filter(role => !['operations_manager', 'system_administrator'].includes(role))) {
  for (const path of [...operationsPaths, ...adminPaths]) {
    assert(!renderApp(path, role).includes('This module is a Phase 1 placeholder'));
  }
}
assert.equal(destinationForRole('finance_officer'), '/access-denied');
assert.equal(destinationForRole('audit_reviewer'), '/access-denied');
for (const path of [...operationsPaths, ...adminPaths]) {
  assert(!renderApp(path, 'operations_manager', 'inactive').includes('This module is a Phase 1 placeholder'));
  assert(!renderApp(path, 'system_administrator', 'inactive').includes('This module is a Phase 1 placeholder'));
}
assert(renderApp('/loading', 'loading_officer').includes('Loading workflow'));
assert(renderApp('/offloading', 'offloading_officer').includes('Offloading workflow'));
assert(!renderApp('/operations/trips', 'loading_officer').includes('This module is a Phase 1 placeholder'));
assert(!renderApp('/admin/users', 'offloading_officer').includes('This module is a Phase 1 placeholder'));
console.log('PASS nested portal paths, direct URL role denial, inactive accounts, Finance/Audit and field portal routes');

const activeOperations = renderApp('/operations/trips', 'operations_manager');
assert(activeOperations.includes('href="/operations/trips"'));
assert(activeOperations.includes('aria-current="page"'));
assert(activeOperations.includes('class="portal-navigation-link active"'));
assert(activeOperations.includes('href="/operations"'));
const activeAdmin = renderApp('/admin/audit', 'system_administrator');
assert(activeAdmin.includes('href="/admin/audit"'));
assert(activeAdmin.includes('aria-current="page"'));
assert(activeAdmin.includes('Audit Logs'));
assert(renderApp('/operations', 'operations_manager').includes('Loading results'));
assert(renderApp('/admin', 'system_administrator').includes('<h1>Administration Dashboard</h1>'));
console.log('PASS role-specific navigation, active route indication and module placeholders');

const { ListToolbar } = load('src/components/data/ListToolbar.tsx');
const { ListResultState } = load('src/components/data/ListResultState.tsx');
const { PaginationControls } = load('src/components/data/PaginationControls.tsx');
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SERVER_PAGE_TIE_BREAKER, normalizePageRequest } = load('src/types/listQuery.ts');
const filters = { search: 'truck', status: 'open', dateFrom: '2026-09-01', dateTo: '2026-09-27' };
function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  } else if (React.isValidElement(node)) {
    if (predicate(node)) return node;
    return findElement(node.props.children, predicate);
  }
  return null;
}
let changedFilters;
const toolbarTree = ListToolbar({
  filters,
  onChange: value => { changedFilters = value; },
  statusOptions: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
  showDateRange: true,
});
const toolbar = renderToStaticMarkup(React.createElement(ListToolbar, {
  filters,
  onChange() {},
  statusOptions: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
  showDateRange: true,
}));
assert(toolbar.includes('aria-label="List filters"'));
assert(toolbar.includes('id="list-search"') && toolbar.includes('id="list-status"'));
assert(toolbar.includes('id="list-date-from"') && toolbar.includes('id="list-date-to"'));
assert(toolbar.includes('Clear filters'));
findElement(toolbarTree, element => element.props.id === 'list-search').props.onChange({ currentTarget: { value: 'plate' } });
assert.deepEqual(changedFilters, { ...filters, search: 'plate' });
findElement(toolbarTree, element => element.props.id === 'list-status').props.onChange({ currentTarget: { value: 'closed' } });
assert.deepEqual(changedFilters, { ...filters, status: 'closed' });
findElement(toolbarTree, element => element.type === 'button').props.onClick();
assert.deepEqual(changedFilters, { search: '', status: '', dateFrom: '', dateTo: '' });

assert(renderToStaticMarkup(React.createElement(ListResultState, { status: 'loading' })).includes('role="status"'));
assert(renderToStaticMarkup(React.createElement(ListResultState, { status: 'empty' })).includes('No results found.'));
let retried = false;
const errorState = ListResultState({ status: 'error', message: 'Unable to load', onRetry: () => { retried = true; } });
const errorButton = React.Children.toArray(errorState.props.children).find(child => React.isValidElement(child) && child.type === 'button');
errorButton.props.onClick();
assert(retried);
assert(renderToStaticMarkup(React.createElement(ListResultState, { status: 'ready', children: React.createElement('p', null, 'Rows') })).includes('Rows'));

assert.equal(DEFAULT_PAGE_SIZE, 25);
assert.equal(MAX_PAGE_SIZE, 100);
assert.equal(SERVER_PAGE_TIE_BREAKER, 'id');
assert.deepEqual(normalizePageRequest(0, 0), { page: 1, pageSize: 25 });
assert.deepEqual(normalizePageRequest(2, 500), { page: 2, pageSize: 100 });
let changedPage;
const pagination = PaginationControls({ page: 2, pageSize: 25, totalCount: 60, onPageChange: page => { changedPage = page; } });
const pageButtons = React.Children.toArray(pagination.props.children[1].props.children);
assert.equal(pageButtons[0].props.disabled, false);
assert.equal(pageButtons[1].props.disabled, false);
pageButtons[1].props.onClick();
assert.equal(changedPage, 3);
assert(renderToStaticMarkup(React.createElement(PaginationControls, { page: 1, pageSize: 25, totalCount: 0, onPageChange() {} })).includes('Showing 0–0 of 0'));
console.log('PASS shared filters, result states, retry action and bounded server pagination contract');

delete globalThis.__portalTestPath;
