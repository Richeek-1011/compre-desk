// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';

const course = (components, extra = {}) => ({ id: 'x', kind: 'course', total: 200, credits: 3, components, ...extra });

test('fmtAv uses the exact display conventions', () => {
  assert.equal(C.fmtAv(25), 'Av+25');
  assert.equal(C.fmtAv(12.5), 'Av+12.5');
  assert.equal(C.fmtAv(-4), 'Av−4');
  assert.equal(C.fmtAv(0), 'Av+0');
  assert.equal(C.fmtAv(-0.04), 'Av+0');
  assert.equal(C.fmtAv(null), 'Av ?');
});

test('relative: positive, negative and exactly-average marks', () => {
  const r = C.relative(course([
    { id: 'q', name: 'Quiz', max: 20, scored: 16, avg: 12 },
    { id: 'm', name: 'Midsem', max: 90, scored: 67, avg: 44 },
    { id: 'l', name: 'Lab', max: 30, scored: 10, avg: 14 },
    { id: 'a', name: 'Assignment', max: 10, scored: 7, avg: 7 },
  ]));
  assert.equal(r.av, 4 + 23 - 4 + 0);
  assert.equal(C.fmtAv(r.av), 'Av+23');
  assert.equal(r.covMax, 150);
  assert.ok(Math.abs(r.norm - (23 / 150) * 100) < 1e-9);
});

test('the example from the brief: Av+4, Av+23 → Av+27', () => {
  const r = C.relative(course([{ id: 'q', name: 'Quiz', max: 20, scored: 16, avg: 12 }, { id: 'm', name: 'Midsem', max: 90, scored: 67, avg: 44 }]));
  assert.equal(C.fmtAv(r.av), 'Av+27');
});

test('zero is a real mark, not missing', () => {
  const r = C.relative(course([{ id: 'q', name: 'Quiz', max: 20, scored: 0, avg: 8 }]));
  assert.equal(r.av, -8);
  assert.equal(r.gradedMax, 20);
  const r2 = C.relative(course([{ id: 'q', name: 'Quiz', max: 20, scored: 5, avg: 0 }]));
  assert.equal(r2.av, 5);
});

test('missing class averages: excluded from Av, counted in coverage', () => {
  const r = C.relative(course([{ id: 'a', name: 'A', max: 50, scored: 40, avg: 30 }, { id: 'b', name: 'B', max: 50, scored: 20, avg: null }]));
  assert.equal(r.av, 10);
  assert.equal(r.missingAvg.length, 1);
  assert.equal(r.gradedMax, 100);
  assert.equal(r.covMax, 50);
  assert.equal(r.avgCoverage, 0.5);
  assert.equal(r.coverage, 0.5);
  assert.equal(r.complete, false);
});

test('no averages at all gives null, never 0', () => {
  const r = C.relative(course([{ id: 'a', name: 'A', max: 50, scored: 40 }]));
  assert.equal(r.av, null); assert.equal(r.norm, null);
});

test('rawMax converts to course points exactly once (no double weighting)', () => {
  // Quiz marked out of 20, worth 10 course points: 16/20 vs 12/20 → +4 raw → +2 course points.
  const r = C.relative(course([{ id: 'q', name: 'Quiz', max: 10, rawMax: 20, scored: 16, avg: 12 }]));
  assert.equal(r.av, 2);
  assert.equal(r.pre, 8);
  assert.equal(r.covMax, 10);
  assert.equal(r.norm, 20);
  // Without rawMax the same numbers are already course points.
  const r2 = C.relative(course([{ id: 'q', name: 'Quiz', max: 20, scored: 16, avg: 12 }]));
  assert.equal(r2.av, 4);
});

test('bonus components (max 0) count in Av and total but not in normalisation', () => {
  const r = C.relative(course([{ id: 'm', name: 'Mid', max: 50, scored: 30, avg: 25 }, { id: 'b', name: 'Bonus', max: 0, scored: 2, avg: 1 }]));
  assert.equal(r.av, 6); assert.equal(r.pre, 32); assert.equal(r.covMax, 50); assert.equal(r.norm, 10);
});

test('invalid marks are flagged and excluded', () => {
  const r = C.relative(course([{ id: 'a', name: 'A', max: 20, scored: 25, avg: 10 }, { id: 'b', name: 'B', max: 20, scored: -1, avg: 10 }, { id: 'c', name: 'C', max: 20, scored: 'abc', avg: 1 }]));
  assert.equal(r.invalid.length, 3); assert.equal(r.av, null); assert.equal(r.pre, 0);
  assert.ok(C.validateComponent({ max: -5 }).some(e => e.field === 'max'));
  assert.ok(C.validateComponent({ max: 10, rawMax: 0 }).some(e => e.field === 'rawMax'));
  assert.ok(C.validateComponent({ max: null, scored: 5 }).some(e => e.field === 'max'));
});

test('structure flags assessments that exceed the course total', () => {
  assert.equal(C.structure(course([{ max: 150 }, { max: 80 }])).errors.length, 1);
  assert.equal(C.structure(course([{ max: 120 }, { max: 80 }])).errors.length, 0);
  assert.equal(C.structure(course([{ max: 60 }])).unlisted, 140);
});

test('complete only when the whole course is graded (or marked completed)', () => {
  assert.equal(C.relative(course([{ id: 'a', max: 120, scored: 90, avg: 80 }, { id: 'b', max: 80, scored: 50, avg: 40 }])).complete, true);
  assert.equal(C.relative(course([{ id: 'a', max: 120, scored: 90, avg: 80 }])).complete, false);
  assert.equal(C.relative(course([{ id: 'a', max: 120, scored: 90, avg: 80 }], { status: 'completed' })).complete, true);
});

