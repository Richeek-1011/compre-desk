import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as S from '../js/schema.js';
import { relative } from '../js/calc.js';

const sample = {
  format: 'compre-desk/claude-db-raw', formatVersion: 1, docs: {
    'subjects/vlsi': { version: 2, data: { id: 'vlsi', kind: 'course', code: 'EEE F313', name: 'Analog & Digital VLSI Design', short: 'VLSI', credits: 4, total: 300, components: [{ id: 'mid', name: 'Mid-sem', max: null, scored: null, avg: null }], exam: { date: '2026-12-15' } } },
    'subjects/hai': { version: 2, data: { id: 'hai', kind: 'course', code: 'BITS F364', name: 'Human AI Interaction', short: 'HAI', credits: 3, total: 100, components: [{ id: 'mid', name: 'Mid-sem', max: 25 }, { id: 'proj', name: 'Group project', max: 34 }, { id: 'stai', name: 'STAI', max: 1 }, { id: 'quiz', name: 'Quiz (bonus)', max: 0 }] } },
    'subjects/iot': { version: 2, data: { id: 'iot', kind: 'course', name: 'Internet of Things', short: 'IoT', credits: 3, total: 200, components: [] } },
    'subjects/sop': { version: 1, data: { id: 'sop', kind: 'project', name: 'Study Project', short: 'Study Project', credits: 3, grade: 'A', files: [] } },
    'app/planner': { version: 1, data: { goals: [{ id: 'g1', date: '2026-11-24', subject: 'iot', text: 'Tut 1', progress: 30 }], days: {} } },
    'app/config': { version: 3, data: { deadlines: [{ id: 'd1', title: 'Blog', subject: 'hai', date: '2026-12-01' }], links: [] } },
  },
};

test('claude raw backup imports and migrates with stable IDs', () => {
  const { state, changes } = S.parseBackup(JSON.stringify(sample));
  assert.deepEqual(Object.keys(state.subjects).sort(), ['hai', 'iot', 'sop', 'vlsi']);
  assert.equal(state.subjects.vlsi.short, 'ADVD');
  assert.equal(state.subjects.vlsi.name, 'Analog & Digital VLSI Design');
  assert.equal(state.subjects.iot.credits, 4);
  assert.equal(state.subjects.vlsi.credits, 3);
  assert.equal(state.subjects.sop.short, 'SOP');
  assert.equal(state.subjects.sop.gradeConfirmed, true);
  assert.equal(state.planner.goals[0].subject, 'iot');
  assert.equal(state.config.deadlines[0].subject, 'hai');
  assert.equal(state.meta.schema, S.SCHEMA);
  assert.ok(changes.length > 0);
});

test('HAI gets an explicit Compre worth 40; unknown weights stay unknown', () => {
  const { state } = S.parseBackup(sample);
  const c = state.subjects.hai.components.find(x => x.isCompre);
  assert.equal(c.max, 40);
  assert.equal(state.subjects.vlsi.components.find(x => x.isCompre).max, null);
});

test('VLSI is not renamed to ADVD if it is a different course', () => {
  const s2 = JSON.parse(JSON.stringify(sample)); s2.docs['subjects/vlsi'].data.code = 'EEE F999'; s2.docs['subjects/vlsi'].data.name = 'VLSI Testing';
  assert.equal(S.parseBackup(s2).state.subjects.vlsi.short, 'VLSI');
});

test('migration is idempotent', () => {
  const a = S.parseBackup(sample).state;
  const b = S.migrate(a);
  assert.deepEqual(b.state, a); assert.equal(b.changes.length, 0);
});

test('v2 export → import round trip', () => {
  const a = S.parseBackup(sample).state;
  const b = S.parseBackup(JSON.stringify(S.makeBackup(a, [{ id: 'f1', name: 'r.pdf', mime: 'application/pdf', base64: 'AAAA' }])));
  assert.deepEqual(b.state, a); assert.equal(b.files.length, 1);
});

test('rejects junk and bad ids', () => {
  assert.throws(() => S.parseBackup('nope'), /valid JSON/);
  assert.throws(() => S.parseBackup('{"a":1}'), /Compre Desk backup/);
  assert.throws(() => S.parseBackup({ subjects: { 'a/b': { id: 'a/b' } }, config: {} }), /problems/);
});

test('real backup from the Claude database migrates cleanly', { skip: !existsSync(process.env.CD_BACKUP || '/nonexistent') }, () => {
  const { state } = S.parseBackup(readFileSync(process.env.CD_BACKUP, 'utf8'));
  const names = Object.fromEntries(Object.values(state.subjects).map(s => [s.id, s.short]));
  assert.deepEqual(names, { comm: 'Commsys', ethics: 'Prof Ethics', hai: 'HAI', iot: 'IoT', opt: 'Opti', sop: 'SOP', vlsi: 'ADVD' });
  const credits = Object.fromEntries(Object.values(state.subjects).map(s => [s.id, s.credits]));
  assert.deepEqual(credits, { comm: 3, ethics: 3, hai: 3, iot: 4, opt: 3, sop: 3, vlsi: 3 });
  assert.equal(state.subjects.comm.cutoffs.A, 176);
  assert.equal(state.config.deadlines.length, 5);
  Object.values(state.subjects).forEach(s => s.kind !== 'project' && relative(s));
});

test('CSV escapes properly', () => {
  const st = { subjects: { a: { id: 'a', short: 'A', name: 'Al, "B"', components: [{ name: 'Q1', max: 10, scored: 0, avg: 5 }] } } };
  assert.match(S.assessmentsCsv(st), /"Al, ""B"""/);
  assert.match(S.assessmentsCsv(st), /Q1,10,,0,5/);
});
