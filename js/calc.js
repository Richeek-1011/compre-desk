// Compre Desk: pure calculation functions (no DOM, no storage). Tested in tests/calc.test.mjs.
//
// Units: every assessment ("component") stores `max` in COURSE POINTS, i.e. its share of the
// course total (e.g. a Mid-sem worth 90 of a 300-mark course has max 90). If `rawMax` is set,
// `scored` and `avg` were entered in raw marks out of `rawMax` and are converted to course points
// as value * max / rawMax. Without `rawMax`, scored/avg are already course points. Weights are
// therefore applied exactly once. A component with max 0 is a bonus: its marks count as course
// points directly and it is left out of normalised comparisons.

export const GP = { A: 10, 'A-': 9, B: 8, 'B-': 7, C: 6, 'C-': 5, D: 4, E: 2 };
export const GRADES = Object.keys(GP);
const MINUS = '−';

export const num = v => {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string') { v = v.trim(); if (v === '') return null; }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const r1 = v => Math.round(v * 10) / 10;
export const sum = a => a.reduce((x, y) => x + y, 0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const trimNum = x => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** "Av+25", "Av+12.5", "Av−4", "Av+0". Null → "Av ?". */
export function fmtAv(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'Av ?';
  let x = r1(v);
  if (Object.is(x, -0) || x === 0) x = 0;
  return x >= 0 ? `Av+${trimNum(x)}` : `Av${MINUS}${trimNum(-x)}`;
}
/** Signed percentage-point string: "+6.2%" / "−3%". */
export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  let x = r1(v);
  if (Object.is(x, -0) || x === 0) x = 0;
  return x >= 0 ? `+${trimNum(x)}%` : `${MINUS}${trimNum(-x)}%`;
}

const isBonus = c => num(c.max) === 0;
/** Convert a value entered for component c into course points. */
export function toPts(c, v) {
  const val = num(v); if (val === null) return null;
  const mx = num(c.max), raw = num(c.rawMax);
  return raw > 0 && mx > 0 ? (val * mx) / raw : val;
}
/** Convert course points back into the units the component is entered in. */
export function fromPts(c, pts) {
  const mx = num(c.max), raw = num(c.rawMax);
  return raw > 0 && mx > 0 ? (pts * raw) / mx : pts;
}
/** Upper limit for scored/avg in entered units (null = no limit, e.g. bonus). */
export const entryLimit = c => { const raw = num(c.rawMax), mx = num(c.max); return raw > 0 ? raw : mx > 0 ? mx : null; };

/** Field-level validation for one component. Returns [{field,msg}]. */
export function validateComponent(c) {
  const e = [], mx = num(c.max), raw = num(c.rawMax), sc = num(c.scored), av = num(c.avg), lim = entryLimit(c);
  const bad = (f, v) => v !== null && v !== undefined && v !== '' && num(v) === null;
  ['max', 'rawMax', 'scored', 'avg'].forEach(f => { if (bad(f, c[f])) e.push({ field: f, msg: 'Not a number' }); });
  if (mx !== null && mx < 0) e.push({ field: 'max', msg: 'Weight can’t be negative' });
  if (c.rawMax !== null && c.rawMax !== undefined && c.rawMax !== '' && raw !== null && raw <= 0) e.push({ field: 'rawMax', msg: 'Raw "out of" must be above 0' });
  if (sc !== null && sc < 0) e.push({ field: 'scored', msg: 'Marks can’t be negative' });
  if (av !== null && av < 0) e.push({ field: 'avg', msg: 'Average can’t be negative' });
  if (lim !== null && sc !== null && sc > lim + 1e-9) e.push({ field: 'scored', msg: `More than the maximum (${lim})` });
  if (lim !== null && av !== null && av > lim + 1e-9) e.push({ field: 'avg', msg: `More than the maximum (${lim})` });
  if (mx === null && (sc !== null || av !== null)) e.push({ field: 'max', msg: 'Set the course points ("Out of") first' });
  return e;
}

/** Whole-course structure checks. */
export function structure(s) {
  const total = num(s.total), comps = s.components || [];
  const listed = sum(comps.map(c => (num(c.max) > 0 ? num(c.max) : 0)));
  const errors = [];
  if (total === null || total <= 0) errors.push('Set the course total');
  else if (listed > total + 1e-9) errors.push(`Assessments add up to ${r1(listed)} course points, more than the course total (${total})`);
  return { total, listed, unlisted: total !== null ? r1(total - listed) : null, errors };
}

/**
 * Relative standing inside one course.
 * av      = Σ(score − class avg) in course points over assessments where both are known and valid.
 * norm    = that difference as % of the course points those assessments were worth (bonus excluded),
 *           which makes courses with different totals comparable.
 */
export function relative(s) {
  const total = num(s.total), comps = s.components || [];
  const rows = comps.map(c => {
    const err = validateComponent(c);
    const sc = num(c.scored), av = num(c.avg), mx = num(c.max);
    const graded = sc !== null && !err.length;
    const scPts = graded ? toPts(c, sc) : null;
    const avPts = graded && av !== null ? toPts(c, av) : null;
    return { c, err, graded, bonus: isBonus(c), max: mx, scPts, avPts, diff: graded && avPts !== null ? scPts - avPts : null, missingAvg: graded && av === null };
  });
  const withAvg = rows.filter(r => r.diff !== null);
  const normRows = withAvg.filter(r => !r.bonus && r.max > 0);
  const av = withAvg.length ? sum(withAvg.map(r => r.diff)) : null;
  const covMax = sum(normRows.map(r => r.max));
  const norm = covMax > 0 ? (sum(normRows.map(r => r.diff)) / covMax) * 100 : null;
  const graded = rows.filter(r => r.graded);
  const gradedMax = sum(graded.filter(r => r.max > 0).map(r => r.max));
  const pre = sum(graded.map(r => r.scPts));
  const myCov = sum(withAvg.map(r => r.scPts)), classCov = sum(withAvg.map(r => r.avPts));
  const coverage = total > 0 ? Math.min(1, gradedMax / total) : null;
  const avgCoverage = gradedMax > 0 ? covMax / gradedMax : null;
  const complete = s.status === 'completed' || (total > 0 && gradedMax >= total - 1e-9);
  return {
    rows, av, norm, covMax, gradedMax, pre, myCov, classCov, coverage, avgCoverage, complete,
    missingAvg: rows.filter(r => r.missingAvg).map(r => r.c),
    invalid: rows.filter(r => r.err.length).map(r => r.c),
    upcoming: rows.filter(r => !r.graded && !r.err.length && r.max > 0).map(r => r.c),
    remaining: total > 0 ? Math.max(0, total - gradedMax) : null,
  };
}

/** Credit-weighted mean of course `norm` values (only courses that have one). */
export function overall(subjects) {
  let w = 0, t = 0; const used = [];
  subjects.forEach(s => {
    if (s.kind === 'project') return;
    const rel = relative(s); if (rel.norm === null) return;
    const cr = num(s.credits) > 0 ? num(s.credits) : 1;
    w += cr; t += cr * rel.norm; used.push(s.id);
  });
  return { norm: w ? t / w : null, used, of: subjects.filter(s => s.kind !== 'project').length };
}

/** Grade boundary scenarios. Never claims a grade is guaranteed. */
export function boundaries(s, scenario = 'historical') {
  const rel = relative(s), total = num(s.total);
  const shift = num(s.expectedAvg) !== null && num(s.lastAvg) !== null ? num(s.expectedAvg) - num(s.lastAvg) : null;
  const src = scenario === 'manual' ? s.estCutoffs || {} : s.cutoffs || {};
  const add = scenario === 'shifted' ? shift : 0;
  const available = scenario !== 'shifted' || shift !== null;
  const cuts = !available ? [] : GRADES.map(g => ({ g, cut: num(src[g]) })).filter(x => x.cut !== null).map(x => ({ g: x.g, cut: r1(x.cut + (add || 0)) })).sort((a, b) => b.cut - a.cut);
  const remaining = rel.remaining ?? 0;
  const rows = cuts.map(x => {
    const need = r1(x.cut - rel.pre);
    return { ...x, need, pct: remaining > 0 ? need / remaining : null, status: need <= 0 ? 'above' : need > remaining ? 'out' : 'reachable' };
  });
  return { scenario, cuts, rows, shift, available, pre: r1(rel.pre), remaining, total };
}
export function gradeFor(marks, cuts) {
  if (!cuts.length) return null;
  const r = [...cuts].sort((a, b) => b.cut - a.cut).find(x => marks >= x.cut);
  return r ? r.g : `below ${cuts[cuts.length - 1].g}`;
}
/** Old-style absolute what-if: score pct% of everything not yet graded. */
export function absoluteWhatIf(s, pct, scenario = 'historical') {
  const b = boundaries(s, scenario);
  const projected = r1(b.pre + (clamp(num(pct) ?? 0, 0, 100) / 100) * b.remaining);
  return { projected, grade: gradeFor(projected, b.cuts), cuts: b.cuts };
}

/**
 * Relative simulator. sim = {componentId: {my, avg}} in the component's entered units.
 * Simulated values live outside the real records and never modify them.
 */
export function simulate(s, sim = {}) {
  const rel = relative(s); const items = []; const warnings = [];
  let addDiff = 0, addMax = 0, addMy = 0;
  rel.upcoming.forEach(c => {
    const v = sim[c.id] || {}; const my = num(v.my), av = num(v.avg), lim = entryLimit(c);
    const it = { c, my, avg: av, diff: null, ok: true };
    if (my !== null && (my < 0 || (lim !== null && my > lim))) { it.ok = false; warnings.push(`${c.name}: your score must be between 0 and ${lim}`); }
    if (av !== null && (av < 0 || (lim !== null && av > lim))) { it.ok = false; warnings.push(`${c.name}: class average must be between 0 and ${lim}`); }
    if (it.ok && my !== null) addMy += toPts(c, my);
    if (it.ok && my !== null && av !== null) { it.diff = toPts(c, my) - toPts(c, av); addDiff += it.diff; addMax += num(c.max); }
    items.push(it);
  });
  const baseNormDiff = rel.norm !== null ? (rel.norm / 100) * rel.covMax : 0;
  const projAv = rel.av === null && !items.some(i => i.diff !== null) ? null : (rel.av || 0) + addDiff;
  const projNorm = rel.covMax + addMax > 0 && (rel.norm !== null || addMax > 0) ? ((baseNormDiff + addDiff) / (rel.covMax + addMax)) * 100 : null;
  return { items, projAv, projNorm, projTotal: r1(rel.pre + addMy), warnings, baseAv: rel.av };
}
/** Marks needed in component compId (entered units) to finish at Av target, given the other simulated values. */
export function neededFor(s, sim, compId, target) {
  const rel = relative(s); const c = rel.upcoming.find(x => x.id === compId);
  if (!c) return { error: 'Pick an upcoming assessment' };
  const t = num(target); if (t === null) return { error: 'Enter a target like 20 for Av+20' };
  const A = num((sim[compId] || {}).avg);
  if (A === null) return { error: `Enter an assumed class average for ${c.name}; it won’t be guessed` };
  const others = sum(simulate(s, { ...sim, [compId]: { my: null, avg: A } }).items.filter(i => i.c.id !== compId && i.diff !== null).map(i => i.diff));
  const needPts = t - (rel.av || 0) - others + toPts(c, A);
  const need = r1(fromPts(c, needPts)); const lim = entryLimit(c);
  if (need < 0) return { need: 0, feasible: true, note: 'Already there even with 0 in this assessment (under these assumptions)' };
  if (lim !== null && need > lim) return { need, feasible: false, note: `Would need ${need} of ${lim}: not possible in this assessment alone` };
  return { need, feasible: true, limit: lim };
}

/** Estimated preparation. Syllabus = modules + slides, practice = tut sheets + PYQs. */
export const STATUS_WEIGHT = { modules: [0, 0.5, 0.85, 1], tuts: [0, 0.5, 0.85, 1], pyqs: [0, 0.6, 1] };
export function prepDetail(s, weights = {}) {
  const W = { modules: 1, slides: 1, tuts: 1, pyqs: 1, ...weights };
  const cat = {}; const flags = [];
  const st = (list, key) => {
    const items = s[key] || []; if (!items.length) return null;
    const vals = items.map(m => STATUS_WEIGHT[key][clamp(Math.round(num(m.status) || 0), 0, STATUS_WEIGHT[key].length - 1)]);
    return { p: sum(vals) / vals.length, n: items.length, done: items.filter(m => (num(m.status) || 0) >= 2).length };
  };
  cat.modules = st(s, 'modules'); cat.tuts = st(s, 'tuts'); cat.pyqs = st(s, 'pyqs');
  const decks = s.slides || [];
  if (decks.length) {
    let cov = 0, tot = 0, unknown = 0;
    decks.forEach(d => {
      const t = num(d.total), c = num(d.covered) || 0;
      if (t === null || t <= 0) { unknown++; return; }
      if (c > t || c < 0) flags.push(`"${d.name}": covered (${c}) is outside 0–${t}; counted as ${clamp(c, 0, t)}`);
      cov += clamp(c, 0, t); tot += t;
    });
    if (unknown) flags.push(`${unknown} slide deck${unknown > 1 ? 's have' : ' has'} no total, so ${unknown > 1 ? 'they are' : 'it is'} left out`);
    cat.slides = tot > 0 ? { p: cov / tot, n: decks.length - unknown, done: decks.filter(d => num(d.total) > 0 && (num(d.covered) || 0) >= num(d.total)).length } : null;
  } else cat.slides = null;
  const mix = keys => { const ks = keys.filter(k => cat[k] && W[k] > 0); if (!ks.length) return null; const w = sum(ks.map(k => W[k])); return sum(ks.map(k => W[k] * cat[k].p)) / w; };
  const basis = Object.keys(cat).filter(k => cat[k]);
  return { cat, syllabus: mix(['modules', 'slides']), practice: mix(['tuts', 'pyqs']), overall: mix(['modules', 'slides', 'tuts', 'pyqs']), basis, flags };
}

/* ---------- dates ---------- */
export const pad = n => String(n).padStart(2, '0');
export const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const pd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);