test('overall: credit-weighted normalised Av, projects excluded', () => {
  const a = course([{ id: 'a', max: 100, scored: 60, avg: 50 }], { id: 'a', credits: 4 }); // +10%
  const b = course([{ id: 'b', max: 50, scored: 20, avg: 25 }], { id: 'b', credits: 3, total: 300 }); // −10%
  const p = { id: 'p', kind: 'project', credits: 3 };
  const o = C.overall([a, b, p]);
  assert.ok(Math.abs(o.norm - (4 * 10 + 3 * -10) / 7) < 1e-9);
  assert.equal(o.of, 2);
});

test('simulate never mutates real records and projects Av', () => {
  const s = course([{ id: 'm', name: 'Mid', max: 80, scored: 50, avg: 40 }, { id: 'c', name: 'Compre', max: 120, scored: null, avg: null }]);
  const before = JSON.stringify(s);
  const out = C.simulate(s, { c: { my: 45, avg: 30 } });
  assert.equal(JSON.stringify(s), before);
  assert.equal(out.projAv, 10 + 15);
  assert.equal(out.projTotal, 95);
  assert.equal(C.relative(s).av, 10);
});

test('simulate: below-average scenario and validation', () => {
  const s = course([{ id: 'm', max: 80, scored: 50, avg: 40 }, { id: 'c', name: 'Compre', max: 120 }]);
  assert.equal(C.simulate(s, { c: { my: 20, avg: 30 } }).projAv, 0);
  assert.equal(C.simulate(s, { c: { my: 130, avg: 30 } }).warnings.length, 1);
});

test('neededFor: marks needed for an Av target, with feasibility', () => {
  const s = course([{ id: 'm', max: 80, scored: 50, avg: 40 }, { id: 'c', name: 'Compre', max: 120 }]);
  assert.deepEqual(C.neededFor(s, { c: { avg: 30 } }, 'c', 20).need, 40); // 10 + (x − 30) = 20
  assert.equal(C.neededFor(s, { c: { avg: 115 } }, 'c', 20).feasible, false);
  assert.ok(C.neededFor(s, { c: {} }, 'c', 20).error);
});

test('boundaries: honest statuses, scenarios', () => {
  const s = course([{ id: 'm', max: 100, scored: 60, avg: 50 }], { cutoffs: { A: 170, B: 100, C: 55 }, lastAvg: 100, expectedAvg: 110, estCutoffs: { A: 140 } });
  const h = C.boundaries(s, 'historical');
  assert.deepEqual(h.rows.map(r => r.status), ['out', 'reachable', 'above']);
  assert.equal(C.boundaries(s, 'shifted').cuts[0].cut, 180);
  assert.equal(C.boundaries(s, 'manual').cuts.length, 1);
  assert.equal(C.boundaries({ ...s, expectedAvg: null }, 'shifted').available, false);
});

test('prep: separate syllabus and practice, flags bad slide data, never 100% from nothing', () => {
  const p = C.prepDetail({ modules: [{ status: 3 }, { status: 0 }], slides: [{ name: 'L1', covered: 30, total: 20 }, { name: 'L2', covered: 5 }], tuts: [], pyqs: [] });
  assert.equal(p.cat.modules.p, 0.5);
  assert.equal(p.cat.slides.p, 1);
  assert.equal(p.flags.length, 2);
  assert.equal(p.practice, null);
  assert.equal(C.prepDetail({}).overall, null);
});

test('carryForward moves only unfinished goals once', () => {
  let n = 0; const mk = () => 'g' + ++n;
  const { goals, moved } = C.carryForward([{ id: 'a', date: '2026-11-23', text: 'x', progress: 40 }, { id: 'b', date: '2026-11-23', text: 'y', progress: 100 }], '2026-11-24', mk);
  assert.equal(moved, 1); assert.equal(goals.length, 3);
  assert.equal(goals[2].carriedFrom, '2026-11-23'); assert.equal(goals[2].carryCount, 1);
  assert.equal(C.carryForward(goals, '2026-11-24', mk).moved, 0);
});

test('sgpa keeps confirmed and predicted apart', () => {
  const r = C.sgpa([{ id: 'sop', credits: 3, grade: 'A', gradeConfirmed: true }, { id: 'iot', credits: 4 }, { id: 'opt', credits: 3 }], { iot: 'B' });
  assert.deepEqual(r.confirmed, ['sop']); assert.deepEqual(r.predicted, ['iot']); assert.deepEqual(r.missing, ['opt']);
  assert.ok(Math.abs(r.value - (30 + 32) / 7) < 1e-9);
});

test('priorities are explainable and respect overrides', () => {
  const s = course([{ id: 'm', max: 100, scored: 40, avg: 50 }], { id: 'iot', short: 'IoT', exam: { date: '2026-12-08' }, tuts: [{ status: 0 }] });
  const t = course([], { id: 'opt', short: 'Opti', exam: { date: '2026-12-12' } });
  const a = C.priorities({ subjects: [s, t], planner: { goals: [] }, config: { deadlines: [] }, today: '2026-11-30' });
  assert.match(a[0].title, /IoT is below average/);
  const b = C.priorities({ subjects: [s, t], planner: { goals: [] }, config: { deadlines: [], priorityOverrides: { opt: 'pin', iot: 'snooze' } }, today: '2026-11-30' });
  assert.equal(b[0].subject, 'opt'); assert.ok(!b.some(i => i.subject === 'iot' && i.kind === 'subject'));
});
