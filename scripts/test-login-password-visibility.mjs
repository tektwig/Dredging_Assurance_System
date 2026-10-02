// Login password visibility interaction test using a DOM and keyboard events.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import userEvent from '@testing-library/user-event';
import ts from 'typescript';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const overrides = new Map();
const cache = new Map();
const absolute = path => resolve(path);
function load(path) {
  const full = absolute(path);
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
    const target = [base, base + '.ts', base + '.tsx'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

let signIns = 0;
overrides.set(absolute('src/auth/AuthProvider.tsx'), {
  useAuth: () => ({ signIn: async () => { signIns++; return true; }, fieldSessionNotice: null }),
});
const { LoginPage } = load('src/pages/LoginPage.tsx');
const rootElement = document.getElementById('root');
const root = createRoot(rootElement);
await act(async () => root.render(React.createElement(LoginPage)));
const user = userEvent.setup({ document });
const password = document.getElementById('password');
const toggleFor = action => document.querySelector(`button[aria-label="${action} password"]`);
assert(password && toggleFor('Show'), 'Password field and Show control render');
const observedInputTypes = [];
const recordTypeChanges = records => {
  for (const record of records) observedInputTypes.push(record.oldValue, record.target.getAttribute('type'));
};
const typeObserver = new dom.window.MutationObserver(recordTypeChanges);
typeObserver.observe(password, { attributes: true, attributeFilter: ['type'], attributeOldValue: true });
function assertPasswordType(expected) {
  recordTypeChanges(typeObserver.takeRecords());
  assert.equal(password.getAttribute('type'), expected, `Password input attribute is ${expected}`);
  assert.equal(password.type, expected, `Browser input type is ${expected}`);
  assert(!observedInputTypes.includes('hide'), 'The invalid hide input type is never assigned');
}
assertPasswordType('password');
assert.equal(toggleFor('Show')?.getAttribute('type'), 'button', 'Visibility control cannot submit the form');
assert(toggleFor('Show')?.querySelector('svg')?.classList.contains('lucide-eye'), 'Masked state shows the eye icon for the Show action');
assert.equal(toggleFor('Show')?.querySelector('svg')?.getAttribute('aria-hidden'), 'true', 'Icon is decorative to assistive tech');

await act(async () => user.type(password, 'Officer secret 42'));
assert.equal(password.value, 'Officer secret 42');
await act(async () => user.click(toggleFor('Show')));
assertPasswordType('text');
assert(toggleFor('Hide'), 'Visible state offers the Hide action');
assert(toggleFor('Hide')?.querySelector('svg')?.classList.contains('lucide-eye-off'), 'Visible state shows the eye-off icon for the Hide action');
assert.equal(password.value, 'Officer secret 42', 'Showing does not modify the value');
assert.equal(signIns, 0, 'Visibility click does not submit the login form');
await act(async () => user.click(toggleFor('Hide')));
assertPasswordType('password');
assert(toggleFor('Show'), 'Masked state offers the Show action again');
assert.equal(password.value, 'Officer secret 42', 'Hiding does not modify the value');

password.focus();
await act(async () => user.tab());
assert.equal(document.activeElement, toggleFor('Show'), 'Toggle is reachable by keyboard');
await act(async () => user.keyboard('{Enter}'));
assertPasswordType('text');
await act(async () => user.keyboard(' '));
assertPasswordType('password');
assert.equal(signIns, 0, 'Keyboard toggling does not submit the form');
assert.equal(password.value, 'Officer secret 42');

recordTypeChanges(typeObserver.takeRecords());
assert(!observedInputTypes.includes('hide'), 'No observed input type mutation assigns hide');
typeObserver.disconnect();
await act(async () => root.unmount());
dom.window.close();
console.log('PASS password visibility state, value retention, submit isolation, labels, icon and keyboard behavior');
