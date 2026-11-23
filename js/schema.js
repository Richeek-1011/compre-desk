// Data model, migrations and backup formats. Pure functions; tested in tests/schema.test.mjs.
import { num } from './calc.js?v=2.0.2';

export const SCHEMA = 2;
export const DOCS = ['app/meta', 'app/config', 'app/planner', 'app/notes']; // + subjects/<id>

/** Display abbreviations requested for the existing subject IDs. */
export const DISPLAY = { comm: 'Commsys', iot: 'IoT', ethics: 'Prof Ethics', opt: 'Opti', hai: 'HAI', vlsi: 'ADVD', sop: 'SOP' };
/** Credits confirmed by the user: all 3 except IoT (4). */
export const CREDITS = { comm: 3, iot: 4, ethics: 3, opt: 3, hai: 3, vlsi: 3, sop: 3 };

export const emptyState = () => ({
  meta: { schema: SCHEMA, semester: '', createdAt: new Date().toISOString() },
  config: { links: [], deadlines: [], prefs: { prepWeights: { modules: 1, slides: 1, tuts: 1, pyqs: 1 }, chartSort: 'perf', chartMode: 'norm' }, priorityOverrides: {} },
  planner: { goals: [], days: {} },
  notes: { items: [] },
  subjects: {},
});

export const newSubject = (id, kind = 'course') => kind === 'project'
  ? { id, kind, code: '', name: 'New project', short: 'Project', credits: 3, grade: '', gradeConfirmed: false, files: [], links: [], notes: '' }
  : { id, kind, code: '', name: 'New subject', short: 'New', credits: 3, total: 200, status: 'ongoing', exam: { date: '', start: '09:00', end: '12:00', room: '' },
      cutSource: '', cutoffs: {}, estCutoffs: {}, lastAvg: null, expectedAvg: null, avTarget: null,
      components: [{ id: 'compre', name: 'Compre', max: null, scored: null, avg: null, isCompre: true }],
      whatIf: 70, sim: {}, syllabus: '', modules: [], slides: [], tuts: [], pyqs: [], links: [], notes: '' };