/** Move unfinished goals from earlier days to `today`. Pure: returns new goals + count. */
export function carryForward(goals, today, mkId) {
  const out = goals.map(g => ({ ...g })); let moved = 0;
  out.filter(g => g.date < today && (num(g.progress) || 0) < 100 && !g.carriedTo).forEach(g => {
    out.push({ id: mkId(), date: today, subject: g.subject || '', text: g.text, target: g.target || '', priority: g.priority || 'normal', progress: 0,
      carriedFrom: g.date, carriedPct: num(g.progress) || 0, origin: g.origin || g.date, carryCount: (num(g.carryCount) || 0) + 1 });
    g.carriedTo = today; moved++;
  });
  return { goals: out, moved };
}

/** Explainable study-priority suggestions. overrides: {subjectId: 'pin'|'snooze'}. */
export function priorities({ subjects, planner, config, today, name = s => s.short || s.name, weights }) {
  const items = []; const ov = (config && config.priorityOverrides) || {};
  subjects.filter(s => s.kind !== 'project' && s.exam && s.exam.date).forEach(s => {
    const d = daysBetween(today, s.exam.date); if (d < 0) return;
    const rel = relative(s), pr = prepDetail(s, weights), n = name(s);
    const u = Math.max(0, 1 - d / 21), gap = pr.overall === null ? 0.6 : 1 - pr.overall, perf = rel.norm === null ? 0.25 : clamp(-rel.norm / 10, 0, 1);
    let score = 0.45 * u + 0.35 * gap + 0.2 * perf;
    const reasons = [`Compre in ${d} day${d === 1 ? '' : 's'}`];
    if (rel.av !== null) reasons.push(`${fmtAv(rel.av)} so far${rel.complete ? '' : ' (partial)'}`); else reasons.push('No class averages yet');
    reasons.push(pr.overall === null ? 'Prep not tracked yet' : `Prep est. ${Math.round(pr.overall * 100)}%`);
    const tutsLeft = (s.tuts || []).filter(t => (num(t.status) || 0) < 2).length;
    const pyqs = s.pyqs || [], pyqDone = pyqs.filter(p => (num(p.status) || 0) >= 2).length;
    const modsLeft = (s.modules || []).filter(m => (num(m.status) || 0) < 2).length;
    let title;
    if (rel.norm !== null && rel.norm < 0 && d <= 14) title = `${n} is below average (${fmtAv(rel.av)}), and its compre is in ${d} day${d === 1 ? '' : 's'}.`;
    else if (tutsLeft > 0) title = `You have ${tutsLeft} unfinished tutorial sheet${tutsLeft === 1 ? '' : 's'} in ${n}.`;
    else if (rel.norm !== null && rel.norm >= 0 && (pyqs.length === 0 || pyqDone / pyqs.length < 0.5)) title = `${n} is relatively strong, but your PYQ coverage is low${pyqs.length ? ` (${pyqDone} of ${pyqs.length})` : ''}.`;
    else if (modsLeft > 0) title = `${modsLeft} module${modsLeft === 1 ? '' : 's'} still to finish in ${n}.`;
    else title = `${n} compre in ${d} day${d === 1 ? '' : 's'}.`;
    const o = ov[s.id]; if (o === 'snooze') return;
    if (o === 'pin') score += 10;
    items.push({ id: 'subj:' + s.id, subject: s.id, kind: 'subject', score, title, reasons, pinned: o === 'pin', days: d });
  });
  const goals = (planner && planner.goals) || [];
  const carried = goals.filter(g => g.date === today && g.carriedFrom && (num(g.progress) || 0) < 100);
  if (carried.length) items.push({ id: 'carried', kind: 'planner', score: 0.55 + 0.05 * carried.length, title: `${carried.length === 1 ? 'One unfinished goal was' : `${carried.length} unfinished goals were`} carried forward.`, reasons: ['From earlier days'] });
  const dls = ((config && config.deadlines) || []).filter(d => !d.done && d.date);
  const overdue = dls.filter(d => d.date < today);
  if (overdue.length) items.push({ id: 'overdue', kind: 'deadline', score: 0.9, title: `${overdue.length} overdue deadline${overdue.length === 1 ? '' : 's'}: ${overdue.map(d => d.title).slice(0, 2).join(', ')}${overdue.length > 2 ? '…' : ''}`, reasons: ['Tick off or reschedule'] });
  dls.filter(d => d.date >= today && daysBetween(today, d.date) <= 3).forEach(d => items.push({ id: 'dl:' + d.id, kind: 'deadline', subject: d.subject, score: 0.7 - daysBetween(today, d.date) * 0.05, title: `${d.title} is due ${daysBetween(today, d.date) === 0 ? 'today' : `in ${daysBetween(today, d.date)} day${daysBetween(today, d.date) === 1 ? '' : 's'}`}.`, reasons: ['Deadline'] }));
  subjects.forEach(s => { const m = relative(s).missingAvg; if (m.length && s.kind !== 'project') items.push({ id: 'avg:' + s.id, subject: s.id, kind: 'data', score: 0.3, title: `Add the class average for ${m.map(c => c.name).join(', ')} in ${name(s)}.`, reasons: ['Needed for Av+'] }); });
  return items.sort((a, b) => b.score - a.score);
}

/** SGPA with confirmed and predicted grades kept apart. predicted: {subjectId: grade} */
export function sgpa(subjects, predicted = {}) {
  let cr = 0, pts = 0; const confirmed = [], pred = [], missing = [];
  subjects.forEach(s => {
    const c = num(s.credits); if (!(c > 0)) { missing.push(s.id); return; }
    if (s.gradeConfirmed && GP[s.grade] !== undefined) { confirmed.push(s.id); cr += c; pts += c * GP[s.grade]; return; }
    const g = predicted[s.id]; if (g && GP[g] !== undefined) { pred.push(s.id); cr += c; pts += c * GP[g]; return; }
    missing.push(s.id);
  });
  return { value: cr ? pts / cr : null, credits: cr, confirmed, predicted: pred, missing };
}
