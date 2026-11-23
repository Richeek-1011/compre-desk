// Storage adapters + a save queue that never reports "saved" before the write is confirmed.
//
// LocalStore  : IndexedDB (docs + file blobs). Falls back to localStorage for docs if IndexedDB is unavailable.
// ClaudeStore : the Claude artifact database (only when the page runs inside Claude).
// Saver       : coalesces edits per document, journals each pending edit to localStorage first
//               (write-ahead log), retries failures, and recovers journalled edits after a crash/reload.

const DB_NAME = 'compre-desk', DB_VER = 1;
const lsOK = (() => { try { const k = '__cd_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; } })();
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalStore {
  constructor() { this.kind = 'local'; this.db = null; this.fallback = false; }
  async open() {
    if (!('indexedDB' in window)) { this.fallback = true; return this; }
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'path' }); if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('Database blocked by another tab'));
      });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); this.fallback = true; }
    return this;
  }
  get label() { return this.fallback ? (lsOK ? 'this browser (localStorage)' : 'memory only') : 'this browser (IndexedDB)'; }
  async loadAll() {
    const docs = {};
    if (this.fallback) { if (lsOK) Object.keys(localStorage).filter(k => k.startsWith('cd:doc:')).forEach(k => { try { const v = JSON.parse(localStorage.getItem(k)); docs[k.slice(7)] = v; } catch {} }); return docs; }
    const tx = this.db.transaction('docs', 'readonly');
    (await req(tx.objectStore('docs').getAll())).forEach(r => { docs[r.path] = { data: r.data, savedAt: r.savedAt }; });
    return docs;
  }
  async get(path) {
    if (this.fallback) { const v = lsOK && localStorage.getItem('cd:doc:' + path); return v ? JSON.parse(v).data : undefined; }
    const tx = this.db.transaction('docs', 'readonly'); const r = await req(tx.objectStore('docs').get(path)); return r ? r.data : undefined;
  }
  async put(path, data) {
    const savedAt = Date.now();
    if (this.fallback) { if (!lsOK) throw Object.assign(new Error('No storage available in this browser'), { code: 'no_storage' }); localStorage.setItem('cd:doc:' + path, JSON.stringify({ data, savedAt })); return savedAt; }
    await new Promise((res, rej) => { const tx = this.db.transaction('docs', 'readwrite'); tx.objectStore('docs').put({ path, data, savedAt }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Write aborted')); });
    return savedAt;
  }
  async del(path) {
    if (this.fallback) { if (lsOK) localStorage.removeItem('cd:doc:' + path); return; }
    await new Promise((res, rej) => { const tx = this.db.transaction('docs', 'readwrite'); tx.objectStore('docs').delete(path); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  get canFiles() { return !!this.db; }
  async putFile(id, blob, meta) { await new Promise((res, rej) => { const tx = this.db.transaction('files', 'readwrite'); tx.objectStore('files').put({ id, blob, ...meta }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Storage full?')); }); }
  async getFile(id) { if (!this.db) return null; const tx = this.db.transaction('files', 'readonly'); return (await req(tx.objectStore('files').get(id))) || null; }
  async delFile(id) { if (!this.db) return; await new Promise(res => { const tx = this.db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = res; tx.onerror = res; }); }
  async fileBlob(f) { const r = await this.getFile(f.id); return r ? r.blob : null; }
}

export class ClaudeStore {
  constructor(db, assets, canWrite) { this.kind = 'claude'; this.db = db; this.assets = assets; this.canWrite = canWrite; this.label = 'your Claude artifact database'; }
  async open() { return this; }
  async loadAll() {
    const docs = {};
    const subs = await this.db.collection('subjects').get();
    subs.docs.forEach(d => { if (d.exists) docs['subjects/' + d.id] = { data: clone(d.data()) }; });
    await Promise.all(['meta', 'config', 'planner', 'notes'].map(async k => { const d = await this.db.doc('app/' + k).get(); if (d.exists) docs['app/' + k] = { data: clone(d.data()) }; }));
    return docs;
  }
  async put(path, data) { await this.db.doc(path).set(data); return Date.now(); }
  async del(path) { await this.db.doc(path).delete(); }
  get canFiles() { return !!this.assets; }
  async putFile(id, blob) { const r = await this.assets.upload(blob); return r; }
  async delFile(id) { if (this.assets) await this.assets.delete(id).catch(() => {}); }
  async fileBlob(f) { try { const r = await fetch('/_blob/' + encodeURIComponent(f.id)); return r.ok ? await r.blob() : null; } catch { return null; } }
  subscribe(onDoc) {
    const unsubs = [];
    unsubs.push(this.db.collection('subjects').onSnapshot(snap => snap.docChanges().forEach(ch => onDoc('subjects/' + ch.doc.id, ch.type === 'removed' ? undefined : clone(ch.doc.data()), snap.metadata)), () => {}));
    ['meta', 'config', 'planner', 'notes'].forEach(k => unsubs.push(this.db.doc('app/' + k).onSnapshot(d => onDoc('app/' + k, d.exists ? clone(d.data()) : undefined, d.metadata), () => {})));
    return () => unsubs.forEach(u => u());
  }
}

const PERMANENT = new Set(['invalid_argument', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'no_storage']);

export class Saver {
  /** getDoc(path) → current data (undefined = delete). onStatus({state, pending, message}) */
  constructor(store, getDoc, onStatus) {
    this.store = store; this.getDoc = getDoc; this.onStatus = onStatus || (() => {});
    this.gen = new Map(); this.inflight = new Set(); this.timer = null; this.retryMs = 0; this.error = null; this.jkey = 'cd:j:' + store.kind + ':';
    this.lastSavedAt = null;
    window.addEventListener('beforeunload', e => { if (this.pending) { this.flush(); e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
  }
  get pending() { return this.gen.size + this.inflight.size; }
  status() {
    const p = this.pending;
    if (this.error) this.onStatus({ state: 'error', pending: p, message: this.error.message, permanent: this.error.permanent });
    else this.onStatus({ state: p ? 'saving' : 'saved', pending: p, at: this.lastSavedAt });
  }
  journal(path) {
    if (!lsOK) return;
    try { localStorage.setItem(this.jkey + path, JSON.stringify({ at: Date.now(), data: clone(this.getDoc(path)) ?? null, del: this.getDoc(path) === undefined })); } catch { /* quota: the in-memory queue still holds the edit */ }
  }
  mark(path, { now = false } = {}) {
    this.gen.set(path, (this.gen.get(path) || 0) + 1);
    this.journal(path);
    if (this.error && !this.error.permanent) this.error = null;
    this.status();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), now ? 0 : 350);
  }
  async flush() {
    clearTimeout(this.timer);
    const paths = [...this.gen.keys()].filter(p => !this.inflight.has(p));
    await Promise.all(paths.map(p => this.writeOne(p)));
  }
  async writeOne(path) {
    const g = this.gen.get(path); if (g === undefined) return;
    const data = clone(this.getDoc(path));
    this.inflight.add(path); this.status();
    try {
      if (data !== undefined && data && typeof data === "object") data._at = Date.now();
      if (data === undefined) await this.store.del(path); else await this.store.put(path, data);
      if (this.gen.get(path) === g) { this.gen.delete(path); if (lsOK) try { localStorage.removeItem(this.jkey + path); } catch {} }
      this.retryMs = 0; this.error = null; this.lastSavedAt = Date.now(); if (this.onSaved) try { this.onSaved(path); } catch {}
    } catch (e) {
      const code = e && e.code; const permanent = PERMANENT.has(code);
      this.error = { message: permanent ? `Couldn’t save (${code === 'quota_exceeded' ? 'storage is full' : code || 'error'}). Your edits are kept on this device; export a backup.` : 'Save failed, retrying. Your edits are kept on this device.', permanent };
      if (!permanent) { this.retryMs = Math.min(30000, this.retryMs ? this.retryMs * 2 : 1000); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.retryMs + Math.random() * 400); }
    } finally {
      this.inflight.delete(path);
      if (this.gen.has(path) && !this.error) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 50); }
      this.status();
    }
  }
  retry() { this.error = null; this.retryMs = 0; this.flush(); this.status(); }
  /** Journalled edits that never got confirmed. Returns [{path,data,del,at}] newer than the stored copy. */
  recoverable(storedAt = {}) {
    if (!lsOK) return [];
    return Object.keys(localStorage).filter(k => k.startsWith(this.jkey)).map(k => { try { const j = JSON.parse(localStorage.getItem(k)); return { path: k.slice(this.jkey.length), ...j }; } catch { return null; } })
      .filter(j => j && (!storedAt[j.path] || j.at > storedAt[j.path]));
  }
  clearJournal(path) { if (lsOK) try { localStorage.removeItem(this.jkey + path); } catch {} }
}