const arr = v => (Array.isArray(v) ? v : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
let seq = 0; const mkId = p => p + Date.now().toString(36) + (seq++).toString(36);

/** Turn a map of Claude-database documents ({"subjects/iot": {data}} or {"subjects/iot": data}) into state. */
export function fromDocs(docs) {
  const st = { meta: { schema: 1 }, config: {}, planner: {}, notes: {}, subjects: {} };
  Object.entries(obj(docs)).forEach(([path, v]) => {
    const data = v && typeof v === 'object' && 'data' in v && ('version' in v || 'updatedAt' in v) ? v.data : v;
    if (!data || typeof data !== 'object') return;
    const [col, id] = path.split('/');
    if (col === 'subjects' && id) st.subjects[id] = { ...data, id };
    else if (col === 'app' && ['meta', 'config', 'planner', 'notes'].includes(id)) st[id] = data;
  });
  if (!st.meta.schema) st.meta.schema = 1;
  return st;
}

/** Bring any older state up to SCHEMA. Never drops records; returns {state, changes[]}. */
export function migrate(input) {
  const s = JSON.parse(JSON.stringify(input || {}));
  const changes = [];
  const from = num(s.meta && s.meta.schema) || 1;
  const base = emptyState();
  s.meta = { ...base.meta, ...obj(s.meta) };
  s.config = { ...base.config, ...obj(s.config) };
  s.config.links = arr(s.config.links); s.config.deadlines = arr(s.config.deadlines);
  s.config.prefs = { ...base.config.prefs, ...obj(s.config.prefs) };
  s.config.prefs.prepWeights = { ...base.config.prefs.prepWeights, ...obj(s.config.prefs.prepWeights) };
  s.config.priorityOverrides = obj(s.config.priorityOverrides);
  s.planner = { goals: arr(s.planner && s.planner.goals), days: obj(s.planner && s.planner.days) };
  s.notes = { items: arr(s.notes && s.notes.items) };
  s.subjects = obj(s.subjects);
  Object.values(s.subjects).forEach(sub => {
    const isP = sub.kind === 'project';
    ['links', 'notes'].forEach(k => { if (k === 'links') sub.links = arr(sub.links); else if (typeof sub.notes !== 'string') sub.notes = ''; });
    if (isP) { sub.files = arr(sub.files); return; }
    ['components', 'modules', 'slides', 'tuts', 'pyqs'].forEach(k => (sub[k] = arr(sub[k])));
    sub.exam = { date: '', start: '', end: '', room: '', ...obj(sub.exam) };
    sub.cutoffs = obj(sub.cutoffs); sub.estCutoffs = obj(sub.estCutoffs); sub.sim = obj(sub.sim);
    if (!sub.status) sub.status = 'ongoing';
    sub.components.forEach(c => { if (!c.id) c.id = mkId('a'); });
    [sub.modules, sub.slides, sub.tuts, sub.pyqs, sub.links].forEach(l => l.forEach(i => { if (!i.id) i.id = mkId('i'); }));
  });
  if (from < 2) {
    Object.values(s.subjects).forEach(sub => {
      const id = sub.id;
      // Display names (official names stay in `name`). VLSI → ADVD only if it really is Analog & Digital VLSI Design.
      if (DISPLAY[id] && (id !== 'vlsi' || sub.code === 'EEE F313' || /analog.*digital.*vlsi/i.test(sub.name || ''))) {
        if (sub.short !== DISPLAY[id]) { changes.push(`${sub.name}: display name "${sub.short || ''}" → "${DISPLAY[id]}"`); sub.short = DISPLAY[id]; }
      }
      if (CREDITS[id] !== undefined && !sub.creditsConfirmed) {
        if (num(sub.credits) !== CREDITS[id]) changes.push(`${DISPLAY[id] || sub.name}: credits ${sub.credits} → ${CREDITS[id]}`);
        sub.credits = CREDITS[id]; sub.creditsConfirmed = true;
      }
      if (sub.kind === 'project') { if (sub.grade && sub.gradeConfirmed === undefined) { sub.gradeConfirmed = true; changes.push(`${DISPLAY[id] || sub.name}: grade ${sub.grade} marked as confirmed`); } return; }
      // Make the compre an explicit assessment so it can be simulated. Weight only if it is unambiguous.
      if (!sub.components.some(c => c.isCompre || /compre/i.test(c.name || ''))) {
        const total = num(sub.total), listed = sub.components.map(c => num(c.max));
        const known = listed.every(m => m !== null);
        const rest = known && total ? total - listed.filter(m => m > 0).reduce((a, b) => a + b, 0) : null;
        sub.components.push({ id: 'compre', name: 'Compre', max: rest !== null && rest > 0 ? rest : null, scored: null, avg: null, isCompre: true });
        changes.push(`${DISPLAY[id] || sub.name}: added a Compre row${rest > 0 ? ` worth ${rest}` : ' (set its weight when known)'}`);
      }
      if (sub.avTarget === undefined) sub.avTarget = null;
    });
  }
  s.meta.schema = SCHEMA; s.meta.migratedFrom = s.meta.migratedFrom || (from < SCHEMA ? from : undefined);
  if (s.meta.migratedFrom === undefined) delete s.meta.migratedFrom;
  return { state: s, changes };
}

/** State → map of storage documents. */
export function toDocs(st) {
  const d = { 'app/meta': st.meta, 'app/config': st.config, 'app/planner': st.planner, 'app/notes': st.notes };
  Object.values(st.subjects).forEach(s => { d['subjects/' + s.id] = s; });
  return d;
}

/** Build a portable backup. files: [{id,name,mime,base64}] (optional). */
export function makeBackup(st, files = []) {
  return { format: 'compre-desk/v2', schema: SCHEMA, exportedAt: new Date().toISOString(), app: 'Compre Desk', data: st, files };
}

/** Parse any supported backup. Returns {state, files, changes, source} or throws Error with a readable message. */
export function parseBackup(text) {
  let j; try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file isn’t valid JSON.'); }
  if (!j || typeof j !== 'object') throw new Error('Unrecognised backup file.');
  let st, source, files = [];
  if (j.format === 'compre-desk/v2' && j.data) { st = j.data; files = arr(j.files); source = 'Compre Desk V2 backup'; }
  else if (j.format === 'compre-desk/claude-db-raw' && j.docs) { st = fromDocs(j.docs); source = 'Claude database backup'; }
  else if (j.subjects && (j.config || j.planner)) { st = j; source = 'Compre Desk state'; }
  else if (Object.keys(j).some(k => k.startsWith('subjects/'))) { st = fromDocs(j); source = 'Claude database documents'; }
  else throw new Error('This doesn’t look like a Compre Desk backup.');
  const errs = validateState(st);
  if (errs.length) throw new Error('Backup has problems: ' + errs.slice(0, 3).join('; '));
  const { state, changes } = migrate(st);
  return { state, files, changes, source };
}

export function validateState(st) {
  const e = [];
  if (!st || typeof st !== 'object') return ['not an object'];
  if (st.subjects && typeof st.subjects !== 'object') e.push('subjects must be an object');
  Object.entries(obj(st.subjects)).forEach(([k, s]) => {
    if (!s || typeof s !== 'object') e.push(`subject ${k} is empty`);
    else if (s.id && s.id !== k) e.push(`subject key ${k} doesn’t match id ${s.id}`);
    else if (!/^[\w.~:@+-]{1,80}$/.test(k)) e.push(`subject id ${k} has unsupported characters`);
  });
  if (st.planner && st.planner.goals && !Array.isArray(st.planner.goals)) e.push('planner.goals must be a list');
  if (st.notes && st.notes.items && !Array.isArray(st.notes.items)) e.push('notes.items must be a list');
  return e;
}

export function summarize(st) {
  const subs = Object.values(obj(st.subjects));
  return {
    subjects: subs.length,
    assessments: subs.reduce((a, s) => a + arr(s.components).length, 0),
    goals: arr(st.planner && st.planner.goals).length,
    notes: arr(st.notes && st.notes.items).length,
    deadlines: arr(st.config && st.config.deadlines).length,
    files: subs.reduce((a, s) => a + arr(s.files).length, 0),
  };
}

/** Flat CSV of every assessment, for spreadsheets. */
export function assessmentsCsv(st, name = s => s.short || s.name) {
  const q = v => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const rows = [['subject_id', 'subject', 'official_name', 'assessment', 'course_points', 'raw_out_of', 'my_score', 'class_avg', 'date']];
  Object.values(obj(st.subjects)).forEach(s => arr(s.components).forEach(c => rows.push([s.id, name(s), s.name, c.name, c.max, c.rawMax, c.scored, c.avg, c.date])));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
