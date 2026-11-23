// Save-queue reliability tests (run in Node with minimal browser shims).
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
Object.defineProperty(globalThis.localStorage, 'keys', { value: () => [...mem.keys()] });
const realKeys = Object.keys; Object.keys = o => (o === globalThis.localStorage ? [...mem.keys()] : realKeys(o));
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
const { Saver } = await import('../js/store.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class FakeStore {
  constructor() { this.kind = 'test'; this.docs = {}; this.fail = []; this.delay = 0; this.writes = 0; }
  async put(p, d) { this.writes++; if (this.delay) await sleep(this.delay); const f = this.fail.shift(); if (f) throw Object.assign(new Error(f), { code: f }); this.docs[p] = JSON.parse(JSON.stringify(d)); }
  async del(p) { delete this.docs[p]; }
}
function setup() { mem.clear(); const st = new FakeStore(); const state = { 'app/notes': { items: [] } }; const log = []; const sv = new Saver(st, p => state[p], s => log.push(s)); return { st, state, log, sv }; }

test('never reports saved before the write is confirmed', async () => {
  const { st, state, log, sv } = setup(); st.delay = 200;
  state['app/notes'].items.push('a'); sv.mark('app/notes');
  await sleep(400);
  assert.equal(log.at(-1).state, 'saving');
  assert.equal(st.docs['app/notes'], undefined);
  await sleep(300);
  assert.equal(log.at(-1).state, 'saved');
  assert.deepEqual(st.docs['app/notes'].items, ['a']);
  assert.equal(mem.size, 0, 'journal cleared only after confirmation');
});

test('transient failure: edit is kept, journalled and retried until it lands', async () => {
  const { st, state, log, sv } = setup(); st.fail = ['unavailable'];
  state['app/notes'].items.push('x'); sv.mark('app/notes');
  await sleep(450);
  assert.equal(log.at(-1).state, 'error'); assert.equal(log.at(-1).permanent, false);
  assert.ok(mem.has('cd:j:test:app/notes'), 'journal kept');
  await sleep(1700);
  assert.equal(log.at(-1).state, 'saved');
  assert.deepEqual(st.docs['app/notes'].items, ['x']);
});

test('permanent failure: no silent loss, manual retry works', async () => {
  const { st, state, log, sv } = setup(); st.fail = ['quota_exceeded'];
  state['app/notes'].items.push('y'); sv.mark('app/notes');
  await sleep(450);
  assert.equal(log.at(-1).state, 'error'); assert.equal(log.at(-1).permanent, true);
  assert.equal(sv.pending, 1);
  const j = JSON.parse(mem.get('cd:j:test:app/notes')); assert.deepEqual(j.data.items, ['y']);
  sv.retry(); await sleep(100);
  assert.equal(log.at(-1).state, 'saved'); assert.deepEqual(st.docs['app/notes'].items, ['y']);
});

test('edits made while a write is in flight are written too (latest wins)', async () => {
  const { st, state, sv } = setup(); st.delay = 150;
  state['app/notes'].items.push(1); sv.mark('app/notes');
  await sleep(380); // first write in flight
  state['app/notes'].items.push(2); sv.mark('app/notes');
  await sleep(900);
  assert.deepEqual(st.docs['app/notes'].items, [1, 2]);
  assert.equal(sv.pending, 0);
});

test('flush writes immediately (used on pagehide / before export)', async () => {
  const { st, state, sv } = setup();
  state['app/notes'].items.push('now'); sv.mark('app/notes');
  await sv.flush();
  assert.deepEqual(st.docs['app/notes'].items, ['now']);
});

test('unconfirmed edits are recoverable after a reload, stale ones are not', () => {
  const { sv } = setup();
  mem.set('cd:j:test:app/notes', JSON.stringify({ at: 2000, data: { items: ['lost?'] } }));
  mem.set('cd:j:test:app/config', JSON.stringify({ at: 1000, data: { links: [] } }));
  const r = sv.recoverable({ 'app/notes': 1500, 'app/config': 1500 });
  assert.deepEqual(r.map(x => x.path), ['app/notes']);
});

test('deletes go through the same queue', async () => {
  const { st, state, sv } = setup(); st.docs['subjects/x'] = { a: 1 };
  sv.store.getDoc = undefined; delete state['subjects/x']; sv.mark('subjects/x');
  await sv.flush(); assert.equal(st.docs['subjects/x'], undefined);
});
