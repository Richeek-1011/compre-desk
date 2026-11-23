import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { THEME_KEY, readPref, savePref, effective, opposite, labelFor, initTheme } from '../js/theme.js';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };

test('reads only valid saved choices', () => {
  assert.equal(readPref(memStore()), null);
  assert.equal(readPref(memStore({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(readPref(memStore({ [THEME_KEY]: 'light' })), 'light');
  assert.equal(readPref(memStore({ [THEME_KEY]: 'purple' })), null);
  assert.equal(readPref(broken), null);
  assert.equal(readPref(undefined), null);
});

test('saves, clears and survives blocked storage', () => {
  const s = memStore();
  assert.equal(savePref(s, 'dark'), true); assert.equal(s.getItem(THEME_KEY), 'dark');
  assert.equal(savePref(s, null), true); assert.equal(s.getItem(THEME_KEY), null);
  assert.equal(savePref(broken, 'dark'), false);
});

test('a manual choice beats the system; no choice follows it', () => {
  assert.equal(effective(null, true), 'dark');
  assert.equal(effective(null, false), 'light');
  assert.equal(effective('light', true), 'light');
  assert.equal(effective('dark', false), 'dark');
  assert.equal(opposite('dark'), 'light'); assert.equal(opposite('light'), 'dark');
  assert.equal(labelFor('light'), 'Switch to night mode');
  assert.equal(labelFor('dark'), 'Switch to day mode');
});

test('theme key is separate from academic data keys', () => {
  assert.ok(!THEME_KEY.startsWith('cd:'), 'must not collide with cd:doc: / cd:j: storage');
});

// minimal DOM for initTheme
function fakeEnv({ systemDark = false, stored } = {}) {
  const attrs = {}, classes = new Set(), handlers = {}, winHandlers = {}, mqHandlers = [];
  const button = { attrs: {}, dataset: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, closest(sel) { return sel === '[data-theme-toggle]' ? this : null; } };
  const metas = [{ a: { media: '(prefers-color-scheme: light)', content: '#fff6df' } }, { a: { media: '(prefers-color-scheme: dark)', content: '#1c1740' } }].map(m => ({ ...m, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.a[k] = v; } }));
  const doc = {
    documentElement: { setAttribute: (k, v) => (attrs[k] = v), removeAttribute: k => delete attrs[k], getAttribute: k => attrs[k] ?? null, classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
    querySelectorAll: sel => (sel.includes('theme-color') ? metas : sel === '[data-theme-toggle]' ? [button] : []),
    addEventListener: (t, f) => (handlers[t] = f),
  };
  const mq = { matches: systemDark, addEventListener: (t, f) => mqHandlers.push(f) };
  const storage = memStore(stored ? { [THEME_KEY]: stored } : {});
  const win = { localStorage: storage, matchMedia: q => (q.includes('reduced-motion') ? { matches: true } : mq), addEventListener: (t, f) => (winHandlers[t] = f) };
  return { doc, win, attrs, button, metas, storage, click: () => handlers.click({ target: button, preventDefault() {} }), systemChange: v => { mq.matches = v; mqHandlers.forEach(f => f()); }, otherTab: v => { v ? storage.setItem(THEME_KEY, v) : storage.removeItem(THEME_KEY); winHandlers.storage({ key: THEME_KEY }); } };
}

test('first visit follows the device and labels the action', () => {
  const e = fakeEnv({ systemDark: true });
  const api = initTheme(e.doc, e.win);
  assert.equal(e.attrs['data-theme'], undefined, 'no forced theme on first visit');
  assert.deepEqual(api.state(), { pref: null, shown: 'dark' });
  assert.equal(e.button.attrs['aria-label'], 'Switch to day mode');
  e.systemChange(false);
  assert.equal(api.state().shown, 'light');
  assert.equal(e.button.attrs['aria-label'], 'Switch to night mode');
});

test('a click saves the choice, which then ignores system changes', () => {
  const e = fakeEnv({ systemDark: true });
  initTheme(e.doc, e.win);
  e.click();
  assert.equal(e.attrs['data-theme'], 'light');
  assert.equal(e.storage.getItem(THEME_KEY), 'light');
  assert.equal(e.metas[1].a.content, '#fff6df', 'browser bar colour follows the choice');
  e.systemChange(true);
  assert.equal(e.attrs['data-theme'], 'light');
  e.click();
  assert.equal(e.storage.getItem(THEME_KEY), 'dark');
  assert.equal(e.button.attrs['aria-label'], 'Switch to day mode');
});

test('a saved choice is applied on load and synced from another tab', () => {
  const e = fakeEnv({ systemDark: false, stored: 'dark' });
  const api = initTheme(e.doc, e.win);
  assert.equal(e.attrs['data-theme'], 'dark');
  e.otherTab('light'); assert.equal(e.attrs['data-theme'], 'light');
  e.otherTab(null); assert.equal(e.attrs['data-theme'], undefined); assert.equal(api.state().pref, null);
});

test('"Match device" clears the saved choice', () => {
  const e = fakeEnv({ systemDark: true, stored: 'light' });
  const api = initTheme(e.doc, e.win);
  api.set(null);
  assert.equal(e.storage.getItem(THEME_KEY), null);
  assert.equal(api.state().shown, 'dark');
});

test('index.html applies a saved theme before the stylesheet loads', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(x => x[1].includes(THEME_KEY));
  assert.ok(m, 'inline theme script present');
  assert.ok(html.indexOf(m[0]) < html.indexOf('rel="stylesheet" href="css/style.css'), 'runs before the CSS');
  assert.ok(m[1].includes(THEME_KEY));
  for (const [stored, expect] of [['dark', 'dark'], ['light', 'light'], ['junk', undefined], [null, undefined]]) {
    const attrs = {}, metas = [{ c: '' }, { c: '' }].map(o => ({ setAttribute: (k, v) => (o.c = v), o }));
    const ctx = { localStorage: { getItem: () => stored }, document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v) }, querySelectorAll: () => metas } };
    vm.runInNewContext(m[1], ctx);
    assert.equal(attrs['data-theme'], expect);
  }
  const throwing = { localStorage: { getItem() { throw new Error('blocked'); } }, document: {} };
  assert.doesNotThrow(() => vm.runInNewContext(m[1], throwing));
});
