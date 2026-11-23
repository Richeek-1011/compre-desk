// Compre Desk V2 UI. Works standalone (IndexedDB) or inside a Claude artifact (Claude database).
import * as C from './calc.js?v=2.0.2';
import * as SC from './schema.js?v=2.0.2';
import { LocalStore, ClaudeStore, Saver } from './store.js?v=2.0.2';

const VERSION = '2.0.2';
const $ = s => document.querySelector(s);
const main = $('#main');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { u = String(u || '').trim(); return /^https:\/\//i.test(u) ? u : ''; };
const uid = (p = '') => p + Math.random().toString(36).slice(2, 10);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const { num, r1, fmtAv, fmtPct } = C;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

let S = null, store = null, saver = null, mode = 'local', canWrite = true, downloads = null, unsub = null;
const V = { sel: C.iso(new Date()), calY: new Date().getFullYear(), calM: new Date().getMonth(), note: null, nq: '', ns: '', gq: '', ferr: {}, flash: [], er: null, et: 0, bulk: {}, showSnoozed: false, openRow: null, importPreview: null, lastDay: C.iso(new Date()) };

/* ---------------- helpers ---------------- */
const today = () => C.iso(new Date());
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = s => { if (!s) return ''; const d = C.pd(s); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()]; };
const t12 = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + C.pad(m) + ' ' + ap; };
const examTime = e => (e && e.start ? t12(e.start) + '–' + t12(e.end) : '');
const daysTo = d => C.daysBetween(today(), d);
const dn = s => (s ? s.short || s.name || s.id : 'General');
const ORDER = ['comm', 'iot', 'ethics', 'opt', 'hai', 'vlsi', 'sop'];
const ci = id => { let i = ORDER.indexOf(id); if (i < 0) { i = 0; for (const ch of String(id)) i = (i * 31 + ch.charCodeAt(0)) % 7; } return i + 1; };
const cvar = id => `--c:var(--s${ci(id)});--cf:var(--sf${ci(id)})`;
const subjects = () => Object.values(S.subjects).sort((a, b) => ((a.exam && a.exam.date) || '9999').localeCompare((b.exam && b.exam.date) || '9999') || dn(a).localeCompare(dn(b)));
const courses = () => subjects().filter(s => s.kind !== 'project');
const opt = (v, l, sel) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
const subOpts = sel => opt('', 'General', sel) + subjects().map(s => opt(s.id, dn(s), sel)).join('');
const bar = (p, id, label) => `<div class="bar"${id ? ` style="${cvar(id)}"` : ''} role="img" aria-label="${esc(label || (p === null ? 'No data' : Math.round(p * 100) + '%'))}"><i style="width:${p === null ? 0 : Math.round(Math.min(1, p) * 100)}%"></i></div>`;
const pctTxt = p => (p === null || p === undefined ? '—' : Math.round(p * 100) + '%');
const linkA = (u, l, cls = '') => { const s = safeUrl(u); return s ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(s)}" target="_blank" rel="noopener">${esc(l || 'Open')}</a>` : ''; };
const prefs = () => S.config.prefs;
const prep = s => C.prepDetail(s, prefs().prepWeights);
const avCls = v => (v === null ? 'na' : v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'zero');

/* ---------------- state + saving ---------------- */
function getDoc(p) { if (p.startsWith('subjects/')) return S.subjects[p.slice(9)]; return S[p.slice(4)]; }
function setDoc(p, d) { if (p.startsWith('subjects/')) { const id = p.slice(9); if (d === undefined) delete S.subjects[id]; else S.subjects[id] = d; } else S[p.slice(4)] = d; }
const touch = p => { if (!canWrite) { toast('This view is read-only.'); return; } saver.mark(p); };
const touchSub = id => touch('subjects/' + id);
function onSaveStatus(st) {
  const el = $('#status'); if (!el) return;
  el.dataset.state = st.state;
  el.textContent = st.state === 'saving' ? 'Saving…' : st.state === 'error' ? (st.permanent ? 'Not saved' : 'Retrying save…') : mode === 'claude' ? 'Saved' : 'Saved on this device';
  el.title = st.state === 'error' ? st.message : st.state === 'saved' && st.at ? 'Last confirmed save ' + new Date(st.at).toLocaleTimeString() : '';
  const b = $('#savebar');
  if (b) { b.hidden = st.state !== 'error'; if (st.state === 'error') b.querySelector('span').textContent = st.message; }
}
function withUndo(paths, label, fn, after) {
  const snaps = paths.map(p => [p, clone(getDoc(p))]);
  fn(); paths.forEach(touch); render();
  let undone = false;
  toast(label, () => { undone = true; snaps.forEach(([p, d]) => setDoc(p, d)); paths.forEach(touch); render(); });
  if (after) setTimeout(() => { if (!undone) after(); }, 9000);
}

/* ---------------- toast + dialog ---------------- */
function toast(msg, undo) {
  const t = $('#toast'); const id = uid();
  const el = document.createElement('div'); el.className = 'toast'; el.id = id;
  el.innerHTML = `<span></span>${undo ? '<button class="ghost sm" data-undo>Undo</button>' : ''}<button class="x" aria-label="Dismiss">×</button>`;
  el.querySelector('span').textContent = msg;
  if (undo) el.querySelector('[data-undo]').onclick = () => { undo(); el.remove(); };
  el.querySelector('.x').onclick = () => el.remove();
  t.appendChild(el); while (t.children.length > 3) t.firstElementChild.remove(); setTimeout(() => el.remove(), undo ? 9000 : 4500);
}
function dialog(html, mount) {
  const root = $('#modal'); const prev = document.activeElement;
  root.innerHTML = `<div class="overlay" data-close></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t">${html}</div>`;
  root.hidden = false;
  const close = () => { root.hidden = true; root.innerHTML = ''; if (prev && prev.focus) prev.focus(); };
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  root.onkeydown = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { const f = [...root.querySelectorAll('button,input,select,textarea,a[href]')].filter(x => !x.disabled); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  };
  const first = root.querySelector('input,select,textarea,button:not([data-close])'); if (first) first.focus();
  if (mount) mount(root.querySelector('.dlg'), close);
  return close;
}
function confirmDlg({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise(res => {
    dialog(`<h2 id="dlg-t">${esc(title)}</h2><p>${esc(body)}</p><div class="row end"><button class="ghost" data-close data-no>Cancel</button><button class="${danger ? 'warn' : ''}" data-yes>${esc(ok)}</button></div>`, (d, close) => {
      d.querySelector('[data-yes]').onclick = () => { close(); res(true); };
      d.querySelector('[data-no]').onclick = () => res(false);
      d.parentNode.querySelector('.overlay').addEventListener('click', () => res(false));
    });
  });
}

/* ---------------- rendering core ---------------- */
const route = () => (location.hash || '#home').slice(1) || 'home';
let pending = false;
function requestRender() { const a = document.activeElement; if (a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['range', 'checkbox', 'file'].includes(a.type)) { pending = true; return; } render(); }
main.addEventListener('focusout', () => setTimeout(() => { if (!pending) return; const a = document.activeElement; if (a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; render(); }, 0));

function render() {
  pending = false;
  const r = route();
  document.querySelectorAll('[data-r]').forEach(a => { const on = a.dataset.r === r || (a.dataset.r === 'home' && r.startsWith('s-') && false); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (!S) { $('#subs').innerHTML = ''; main.innerHTML = vOnboard(); return; }
  $('#subs').innerHTML = subjects().map(s => `<a class="chip${r === 's-' + s.id ? ' on' : ''}" style="${cvar(s.id)}" href="#s-${esc(s.id)}"${r === 's-' + s.id ? ' aria-current="page"' : ''}><i class="dot"></i>${esc(dn(s))}${s.exam && s.exam.date ? ` <small>${esc(fmt(s.exam.date).replace(/^\w+ /, ''))}</small>` : ''}</a>`).join('') + `<button class="chip" data-act="addSub">+ Subject</button>`;
  const ak = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  let h = '';
  try {
    if (r === 'planner') h = vPlanner(); else if (r === 'calendar') h = vCal(); else if (r === 'notes') h = vNotes(); else if (r === 'deadlines') h = vDeadlines(); else if (r === 'data') h = vData();
    else if (r.startsWith('s-') && S.subjects[r.slice(2)]) h = vSubject(S.subjects[r.slice(2)]); else h = vHome();
  } catch (e) { console.error(e); h = `<div class="wrap"><div class="banner">Something went wrong drawing this page: ${esc(e.message)}. Your data is safe. Try another page or export a backup from <a href="#data">Backup &amp; data</a>.</div></div>`; }
  const fl = V.flash.map((f, i) => `<div class="banner info flash"><span>${esc(f)}</span><button class="x" data-act="dismissFlash" data-i="${i}" aria-label="Dismiss">×</button></div>`).join('');
  main.innerHTML = (fl ? `<div class="wrap">${fl}</div>` : '') + h;
  if (V.er !== r) { V.er = r; main.classList.add('enter'); clearTimeout(V.et); V.et = setTimeout(() => main.classList.remove('enter'), 1200); }
  if (ak) { const el = main.querySelector(`[data-key="${CSS.escape(ak)}"]`); if (el) { el.focus(); if (el.setSelectionRange && /^(text|search|url)$/.test(el.type)) try { const L = el.value.length; el.setSelectionRange(L, L); } catch {} } }
}

/* ---------------- onboarding (standalone, empty) ---------------- */
function vOnboard() {
  return `<div class="wrap"><section class="sec"><div class="hc">${confetti()}<div class="herocard"><p class="lbl">Welcome to Compre Desk</p><h1 class="disp">Your data lives in this browser.</h1>
  <p class="lead">Nothing is stored on a server. To bring over what you had in the Claude version, import the backup JSON file. You can also start empty.</p>
  <div class="row" style="margin-top:18px"><label class="btnlike" for="imp0">Import a backup (.json)</label><input type="file" id="imp0" accept=".json,application/json" data-bind="import" class="vh"><button class="ghost" data-act="startEmpty">Start empty</button></div>
  <p class="sub" style="margin-top:16px">Browser data doesn’t sync between devices. Use <b>Backup &amp; data → Export</b> to move it.</p></div></div></section></div>`;
}

/* ---------------- confetti ---------------- */
const confetti = () => `<svg class="cf cf1" viewBox="0 0 60 56" aria-hidden="true"><polygon points="30,4 56,52 4,52" style="fill:#ffd23f" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg><svg class="cf cf3" viewBox="0 0 92 50" aria-hidden="true"><path d="M4 46A42 42 0 0 1 88 46Z" style="fill:var(--s3)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;

/* ---------------- overview ---------------- */
function chartRows() {
  const p = prefs(), modeN = p.chartMode !== 'raw';
  let rows = courses().map(s => ({ s, rel: C.relative(s) }));
  const key = r => (modeN ? r.rel.norm : r.rel.av);
  if (p.chartSort === 'exam') rows.sort((a, b) => ((a.s.exam && a.s.exam.date) || '9999').localeCompare((b.s.exam && b.s.exam.date) || '9999'));
  else if (p.chartSort === 'name') rows.sort((a, b) => dn(a.s).localeCompare(dn(b.s)));
  else rows.sort((a, b) => (key(b) ?? -1e9) - (key(a) ?? -1e9));
  return { rows, modeN, key };
}
function vChart() {
  const { rows, modeN, key } = chartRows();
  const vals = rows.map(key).filter(v => v !== null);
  const step = modeN ? 5 : 10; const maxAbs = Math.max(step, Math.ceil(Math.max(0, ...vals.map(Math.abs)) / step) * step);
  const p = prefs();
  const seg = (k, v, l) => `<button class="seg${p[k] === v ? ' on' : ''}" aria-pressed="${p[k] === v}" data-act="pref" data-k="${k}" data-v="${v}">${l}</button>`;
  const body = rows.map(({ s, rel }) => {
    const v = key({ rel }), open = V.openRow === s.id;
    const w = v === null ? 0 : (Math.abs(v) / maxAbs) * 50;
    const t = num(s.avTarget);
    const tm = !modeN && t !== null ? `<span class="ctarget" style="left:${50 + Math.max(-50, Math.min(50, (t / maxAbs) * 50))}%" title="Target ${esc(fmtAv(t))}"></span>` : '';
    const cov = rel.gradedMax ? `${r1(rel.covMax)} of ${r1(rel.gradedMax)} graded pts have averages · ${pctTxt(rel.coverage)} of course assessed` : 'Nothing graded yet';
    return `<div class="crow${open ? ' open' : ''}" style="${cvar(s.id)}">
      <button class="chead" data-act="crow" data-id="${esc(s.id)}" aria-expanded="${open}" title="${esc(dn(s) + ': ' + (rel.av === null ? 'no class averages yet' : fmtAv(rel.av) + ' course points, ' + fmtPct(rel.norm) + ' of assessed marks') + '. ' + cov)}">
      <span class="cname"><i class="dot"></i>${esc(dn(s))}</span>
      <span class="ctrack"><span class="czero"></span>${v === null ? `<span class="cnone">${rel.gradedMax ? 'Add class averages' : 'No marks yet'}</span>` : `<span class="cbar ${avCls(v)}" style="${v >= 0 ? 'left:50%' : 'right:50%'};width:${w}%"></span>`}${tm}</span>
      <span class="cval"><b>${rel.av === null ? '—' : esc(fmtAv(rel.av))}</b><small>${rel.norm === null ? '' : esc(fmtPct(rel.norm))}${rel.av !== null && !rel.complete ? ' · partial' : ''}</small></span></button>
      ${open ? vChartDetail(s, rel) : ''}</div>`;
  }).join('');
  if (!rows.length) return `<div class="empty">Add a subject and its marks to see how you compare with the class average.</div>`;
  return `<div class="chartbar"><div class="segs" role="group" aria-label="Sort">${seg('chartSort', 'perf', 'Performance')}${seg('chartSort', 'exam', 'Next compre')}${seg('chartSort', 'name', 'Subject')}</div>
    <div class="segs" role="group" aria-label="Scale">${seg('chartMode', 'norm', 'Normalised %')}${seg('chartMode', 'raw', 'Raw Av points')}</div></div>
  <div class="chart" role="list"><div class="caxis" aria-hidden="true"><span>${modeN ? '−' + maxAbs + '%' : 'Av−' + maxAbs}</span><span>class average</span><span>${modeN ? '+' + maxAbs + '%' : 'Av+' + maxAbs}</span></div>${body}</div>
  <p class="sub small">${modeN ? 'Bars: points above/below class average as a % of the marks assessed so far, so courses with different totals compare fairly.' : 'Bars: raw Av in course points. Totals differ between courses, so compare raw values only within a course.'} Labels always show raw Av. Tap a row for the breakdown.</p>`;
}
function vChartDetail(s, rel) {
  const rows = rel.rows.filter(r => r.graded || r.err.length);
  return `<div class="cdetail">${rows.length ? `<table class="mini"><thead><tr><th>Assessment</th><th class="n">You</th><th class="n">Class avg</th><th class="n">Av</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.c.name)}<small>${r.max === 0 ? 'bonus' : esc(r.max) + ' course pts'}${num(r.c.rawMax) ? ` · marked out of ${esc(r.c.rawMax)}` : ''}</small></td><td class="n">${r.err.length ? '<span class="pill w">check</span>' : r1(r.scPts)}</td><td class="n">${r.avPts === null ? '<span class="pill mut">missing</span>' : r1(r.avPts)}</td><td class="n"><b>${r.diff === null ? '—' : esc(fmtAv(r.diff))}</b></td></tr>`).join('')}</tbody></table>` : '<p class="sub">No graded assessments yet.</p>'}
  <p class="calc">${rel.av === null ? 'Av needs at least one assessment with both your score and the class average.' : `Av = Σ(you − class avg) = ${esc(fmtAv(rel.av))} course points over ${rel.rows.filter(r => r.diff !== null).length} assessment(s). Normalised = ${r1((rel.norm / 100) * rel.covMax)} ÷ ${r1(rel.covMax)} pts × 100 = ${esc(fmtPct(rel.norm))}.`} ${rel.complete ? 'Course fully graded.' : `Partial semester: ${pctTxt(rel.coverage)} of the course is graded, so this isn’t a final outcome.`}${rel.missingAvg.length ? ` Missing class average: ${esc(rel.missingAvg.map(c => c.name).join(', '))}.` : ''}</p>
  <a href="#s-${esc(s.id)}" class="sm">Open ${esc(dn(s))} →</a></div>`;
}
function vPriorityList(limit = 6, onlySubject = null) {
  const all = C.priorities({ subjects: subjects(), planner: S.planner, config: S.config, today: today(), name: dn, weights: prefs().prepWeights });
  const items = onlySubject ? all.filter(i => i.subject === onlySubject) : all.slice(0, limit);
  const ov = S.config.priorityOverrides || {}; const snoozed = Object.keys(ov).filter(k => ov[k] === 'snooze' && S.subjects[k]);
  return `${items.length ? `<ol class="prio">${items.map(i => { const s = S.subjects[i.subject]; return `<li class="pitem k-${i.kind}"${s ? ` style="${cvar(s.id)}"` : ''}>
    <div><p class="ptitle">${i.pinned ? '<span class="pill">Pinned</span> ' : ''}${esc(i.title)}</p><p class="preasons">${i.reasons.map(x => `<span>${esc(x)}</span>`).join('')}</p></div>
    <div class="pact">${i.kind === 'subject' ? `<button class="ghost sm" data-act="prio" data-id="${esc(i.subject)}" data-v="${i.pinned ? '' : 'pin'}">${i.pinned ? 'Unpin' : 'Pin'}</button><button class="ghost sm" data-act="prio" data-id="${esc(i.subject)}" data-v="snooze">Snooze</button>` : i.kind === 'deadline' ? '<a class="sm" href="#deadlines">Deadlines</a>' : i.kind === 'planner' ? '<a class="sm" href="#planner">Planner</a>' : s ? `<a class="sm" href="#s-${esc(s.id)}">Fix</a>` : ''}</div></li>`; }).join('')}</ol>` : '<div class="empty">Nothing urgent. Add marks, modules or goals and suggestions will appear here.</div>'}
  ${!onlySubject && snoozed.length ? `<p class="sub small">Snoozed: ${snoozed.map(id => `<button class="linkbtn" data-act="prio" data-id="${esc(id)}" data-v="">${esc(dn(S.subjects[id]))} (unsnooze)</button>`).join(' ')}</p>` : ''}`;
}
function predictedGrades() {
  const out = {};
  courses().forEach(s => { const rel = C.relative(s); if (!rel.gradedMax) return; const w = C.absoluteWhatIf(s, s.whatIf ?? 70, 'historical'); if (w.grade && C.GP[w.grade] !== undefined) out[s.id] = w.grade; });
  return out;
}
function vHome() {
  const t = today(), cs = courses(), ov = C.overall(subjects());
  const ranked = cs.map(s => ({ s, rel: C.relative(s) })).filter(x => x.rel.norm !== null).sort((a, b) => b.rel.norm - a.rel.norm);
  const exams = cs.filter(s => s.exam && s.exam.date).sort((a, b) => a.exam.date.localeCompare(b.exam.date));
  const next = exams.find(s => daysTo(s.exam.date) >= 0);
  const tg = S.planner.goals.filter(g => g.date === t); const tDone = tg.filter(g => num(g.progress) >= 100).length;
  const top = C.priorities({ subjects: subjects(), planner: S.planner, config: S.config, today: t, name: dn, weights: prefs().prepWeights })[0];
  const cardA = `<div class="card tcard-a"><p class="lbl">Relative standing</p>${ov.norm === null ? `<p class="big">—</p><p class="sub">Add your marks and the class averages to see how far above or below average you are.</p>` : `<p class="big ${avCls(ov.norm)}">${esc(fmtPct(ov.norm))} <span class="bigl">vs class average</span></p><p class="sub small">Credit-weighted, normalised across ${ov.used.length} of ${ov.of} courses with class averages. Partial semester.</p>
    <div class="bw">${ranked.length ? `<span>Best: <b>${esc(dn(ranked[0].s))}</b> ${esc(fmtAv(ranked[0].rel.av))}</span>` : ''}${ranked.length > 1 ? `<span>Weakest: <b>${esc(dn(ranked[ranked.length - 1].s))}</b> ${esc(fmtAv(ranked[ranked.length - 1].rel.av))}</span>` : ''}</div>`}
    <button class="sm" data-act="quickAdd">Quick add assessment</button></div>`;
  const cardB = next ? `<a class="card tcard-b" href="#s-${esc(next.id)}" style="${cvar(next.id)}"><p class="lbl">Next compre</p><div class="nx"><div class="count sm"><b>${daysTo(next.exam.date)}</b><span>${daysTo(next.exam.date) === 1 ? 'day' : 'days'}</span></div><div><p class="nxn">${esc(dn(next))}</p><p class="sub small">${esc(fmt(next.exam.date))} · ${esc(examTime(next.exam))}<br>Room ${esc(next.exam.room || 'not announced')}</p></div></div></a>` : `<div class="card tcard-b"><p class="lbl">Compres</p><p class="nxn">${exams.length ? 'All done' : 'No dates yet'}</p></div>`;
  const cardC = `<div class="card tcard-c"><p class="lbl">Today</p><div class="row nowrap"><span class="big2">${tDone}<small>/${tg.length}</small></span>${bar(tg.length ? tDone / tg.length : null, null, `${tDone} of ${tg.length} goals done`)}</div>
    <p class="sub small">${top ? 'Next priority: ' + esc(top.title) : 'No priorities yet.'}</p><a class="sm" href="#planner" data-act="goDay" data-d="${t}">Open today’s plan →</a></div>`;
  let strip = '', ei = 0; const last = exams.length ? exams[exams.length - 1].exam.date : null;
  if (last && daysTo(last) >= 0) for (let d = t; d <= last; d = C.addDays(d, 1)) {
    const ex = exams.filter(s => s.exam.date === d), dd = C.pd(d), gs = S.planner.goals.filter(g => g.date === d);
    strip += `<a class="day${d === t ? ' today' : ''}${ex.length ? ' exam' : ''}"${ex.length ? ` style="${cvar(ex[0].id)};--r:${ei % 2 ? 2 : -2}deg;--i:${ei++}"` : ''} href="#planner" data-act="goDay" data-d="${d}" aria-label="${esc(fmt(d) + (ex.length ? ': ' + ex.map(dn).join(', ') + ' compre' : '') + (gs.length ? `, ${gs.length} goals` : ''))}"><span class="wd">${WD[dd.getDay()]}</span><span class="dn">${dd.getDate()}</span>${ex.map(s => `<span class="ex">${esc(dn(s))}</span>`).join('')}${gs.length ? `<span class="dots">${gs.filter(g => num(g.progress) >= 100).length}/${gs.length}</span>` : ''}</a>`;
  }
  const carried = tg.filter(g => g.carriedFrom && num(g.progress) < 100);
  const dls = (S.config.deadlines || []).filter(d => !d.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const notes = (S.notes.items || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, 3);
  const sg = C.sgpa(subjects(), predictedGrades());
  return `<section class="band"><div class="wrap"><div class="topgrid">${cardA}${cardB}${cardC}</div></div></section>
  <div class="wrap">
  <section class="sec" aria-labelledby="h-rs"><div class="sechead"><h2 id="h-rs">Relative standing</h2></div>${vChart()}
    <div class="cmpgrid">${cs.map(s => { const rel = C.relative(s), p = prep(s); return `<a class="cmp" href="#s-${esc(s.id)}" style="${cvar(s.id)}"><span class="cmph"><i class="dot"></i>${esc(dn(s))}</span><span class="cmpv ${avCls(rel.av)}">${rel.av === null ? '—' : esc(fmtAv(rel.av))}</span>
      <span class="cmpl">Assessed ${rel.gradedMax ? `${r1(rel.gradedMax)}/${esc(s.total)}` : '0'} · averages ${rel.gradedMax ? pctTxt(rel.avgCoverage) : '—'}</span>${bar(rel.coverage, s.id, 'Course assessed ' + pctTxt(rel.coverage))}<span class="cmpl">Prep est. ${pctTxt(p.overall)}${s.exam && s.exam.date ? ` · compre ${esc(fmt(s.exam.date))}` : ''}</span></a>`; }).join('')}</div></section>
  <section class="sec" aria-labelledby="h-prep"><div class="grid2"><div><h2 id="h-prep">Study priority</h2><p class="sub small">Suggestions from compre dates, your Av, estimated prep and deadlines. Not predictions. Pin or snooze to override.</p>${vPriorityList(6)}</div>
    <div><h2>Today’s goals</h2>${tg.length ? `<div class="tcard"><table><tbody>${tg.map(g => { const s = S.subjects[g.subject]; return `<tr${s ? ` style="${cvar(s.id)}"` : ''}><td>${g.priority === 'high' ? '<span class="pill red">High</span> ' : ''}${esc(g.text)}${g.carriedFrom ? ` <span class="carry">carried${g.carryCount > 1 ? ` ${g.carryCount}×` : ''}</span>` : ''}<small>${esc(dn(s))}${g.target ? ' · ' + esc(g.target) : ''}</small></td><td style="width:110px">${bar((num(g.progress) || 0) / 100, s && s.id)}</td><td class="n pct">${num(g.progress) || 0}%</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">Nothing planned for today. <a href="#planner" data-act="goDay" data-d="${t}">Plan it</a></div>`}
    ${carried.length ? `<p class="sub small">${carried.length} carried forward from earlier days.</p>` : ''}</div></div></section>
  <section class="sec" aria-labelledby="h-up"><h2 id="h-up">Upcoming compres &amp; prep</h2>${strip ? `<div class="strip compact">${strip}</div>` : ''}
    <div class="prepgrid">${cs.map(s => { const p = prep(s); return `<a href="#s-${esc(s.id)}" class="prow" style="${cvar(s.id)}"><span class="cname"><i class="dot"></i>${esc(dn(s))}</span>${bar(p.overall, s.id, 'Estimated prep ' + pctTxt(p.overall))}<span class="pct">${pctTxt(p.overall)}</span></a>`; }).join('')}</div>
    <p class="sub small">Estimated prep, from the modules, slides, tut sheets and PYQs you track. See each subject for the breakdown.</p></section>
  <section class="sec"><div class="grid3 flat">
    <div><h2>Deadlines</h2>${dls.length ? `<ul class="list">${dls.slice(0, 6).map(d => { const du = d.date ? daysTo(d.date) : null; return `<li><span>${esc(d.title)}<small>${esc(dn(S.subjects[d.subject]))}</small></span>${d.date ? `<span class="pill${du < 0 ? ' red' : du <= 3 ? ' w' : ''}">${du < 0 ? 'Overdue · ' : ''}${esc(fmt(d.date))}</span>` : '<span class="pill mut">TBA</span>'}</li>`; }).join('')}</ul>` : '<div class="empty">No open deadlines.</div>'}<a class="sm" href="#deadlines">All deadlines →</a></div>
    <div><h2>Recent notes</h2>${notes.length ? `<ul class="list">${notes.map(n => `<li><a href="#notes" data-act="pickNote" data-item="${esc(n.id)}">${esc(n.title || 'Untitled')}</a><small>${esc(dn(S.subjects[n.subject]))}</small></li>`).join('')}</ul>` : '<div class="empty">No notes yet.</div>'}<a class="sm" href="#notes">Notes →</a></div>
    <div><h2>Quick links</h2><div class="links">${(S.config.links || []).map(l => linkA(l.url, l.label, 'chip')).filter(Boolean).join('') || '<span class="sub">No links yet. Add them in Backup &amp; data.</span>'}</div></div></div></section>
  <section class="sec"><details class="fold"><summary><h2>Detailed table &amp; projected SGPA</h2></summary>
    <div class="tcard scroll"><table class="stack"><thead><tr><th>Subject</th><th class="n">Credits</th><th class="n">Your marks</th><th class="n">Class (same items)</th><th class="n">Av</th><th>Assessed</th><th>Last offering’s cutoffs</th></tr></thead><tbody>${cs.map(s => { const rel = C.relative(s), b = C.boundaries(s, 'historical'); const best = b.rows.find(x => x.status !== 'out'); return `<tr style="${cvar(s.id)}"><td data-l="Subject"><a href="#s-${esc(s.id)}"><b>${esc(dn(s))}</b></a><small>${esc(s.name)} · ${esc(s.code || '')}</small></td><td data-l="Credits" class="n">${esc(s.credits)}</td><td data-l="Your marks" class="n">${rel.gradedMax ? `${r1(rel.pre)} / ${r1(rel.gradedMax)}` : '—'}</td><td data-l="Class (same items)" class="n">${rel.av === null ? '—' : `${r1(rel.myCov)} vs ${r1(rel.classCov)}`}</td><td data-l="Av" class="n"><b>${rel.av === null ? '—' : esc(fmtAv(rel.av))}</b></td><td data-l="Assessed">${pctTxt(rel.coverage)} of ${esc(s.total)}</td><td data-l="Cutoffs">${!b.cuts.length ? '<span class="sub">none</span>' : best ? (best.status === 'above' ? `at/above last ${esc(best.g)} cutoff` : `${esc(best.g)}: needs ${best.need} of ${b.remaining} left`) : 'below all'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="card sun" style="margin-top:20px"><h3 style="margin-top:0">Projected SGPA: ${sg.value === null ? '—' : sg.value.toFixed(2)}</h3>
    <p class="sub small">Confirmed: ${sg.confirmed.map(id => `${esc(dn(S.subjects[id]))} (${esc(S.subjects[id].grade)})`).join(', ') || 'none'}. Predicted: ${sg.predicted.map(id => `${esc(dn(S.subjects[id]))} (${esc(predictedGrades()[id])})`).join(', ') || 'none'}. Not included: ${sg.missing.map(id => esc(dn(S.subjects[id]))).join(', ') || 'none'}.</p>
    <p class="sub small">Predictions use last offering’s cutoffs and each subject’s absolute what-if (default: 70% of the marks still to be graded). BITS grading is relative, so real cutoffs will differ. Treat this as a rough scenario, not a forecast.</p></div></details></section>
  </div>`;
}

/* ---------------- subject page ---------------- */
const TABS = { course: [['perf', 'Performance'], ['syl', 'Syllabus & slides'], ['prac', 'Tuts & PYQs'], ['more', 'Notes & links']], project: [['files', 'Reports & simulations'], ['more', 'Notes & links']] };
const curTab = s => { const tabs = TABS[s.kind === 'project' ? 'project' : 'course']; const t = lsGet('cd:tab:' + s.id); return tabs.some(x => x[0] === t) ? t : tabs[0][0]; };
function itemInput(s, list, it, c) {
  const key = `i|${s.id}|${list}|${it.id}|${c.k}`, a = `data-bind="item" data-id="${esc(s.id)}" data-list="${list}" data-item="${esc(it.id)}" data-k="${c.k}" data-key="${esc(key)}"`;
  const v = it[c.k], err = V.ferr[key];
  const ea = err ? ` aria-invalid="true" aria-describedby="e-${esc(key)}"` : '';
  let h;
  if (c.t === 'status') h = `<select ${a} data-type="num" aria-label="${c.l}">${({ modules: ['Not started', 'Reading', 'Done', 'Revised'], tuts: ['Not started', 'Attempted', 'Solved', 'Revised'], pyqs: ['Not started', 'Attempted', 'Done + checked'] })[list].map((x, i) => opt(i, x, v || 0)).join('')}</select>`;
  else if (c.t === 'num') h = `<input type="number" inputmode="decimal" step="any" min="0"${c.max != null ? ` max="${c.max}"` : ''} ${a} data-type="num" value="${v ?? ''}" aria-label="${c.l}" placeholder="${c.ph || ''}"${ea}>`;
  else if (c.t === 'url') { const l = linkA(v, 'Open'); h = `<div class="row nowrap"><input type="url" ${a} value="${esc(v || '')}" placeholder="https://…" aria-label="${c.l}">${l}</div>`; }
  else h = `<input ${a} value="${esc(v || '')}" aria-label="${c.l}" placeholder="${c.ph || ''}">`;
  return h + (err ? `<small class="ferr" id="e-${esc(key)}">${esc(err)}</small>` : '');
}
function listTable(s, list, cols, extra) {
  const items = s[list] || [];
  const ph = { pyqs: 'Add a paper, e.g. Compre 2025-26 Sem 1', tuts: 'Add a tut sheet', slides: 'Add a slide deck / lecture', links: 'Add a link label, then paste its URL', modules: 'Add a module' }[list];
  return `${items.length ? `<div class="tcard scroll"><table class="stack"><thead><tr>${cols.map(c => `<th${c.t === 'num' ? ' class="n"' : ''}>${c.l}</th>`).join('')}${extra ? '<th></th>' : ''}<th><span class="vh">Remove</span></th></tr></thead><tbody>${items.map(it => `<tr>${cols.map(c => `<td data-l="${c.l}">${itemInput(s, list, it, c)}</td>`).join('')}${extra ? `<td>${extra(it)}</td>` : ''}<td><button class="x" data-act="delItem" data-id="${esc(s.id)}" data-list="${list}" data-item="${esc(it.id)}" aria-label="Remove ${esc(it.name || 'item')}">×</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">Nothing here yet.</div>`}
  <div class="row addrow"><input id="new-${list}" data-enter="addItem" data-id="${esc(s.id)}" data-list="${list}" placeholder="${ph}" aria-label="${ph}"><button data-act="addItem" data-id="${esc(s.id)}" data-list="${list}">Add</button></div>`;
}
function vSubject(s) {
  const id = s.id, isP = s.kind === 'project', e = s.exam || {}, cv = cvar(id), tab = curTab(s);
  const tabs = TABS[isP ? 'project' : 'course'];
  let head;
  if (isP) {
    head = `<div class="herocard tinted" style="${cv}"><p class="lbl">${esc([s.name !== dn(s) ? s.name : '', s.credits ? s.credits + ' credits' : ''].filter(Boolean).join(' · '))}</p><div class="herogrid"><h1 class="disp">${esc(dn(s))}</h1><div class="count"><b>${esc(s.grade || '—')}</b><span>${s.gradeConfirmed ? 'confirmed' : 'grade'}</span></div></div></div>`;
  } else {
    const rel = C.relative(s), p = prep(s), du = e.date ? daysTo(e.date) : null;
    const nxt = C.priorities({ subjects: [s], planner: { goals: [] }, config: { deadlines: [], priorityOverrides: {} }, today: today(), name: dn, weights: prefs().prepWeights })[0];
    head = `<div class="herocard tinted" style="${cv}"><p class="lbl">${esc(s.name)} · ${esc(s.code || 'no code')} · ${esc(s.credits)} credits</p>
    <div class="herogrid"><div><h1 class="disp">${esc(dn(s))}</h1>
      <div class="hstats"><div class="hs"><span>Relative standing</span><b>${rel.av === null ? '—' : esc(fmtAv(rel.av))}</b><small>${rel.av === null ? (rel.gradedMax ? 'class averages missing' : 'no marks yet') : `${r1(rel.myCov)} vs class ${r1(rel.classCov)} · ${esc(fmtPct(rel.norm))}${rel.complete ? '' : ' · partial'}`}</small></div>
      <div class="hs"><span>Assessed</span><b>${pctTxt(rel.coverage)}</b><small>${r1(rel.gradedMax)} of ${esc(s.total)} pts</small></div>
      <div class="hs"><span>Prep (est.)</span><b>${pctTxt(p.overall)}</b><small>syllabus ${pctTxt(p.syllabus)} · practice ${pctTxt(p.practice)}</small></div></div>
      <div class="row metas"><span class="pill inv">${e.date ? esc(fmt(e.date)) : 'Date not set'}</span>${e.start ? `<span class="pill inv">${esc(examTime(e))}</span>` : ''}<label class="roomrow"><span>Room</span><input data-bind="sub" data-id="${esc(id)}" data-k="exam.room" data-key="s|${esc(id)}|exam.room" value="${esc(e.room || '')}" placeholder="Add when announced"></label></div>
      ${nxt && du !== null && du >= 0 ? `<p class="nextact"><b>Next:</b> ${esc(nxt.title)}</p>` : ''}</div>
      <div class="count"><b>${du === null ? '—' : du < 0 ? '✓' : du}</b><span>${du === null ? 'no date' : du < 0 ? 'exam done' : du === 1 ? 'day to go' : 'days to go'}</span></div></div></div>`;
  }
  const tabBar = `<div class="tabs" role="tablist" aria-label="${esc(dn(s))} sections">${tabs.map(([k, l]) => `<button role="tab" id="tab-${k}" aria-selected="${k === tab}" aria-controls="panel" tabindex="${k === tab ? 0 : -1}" class="tab" data-act="tab" data-id="${esc(id)}" data-t="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'perf') body = vPerf(s); else if (tab === 'syl') body = vSyl(s); else if (tab === 'prac') body = vPrac(s); else if (tab === 'files') body = vFiles(s); else body = vMore(s);
  return `<section class="hero"><div class="wrap"><div class="hc">${confetti()}${head}</div></div></section>
  <div class="wrap"><div class="tabwrap">${tabBar}</div><div id="panel" role="tabpanel" aria-labelledby="tab-${tab}" style="${cv}">${body}</div></div>`;
}
function vPerf(s) {
  const id = s.id, rel = C.relative(s), stc = C.structure(s);
  const comps = s.components || [];
  const a = (c, k) => `data-bind="item" data-id="${esc(id)}" data-list="components" data-item="${esc(c.id)}" data-k="${k}" data-key="i|${esc(id)}|components|${esc(c.id)}|${k}"`;
  const fe = (c, k) => { const key = `i|${id}|components|${c.id}|${k}`; return V.ferr[key] ? ` aria-invalid="true"` : ''; };
  const errs = comps.flatMap(c => ['name', 'max', 'rawMax', 'scored', 'avg'].map(k => V.ferr[`i|${id}|components|${c.id}|${k}`] ? `${c.name || 'Row'}: ${V.ferr[`i|${id}|components|${c.id}|${k}`]}` : null).filter(Boolean));
  const rowsH = rel.rows.map(r => { const c = r.c, lim = C.entryLimit(c); return `<tr${r.err.length ? ' class="bad"' : ''}><td data-l="Assessment"><input ${a(c, 'name')} value="${esc(c.name || '')}" aria-label="Assessment name"></td>
    <td data-l="Course pts"><input type="number" inputmode="decimal" step="any" min="0" ${a(c, 'max')} data-type="num" value="${c.max ?? ''}" aria-label="Course points"${fe(c, 'max')}></td>
    <td data-l="Marked out of"><input type="number" inputmode="decimal" step="any" min="0" ${a(c, 'rawMax')} data-type="num" value="${c.rawMax ?? ''}" placeholder="same" aria-label="Raw marks out of (optional)"${fe(c, 'rawMax')}></td>
    <td data-l="You"><input type="number" inputmode="decimal" step="any" min="0"${lim !== null ? ` max="${lim}"` : ''} ${a(c, 'scored')} data-type="num" value="${c.scored ?? ''}" aria-label="Your marks"${fe(c, 'scored')}></td>
    <td data-l="Class avg"><input type="number" inputmode="decimal" step="any" min="0"${lim !== null ? ` max="${lim}"` : ''} ${a(c, 'avg')} data-type="num" value="${c.avg ?? ''}" placeholder="${r.graded ? 'add' : ''}" aria-label="Class average"${fe(c, 'avg')}></td>
    <td data-l="Av" class="n"><b class="${avCls(r.diff)}">${r.diff === null ? (r.missingAvg ? '<span class="pill w">need avg</span>' : '—') : esc(fmtAv(r.diff))}</b></td>
    <td><button class="x" data-act="delItem" data-id="${esc(id)}" data-list="components" data-item="${esc(c.id)}" aria-label="Remove ${esc(c.name || 'assessment')}">×</button></td></tr>`; }).join('');
  const bk = V.bulk[id] || { text: '', rows: null };
  return `<section class="sec"><div class="sechead"><h2>Assessments</h2><button class="sm" data-act="quickAdd" data-id="${esc(id)}">Quick add</button></div>
    <p class="sub small">“Course pts” is what the assessment is worth out of the course total (${esc(s.total)}). If it was marked out of something else (e.g. a 20-mark quiz worth 10 points), fill “Marked out of” and type marks as printed; they’re converted once. 0 is a real mark; leave a box empty if unknown.</p>
    ${stc.errors.length ? `<div class="banner">${esc(stc.errors.join('. '))}</div>` : ''}${errs.length ? `<div class="banner" role="alert">${errs.map(esc).join('<br>')}</div>` : ''}
    <div class="tcard scroll"><table class="stack assess"><thead><tr><th>Assessment</th><th>Course pts</th><th>Marked out of</th><th>You</th><th>Class avg</th><th class="n">Av</th><th><span class="vh">Remove</span></th></tr></thead><tbody>${rowsH}</tbody>
    <tfoot><tr><td colspan="7"><b>${rel.av === null ? 'Av —' : esc(fmtAv(rel.av))}</b> on ${r1(rel.covMax)} pts with averages${rel.norm !== null ? ` (${esc(fmtPct(rel.norm))})` : ''} · your graded total ${r1(rel.pre)} / ${r1(rel.gradedMax)} · ${stc.unlisted > 0 ? `${stc.unlisted} pts not yet listed` : 'all course points listed'}</td></tr></tfoot></table></div>
    <details class="fold sm" ${bk.rows ? 'open' : ''}><summary>Bulk add assessments</summary><p class="sub small">One per line: <code>name, course pts, your score, class avg, marked out of</code> (last three optional). Example: <code>Quiz 2, 10, 7.5, 6</code></p>
      <textarea data-bind="bulk" data-id="${esc(id)}" data-key="b|${esc(id)}" rows="4">${esc(bk.text)}</textarea><div class="row"><button class="ghost" data-act="bulkPreview" data-id="${esc(id)}">Preview</button>${bk.rows ? `<button data-act="bulkAdd" data-id="${esc(id)}"${bk.rows.some(r => !r.err) ? '' : ' disabled'}>Add ${bk.rows.filter(r => !r.err).length} valid row${bk.rows.filter(r => !r.err).length === 1 ? '' : 's'}</button>` : ''}</div>
      ${bk.rows ? `<ul class="list">${bk.rows.map(r => `<li>${esc(r.line)} ${r.err ? `<span class="pill w">${esc(r.err)}</span>` : '<span class="pill ok">ok</span>'}</li>`).join('')}</ul>` : ''}</details>
  </section>
  ${vSim(s, rel)}
  ${vBounds(s)}
  <section class="sec"><details class="fold"><summary><h2>Course details</h2></summary>${vCourseDetails(s)}</details></section>`;
}
function vSim(s, rel) {
  const sim = s.sim || {}, id = s.id, res = C.simulate(s, sim);
  const up = rel.upcoming;
  const t = num(s.avTarget);
  const tgtComp = (V.simComp && V.simComp[id]) || (up[up.length - 1] && up[up.length - 1].id) || '';
  const need = up.length && t !== null ? C.neededFor(s, sim, tgtComp, t) : null;
  const si = (c, k) => `<input type="number" inputmode="decimal" step="any" min="0"${C.entryLimit(c) !== null ? ` max="${C.entryLimit(c)}"` : ''} data-bind="sim" data-id="${esc(id)}" data-item="${esc(c.id)}" data-k="${k}" data-key="sim|${esc(id)}|${esc(c.id)}|${k}" value="${(sim[c.id] || {})[k] ?? ''}" aria-label="${k === 'my' ? 'Your assumed score' : 'Assumed class average'} for ${esc(c.name)}">`;
  return `<section class="sec"><div class="card simcard"><h2>Relative what-if</h2><p class="sub small">Scenario only. These numbers are saved separately and never change your real marks. Class averages are never filled in for you.</p>
  ${up.length ? `<div class="tcard scroll"><table class="stack"><thead><tr><th>Upcoming</th><th>Your score</th><th>Assumed class avg</th><th>Quick scenarios</th><th class="n">Av</th></tr></thead><tbody>${res.items.map(it => { const c = it.c, lim = C.entryLimit(c); return `<tr><td data-l="Upcoming"><b>${esc(c.name)}</b><small>${esc(c.max)} course pts${num(c.rawMax) ? `, out of ${esc(c.rawMax)}` : ''}</small></td><td data-l="Your score">${si(c, 'my')}</td><td data-l="Class avg">${si(c, 'avg')}</td>
    <td data-l="Quick">${it.avg === null ? '<span class="sub small">set an average first</span>' : `<div class="row nowrap">${[[-0.1, '−10%'], [0, 'At avg'], [0.1, '+10%'], [0.2, '+20%']].map(([k, l]) => `<button class="ghost xs" data-act="simPreset" data-id="${esc(id)}" data-item="${esc(c.id)}" data-v="${k}" aria-label="Score ${l} of ${lim} relative to the average">${l}</button>`).join('')}</div>`}</td>
    <td data-l="Av" class="n"><b class="${avCls(it.diff)}">${it.diff === null ? '—' : esc(fmtAv(it.diff))}</b></td></tr>`; }).join('')}</tbody></table></div>
  ${res.warnings.length ? `<div class="banner">${res.warnings.map(esc).join('<br>')}</div>` : ''}
  <div class="simres"><div><span class="lbl">Projected Av (scenario)</span><b class="${avCls(res.projAv)}">${res.projAv === null ? '—' : esc(fmtAv(res.projAv))}</b><small>now ${rel.av === null ? '—' : esc(fmtAv(rel.av))}</small></div>
    <div><span class="lbl">Projected normalised</span><b>${res.projNorm === null ? '—' : esc(fmtPct(res.projNorm))}</b><small>of assessed marks</small></div>
    <div><span class="lbl">Projected total</span><b>${res.projTotal}</b><small>of ${esc(s.total)} (only filled-in scores)</small></div></div>
  <div class="row target"><label>Target <input type="number" step="any" data-bind="sub" data-id="${esc(id)}" data-k="avTarget" data-type="num" data-key="s|${esc(id)}|avTarget" value="${t ?? ''}" placeholder="20" style="width:90px" aria-label="Target Av, e.g. 20 for Av+20"></label><label>in <select data-bind="simComp" data-id="${esc(id)}" aria-label="Assessment to solve for">${up.map(c => opt(c.id, c.name, tgtComp)).join('')}</select></label>
    <p class="needout">${t === null ? 'Set a target like 20 to see the marks you’d need.' : need.error ? esc(need.error) : `For ${esc(fmtAv(t))}: <b>${need.need}</b>${need.limit ? ` / ${need.limit}` : ''} in ${esc((up.find(c => c.id === tgtComp) || {}).name || '')}${need.feasible ? '' : ' (not reachable here alone)'}. ${esc(need.note || 'Assumes the averages and other scores above.')}`}</p></div>
  <div class="row"><button class="ghost sm" data-act="simReset" data-id="${esc(id)}">Clear scenario</button></div>` : `<div class="empty">No upcoming assessments with a weight. Give the Compre row its course points to simulate it.</div>`}</div></section>`;
}
function vBounds(s) {
  const id = s.id, sc = s.boundScenario || 'historical', b = C.boundaries(s, sc), wi = C.absoluteWhatIf(s, s.whatIf ?? 70, sc);
  const cutGrid = (set, label) => `<p class="lbl">${label}</p><div class="cuts">${C.GRADES.map(g => `<div><label for="${set}-${esc(id)}-${g}">${g}</label><input id="${set}-${esc(id)}-${g}" type="number" step="any" min="0" data-bind="cut" data-set="${set}" data-id="${esc(id)}" data-k="${g}" data-type="num" data-key="c|${set}|${esc(id)}|${g}" value="${s[set] && s[set][g] != null ? s[set][g] : ''}"></div>`).join('')}</div>`;
  const stLabel = r => (r.status === 'above' ? '<span class="pill ok">At/above</span>' : r.status === 'out' ? '<span class="pill w">Out of reach</span>' : `${Math.round(r.pct * 100)}% of what’s left`);
  return `<section class="sec"><details class="fold"><summary><h2>Grade boundaries (reference)</h2></summary>
  <div class="banner info">These are not your grades. BITS grading is relative: real cutoffs are set after the compre. Last offering’s boundaries and the “shifted” scenario are rough references; nothing here is guaranteed.</div>
  <div class="row" style="margin:14px 0"><label>Scenario <select data-bind="sub" data-id="${esc(id)}" data-k="boundScenario">${opt('historical', `Last offering’s cutoffs${s.cutSource ? ' (' + s.cutSource + ')' : ''}`, sc)}${opt('shifted', 'Shifted by expected class average (heuristic)', sc)}${opt('manual', 'My own estimates', sc)}</select></label></div>
  <div class="grid2"><div>
    <div class="kv"><div><label>Course total</label><input type="number" step="any" data-bind="sub" data-id="${esc(id)}" data-k="total" data-type="num" data-key="s|${esc(id)}|total" value="${s.total ?? ''}"></div><div><label>Last offering’s average</label><input type="number" step="any" data-bind="sub" data-id="${esc(id)}" data-k="lastAvg" data-type="num" data-key="s|${esc(id)}|lastAvg" value="${s.lastAvg ?? ''}"></div><div><label>Expected average now</label><input type="number" step="any" data-bind="sub" data-id="${esc(id)}" data-k="expectedAvg" data-type="num" data-key="s|${esc(id)}|expectedAvg" value="${s.expectedAvg ?? ''}" placeholder="unknown"></div></div>
    ${cutGrid('cutoffs', `Last offering’s cutoffs${s.cutSource ? ' · ' + esc(s.cutSource) : ''}`)}${cutGrid('estCutoffs', 'My estimates')}
  </div><div>
    ${!b.available ? '<div class="empty">The shifted scenario needs both the last offering’s average and an expected average.</div>' : !b.rows.length ? '<div class="empty">No boundaries in this scenario yet.</div>' : `<div class="tcard"><table><thead><tr><th>Grade</th><th class="n">Cutoff</th><th class="n">You need</th><th class="n">Status</th></tr></thead><tbody>${b.rows.map(r => `<tr><td><b>${r.g}</b></td><td class="n">${r.cut}</td><td class="n">${r.status === 'above' ? '0' : r.need}</td><td class="n">${stLabel(r)}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub small">Your graded total ${b.pre}; ${b.remaining} course points still to be graded.${sc === 'shifted' ? ` Cutoffs moved by ${b.shift > 0 ? '+' : ''}${r1(b.shift)} (expected − last average), an assumption.` : ''}</p>
    <div class="card" style="margin-top:14px"><div class="whatif"><div><label for="wi-${esc(id)}"><b>Absolute what-if:</b> if I score <output>${esc(s.whatIf ?? 70)}</output>% of the remaining ${b.remaining}</label><input type="range" id="wi-${esc(id)}" min="0" max="100" step="1" value="${esc(s.whatIf ?? 70)}" data-bind="sub" data-id="${esc(id)}" data-k="whatIf" data-type="num"><p class="sub small">Total ≈ <b class="wit">${wi.projected}</b> / ${esc(s.total)} → under this scenario: <b class="wig">${esc(wi.grade || '—')}</b></p></div><div class="gr wig">${esc(wi.grade || '—')}</div></div></div>`}
  </div></div></details></section>`;
}
function vCourseDetails(s) {
  const id = s.id;
  const sb = (k, label, type = 'text', isNum = false, ph = '') => `<div><label for="f-${esc(id)}-${k}">${label}</label><input id="f-${esc(id)}-${k}" type="${type}" ${isNum ? 'data-type="num" step="any" inputmode="decimal"' : ''} data-bind="sub" data-id="${esc(id)}" data-k="${k}" data-key="s|${esc(id)}|${k}" value="${esc(k.split('.').reduce((o, x) => o && o[x], s) ?? '')}" placeholder="${ph}"></div>`;
  return `<div class="kv">${sb('short', 'Short name')}${sb('name', 'Official name')}${sb('code', 'Course code')}${sb('credits', 'Credits', 'number', true)}${sb('total', 'Course total', 'number', true)}${sb('exam.date', 'Compre date', 'date')}${sb('exam.start', 'Starts', 'time')}${sb('exam.end', 'Ends', 'time')}${sb('cutSource', 'Cutoff source')}
  <div><label for="f-${esc(id)}-status">Status</label><select id="f-${esc(id)}-status" data-bind="sub" data-id="${esc(id)}" data-k="status">${opt('ongoing', 'Ongoing (partial)', s.status)}${opt('completed', 'Completed (final)', s.status)}</select></div></div>
  ${s.weightNote ? `<p class="sub small" style="margin-top:12px">${esc(s.weightNote)}</p>` : ''}
  <div style="margin-top:20px"><button class="ghost warn-o" data-act="delSub" data-id="${esc(id)}">Remove ${esc(dn(s))}…</button></div>`;
}
function prepExplain(s) {
  const p = prep(s), w = prefs().prepWeights;
  return `<details class="fold sm"><summary>How estimated prep is calculated</summary><p class="sub small">Each category you track gives a %: modules and tut sheets count Not started 0, Reading/Attempted 50%, Done/Solved 85%, Revised 100%; slides use slides covered ÷ total slides; PYQs count Attempted 60%, Done + checked 100%. Syllabus = modules + slides, practice = tut sheets + PYQs, overall = weighted mix (weights: modules ${w.modules}, slides ${w.slides}, tuts ${w.tuts}, PYQs ${w.pyqs}; change in Backup &amp; data). Categories with nothing tracked are skipped${p.basis.length ? `; this one uses ${p.basis.join(', ')}` : ''}.</p>${p.flags.length ? `<div class="banner">${p.flags.map(esc).join('<br>')}</div>` : ''}</details>`;
}
function vSyl(s) {
  const id = s.id, p = prep(s);
  return `<section class="sec"><div class="sechead"><h2>Syllabus coverage <span class="pill">${pctTxt(p.syllabus)}</span></h2></div>${prepExplain(s)}
  <h3>Syllabus</h3><textarea data-bind="sub" data-id="${esc(id)}" data-k="syllabus" data-key="s|${esc(id)}|syllabus" placeholder="Paste the compre syllabus here, however it was shared">${esc(s.syllabus || '')}</textarea>
  <div class="row" style="margin:10px 0 0"><button class="ghost sm" data-act="syl2mod" data-id="${esc(id)}">Make modules from syllabus lines</button></div>
  <h3>Modules <span class="pill">${p.cat.modules ? `${p.cat.modules.done}/${p.cat.modules.n} done` : '0'}</span></h3>${listTable(s, 'modules', [{ k: 'name', l: 'Module' }, { k: 'status', l: 'Status', t: 'status' }, { k: 'note', l: 'Note', ph: 'weak spots, page refs…' }])}
  <h3>Slides <span class="pill">${p.cat.slides ? pctTxt(p.cat.slides.p) : '—'}</span></h3>${listTable(s, 'slides', [{ k: 'name', l: 'Deck' }, { k: 'link', l: 'Link', t: 'url' }, { k: 'covered', l: 'Covered', t: 'num', ph: '0' }, { k: 'total', l: 'Total slides', t: 'num' }], it => `<button class="ghost xs" data-act="slideDone" data-id="${esc(id)}" data-item="${esc(it.id)}"${num(it.total) ? '' : ' disabled title="Set the total first"'}>Done</button>`)}</section>`;
}
function vPrac(s) {
  const id = s.id, p = prep(s);
  const pyqLinks = (S.config.links || []).filter(l => /pyq|paper|question/i.test(l.label || ''));
  return `<section class="sec"><div class="sechead"><h2>Practice <span class="pill">${pctTxt(p.practice)}</span></h2></div>${prepExplain(s)}
  <h3>Tut sheets <span class="pill">${p.cat.tuts ? `${p.cat.tuts.done}/${p.cat.tuts.n} solved` : '0'}</span></h3>
  <div class="row addrow" style="max-width:440px"><input type="number" id="ntuts" min="1" max="30" placeholder="How many sheets?" aria-label="Number of tut sheets"><button class="ghost" data-act="addTuts" data-id="${esc(id)}">Add sheets 1…N</button></div>
  ${listTable(s, 'tuts', [{ k: 'name', l: 'Sheet' }, { k: 'link', l: 'Link', t: 'url' }, { k: 'status', l: 'Status', t: 'status' }])}
  <h3>PYQs <span class="pill">${p.cat.pyqs ? `${p.cat.pyqs.done}/${p.cat.pyqs.n} done` : '0'}</span></h3>${pyqLinks.length ? `<p class="sub small">Find papers: ${pyqLinks.map(l => linkA(l.url, l.label)).join(' · ')}</p>` : ''}
  ${listTable(s, 'pyqs', [{ k: 'name', l: 'Paper' }, { k: 'link', l: 'Link', t: 'url' }, { k: 'status', l: 'Status', t: 'status' }, { k: 'score', l: 'Score', t: 'num' }, { k: 'outOf', l: 'Out of', t: 'num' }])}</section>`;
}
function vMore(s) {
  const id = s.id;
  return `<section class="sec"><h2>Links</h2><div class="links" style="margin-bottom:12px">${(S.config.links || []).map(l => linkA(l.url, l.label, 'chip')).filter(Boolean).join('')}</div>
  ${listTable(s, 'links', [{ k: 'name', l: 'Label' }, { k: 'link', l: 'URL', t: 'url' }])}
  <h2 style="margin-top:32px">Notes</h2><p class="sub small">Formulas to memorise, doubts for the TA, topics the prof stressed.</p><textarea style="min-height:220px" data-bind="sub" data-id="${esc(id)}" data-k="notes" data-key="s|${esc(id)}|notes" aria-label="${esc(dn(s))} notes">${esc(s.notes || '')}</textarea>
  ${s.kind === 'project' ? `<details class="fold" style="margin-top:24px"><summary><h2>Project details</h2></summary><div class="kv"><div><label>Short name</label><input data-bind="sub" data-id="${esc(id)}" data-k="short" value="${esc(s.short || '')}"></div><div><label>Official name</label><input data-bind="sub" data-id="${esc(id)}" data-k="name" value="${esc(s.name || '')}"></div><div><label>Credits</label><input type="number" data-type="num" data-bind="sub" data-id="${esc(id)}" data-k="credits" value="${esc(s.credits ?? '')}"></div><div><label>Grade</label><select data-bind="sub" data-id="${esc(id)}" data-k="grade">${opt('', '—', s.grade)}${C.GRADES.map(g => opt(g, g, s.grade)).join('')}</select></div><div><label class="row nowrap"><input type="checkbox" data-bind="sub" data-id="${esc(id)}" data-k="gradeConfirmed" ${s.gradeConfirmed ? 'checked' : ''}> Grade confirmed</label></div></div><div style="margin-top:20px"><button class="ghost warn-o" data-act="delSub" data-id="${esc(id)}">Remove ${esc(dn(s))}…</button></div></details>` : ''}</section>`;
}
function vFiles(s) {
  const id = s.id, files = s.files || [];
  const groups = ['Final report', 'Simulation', 'Data', 'Other'];
  return `<section class="sec"><h2>Reports &amp; simulations</h2><p class="sub small">${mode === 'claude' ? 'Stored with this Claude artifact (PDFs, images, video, CSV, text and code files up to 20 MB each).' : 'Stored in this browser on this device only. Include them in an export to move them.'} For zips, .slx, .mat and similar, add a link under Notes &amp; links.</p>
  ${store.canFiles && canWrite ? `<div class="row" style="max-width:640px"><select id="fkind" aria-label="File type">${groups.map(k => opt(k, k, 'Final report')).join('')}</select><input type="file" id="fup" multiple data-bind="upload" data-id="${esc(id)}" aria-label="Choose files"></div>` : '<div class="banner">Uploads aren’t available here.</div>'}
  <div id="upmsg" class="sub small" role="status"></div>
  ${groups.filter(g => files.some(f => f.kind === g)).map(g => `<h3>${g}</h3><div class="tcard scroll"><table class="stack"><thead><tr><th>File</th><th class="n">Size</th><th>Added</th><th>Stored</th><th><span class="vh">Remove</span></th></tr></thead><tbody>${files.filter(f => f.kind === g).map(f => `<tr><td data-l="File"><button class="linkbtn" data-act="openFile" data-id="${esc(id)}" data-item="${esc(f.id)}">${esc(f.name)}</button></td><td data-l="Size" class="n">${f.size ? (f.size / 1048576).toFixed(f.size > 1048576 ? 1 : 2) + ' MB' : ''}</td><td data-l="Added">${esc(fmt(f.added))}</td><td data-l="Stored">${f.storage === 'local' ? 'this browser' : 'Claude'}${f.storage !== mode && f.storage ? ' <span class="pill w">re-upload</span>' : ''}</td><td><button class="x" data-act="delFile" data-id="${esc(id)}" data-item="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button></td></tr>`).join('')}</tbody></table></div>`).join('') || '<div class="empty" style="margin-top:12px">No files yet.</div>'}</section>`;
}

/* ---------------- planner ---------------- */
function vPlanner() {
  const d = V.sel, t = today(), isT = d === t;
  const gs = S.planner.goals.filter(g => g.date === d).sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority || 'normal'] - { high: 0, normal: 1, low: 2 }[b.priority || 'normal']) || (num(a.progress) >= 100) - (num(b.progress) >= 100));
  const done = gs.filter(g => num(g.progress) >= 100).length, cov = gs.length ? C.sum(gs.map(g => (num(g.progress) || 0) / 100)) / gs.length : null;
  const nx = courses().filter(s => s.exam && s.exam.date && s.exam.date >= d).sort((a, b) => a.exam.date.localeCompare(b.exam.date))[0];
  const overdue = (S.config.deadlines || []).filter(x => !x.done && x.date && x.date < t);
  const note = (S.planner.days[d] && S.planner.days[d].note) || '';
  const hist = S.planner.goals.filter(g => g.carriedTo && C.daysBetween(g.date, t) <= 7).sort((a, b) => b.date.localeCompare(a.date));
  const ga = (g, k) => `data-bind="goal" data-item="${esc(g.id)}" data-k="${k}" data-key="g|${esc(g.id)}|${k}"`;
  return `<div class="wrap"><section class="sec">
  <div class="row between"><div><h1 class="h1">${isT ? 'Today, ' : ''}${esc(fmt(d))}</h1><p class="sub" style="margin:0">${nx ? `${C.daysBetween(d, nx.exam.date)} day${C.daysBetween(d, nx.exam.date) === 1 ? '' : 's'} before ${esc(dn(nx))} compre` : 'No compres after this day'}</p></div>
  <div class="row nowrap"><button class="ghost icon" data-act="dayMove" data-n="-1" aria-label="Previous day">←</button>${isT ? '' : `<button class="ghost sm" data-act="goDay" data-d="${t}">Today</button>`}<input type="date" value="${d}" data-bind="seldate" aria-label="Pick a date" style="width:auto"><button class="ghost icon" data-act="dayMove" data-n="1" aria-label="Next day">→</button></div></div>
  ${overdue.length ? `<div class="banner" role="status"><b>${overdue.length} overdue:</b> ${overdue.map(x => `${esc(x.title)} (${esc(fmt(x.date))}) <button class="linkbtn" data-act="dlDone" data-item="${esc(x.id)}">mark done</button>`).join(' · ')}</div>` : ''}
  <div class="statrow"><div><b>${done}<small>/${gs.length}</small></b><span>goals finished</span></div><div><b>${pctTxt(cov)}</b><span>average coverage</span></div><div><b>${gs.filter(g => g.carriedFrom).length}</b><span>carried in</span></div></div>
  <form class="card sun addgoal" data-form="addGoal"><h2 class="h3">Add a goal</h2><div class="row"><select id="ng-sub" aria-label="Subject" style="flex:0 1 160px">${subOpts(V.lastSub || '')}</select><input id="ng-text" placeholder="What to cover, e.g. Module 3: AM/FM demodulation" aria-label="Goal"><input id="ng-target" placeholder="Target, e.g. slides 20–45" aria-label="Target (optional)" style="flex:0 1 200px"><select id="ng-pri" aria-label="Priority" style="flex:0 1 120px">${opt('normal', 'Normal')}${opt('high', 'High')}${opt('low', 'Low')}</select><button type="submit">Add</button></div></form>
  <div class="goals">${gs.length ? gs.map(g => { const p = num(g.progress) || 0, s = S.subjects[g.subject]; const ex = s && s.exam && s.exam.date && s.exam.date >= d ? C.daysBetween(d, s.exam.date) : null; return `<div class="goal${p >= 100 ? ' done' : ''}"${s ? ` style="${cvar(s.id)}"` : ''}>
    <div class="gtop"><button class="pri p-${g.priority || 'normal'}" data-act="goalPri" data-item="${esc(g.id)}" aria-label="Priority ${g.priority || 'normal'}, change">${({ high: 'High', normal: 'Normal', low: 'Low' })[g.priority || 'normal']}</button><select class="gsub" ${ga(g, 'subject')} aria-label="Subject">${subOpts(g.subject || '')}</select>${ex !== null ? `<span class="pill">${esc(dn(s))} compre in ${ex}d</span>` : ''}<button class="x" data-act="delGoal" data-item="${esc(g.id)}" aria-label="Remove goal">×</button></div>
    <input class="gtext" ${ga(g, 'text')} value="${esc(g.text)}" aria-label="Goal">
    <div class="row nowrap gmeta"><input ${ga(g, 'target')} value="${esc(g.target || '')}" placeholder="Target" aria-label="Target" class="sm">${g.carriedFrom ? `<span class="carry" title="First planned ${esc(fmt(g.origin || g.carriedFrom))}">Carried${g.carryCount > 1 ? ` ${g.carryCount}×` : ''} from ${esc(fmt(g.carriedFrom))} (was ${g.carriedPct || 0}%)</span>` : ''}${g.carriedTo ? `<span class="pill mut">→ moved to ${esc(fmt(g.carriedTo))}</span>` : ''}</div>
    <div class="prog"><div class="quick" role="group" aria-label="Set progress">${[0, 25, 50, 75, 100].map(v => `<button class="qp${p === v ? ' on' : ''}" data-act="goalPct" data-item="${esc(g.id)}" data-v="${v}" aria-pressed="${p === v}">${v}%</button>`).join('')}</div><input type="range" min="0" max="100" step="5" value="${p}" ${ga(g, 'progress')} data-type="num" aria-label="Coverage"><output>${p}%</output></div></div>`; }).join('') : '<div class="empty">No goals for this day yet.</div>'}</div>
  <p class="sub small">Anything below 100% at the end of a day moves to the next day you open Compre Desk, marked as carried.</p>
  ${hist.length ? `<details class="fold sm"><summary>Carry-forward history (last 7 days)</summary><ul class="list">${hist.map(g => `<li><span>${esc(g.text)}<small>${esc(dn(S.subjects[g.subject]))} · planned ${esc(fmt(g.date))}, ${g.progress || 0}% done → moved to ${esc(fmt(g.carriedTo))}</small></span></li>`).join('')}</ul></details>` : ''}
  <h2 class="h3" style="margin-top:28px">How the day went</h2><textarea data-bind="day" data-k="${d}" data-key="d|${d}" placeholder="What slipped, what clicked, what to fix tomorrow" aria-label="Day note">${esc(note)}</textarea>
  </section></div>`;
}

/* ---------------- calendar ---------------- */
function vCal() {
  const y = V.calY, m = V.calM, first = new Date(y, m, 1), start = (first.getDay() + 6) % 7, t = today();
  const exams = courses().filter(s => s.exam && s.exam.date); let cells = '';
  for (let i = 0; i < 42; i++) {
    const dt = new Date(y, m, 1 - start + i), d = C.iso(dt); if (i >= 35 && dt.getMonth() !== m) break;
    const ex = exams.filter(s => s.exam.date === d), dl = (S.config.deadlines || []).filter(x => x.date === d), gs = S.planner.goals.filter(g => g.date === d), dn2 = gs.filter(g => num(g.progress) >= 100).length;
    cells += `<button class="cell${dt.getMonth() !== m ? ' out' : ''}${d === t ? ' today' : ''}" data-act="goDay" data-d="${d}" aria-label="${esc(fmt(d) + (ex.length ? ', ' + ex.map(s => dn(s) + ' compre').join(', ') : '') + (dl.length ? ', ' + dl.length + ' deadline(s)' : '') + (gs.length ? `, ${dn2} of ${gs.length} goals done` : ''))}"><span class="dn">${dt.getDate()}</span>${ex.map(s => `<span class="e" style="${cvar(s.id)}">${esc(dn(s))}</span>`).join('')}${dl.map(x => `<span class="d${!x.done && d < t ? ' od' : ''}">${esc(x.title)}</span>`).join('')}${gs.length ? `<span class="gl">${dn2}/${gs.length} goals</span>` : ''}</button>`;
  }
  const up = [...exams.map(s => ({ d: s.exam.date, t: dn(s) + ' compre', x: examTime(s.exam) + (s.exam.room ? ' · Room ' + s.exam.room : ''), id: s.id })), ...(S.config.deadlines || []).filter(x => x.date && !x.done).map(x => ({ d: x.date, t: x.title, x: dn(S.subjects[x.subject]), dl: 1 }))].filter(x => x.d >= t || x.dl).sort((a, b) => a.d.localeCompare(b.d));
  return `<div class="wrap"><section class="sec"><div class="row between" style="margin-bottom:12px"><h1 class="h1">${MO[m]} ${y}</h1><div class="row nowrap"><button class="ghost icon" data-act="calMove" data-n="-1" aria-label="Previous month">←</button><button class="ghost sm" data-act="calMove" data-n="0">This month</button><button class="ghost icon" data-act="calMove" data-n="1" aria-label="Next month">→</button></div></div>
  <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="h" aria-hidden="true">${x}</div>`).join('')}${cells}</div>
  <div class="legend"><span><span class="pill red">Sticker</span> compre</span><span><span class="pill mut">Outlined</span> deadline</span><span>Tap a day to plan it</span></div></section>
  <section class="sec"><h2>Agenda</h2>${up.length ? `<div class="tcard"><table><tbody>${up.map(x => { const du = daysTo(x.d); return `<tr><td style="width:130px"><span class="pill${x.id ? '' : du < 0 ? ' red' : ' mut'}"${x.id ? ` style="${cvar(x.id)}"` : ''}>${esc(fmt(x.d))}</span></td><td><b>${esc(x.t)}</b><small>${esc(x.x)}</small></td><td class="n">${du < 0 ? 'overdue' : du === 0 ? 'today' : 'in ' + du + 'd'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Nothing coming up.</div>'}</section></div>`;
}

/* ---------------- notes + search ---------------- */
function search(q) {
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const hit = t => String(t || '').toLowerCase().includes(q); const out = [];
  (S.notes.items || []).forEach(n => { if (hit(n.title) || hit(n.body)) out.push({ k: 'Note', t: n.title || 'Untitled', s: n.subject, act: `data-act="pickNote" data-item="${esc(n.id)}"` }); });
  subjects().forEach(s => {
    if (hit(s.notes)) out.push({ k: 'Subject notes', t: dn(s), s: s.id, href: '#s-' + s.id });
    if (hit(s.syllabus)) out.push({ k: 'Syllabus', t: dn(s), s: s.id, href: '#s-' + s.id });
    ['modules', 'slides', 'tuts', 'pyqs', 'links'].forEach(l => (s[l] || []).forEach(i => { if (hit(i.name) || hit(i.note) || hit(i.link)) out.push({ k: { modules: 'Module', slides: 'Slides', tuts: 'Tut sheet', pyqs: 'PYQ', links: 'Link' }[l], t: i.name, s: s.id, href: '#s-' + s.id }); }));
  });
  (S.config.links || []).forEach(l => { if (hit(l.label) || hit(l.url)) out.push({ k: 'Quick link', t: l.label, url: l.url }); });
  (S.config.deadlines || []).forEach(d => { if (hit(d.title) || hit(d.info)) out.push({ k: 'Deadline', t: d.title, s: d.subject, href: '#deadlines' }); });
  return out.slice(0, 40);
}
function vNotes() {
  const q = V.nq.toLowerCase(), items = (S.notes.items || []).filter(n => (!V.ns || n.subject === V.ns) && (!q || (n.title + ' ' + n.body).toLowerCase().includes(q))).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.updated || '').localeCompare(String(a.updated || '')));
  const cur = (S.notes.items || []).find(n => n.id === V.note);
  const a = k => `data-bind="note" data-item="${esc(cur.id)}" data-k="${k}" data-key="n|${esc(cur.id)}|${k}"`;
  const res = search(V.gq);
  return `<div class="wrap"><section class="sec"><div class="row between"><div><h1 class="h1">Notes</h1><p class="sub" style="margin:0">Doubts, formulas, things to revise the night before.</p></div><button data-act="newNote">New note</button></div>
  <div class="card sun" style="margin:20px 0"><label for="gq" class="lbl">Search everything</label><input id="gq" type="search" placeholder="Notes, syllabus, modules, PYQs, links, deadlines…" value="${esc(V.gq)}" data-bind="gq" data-key="gq">
  ${V.gq.trim().length >= 2 ? (res.length ? `<ul class="list results">${res.map(r => `<li><span class="pill mut">${esc(r.k)}</span> ${r.url ? linkA(r.url, r.t) : r.act ? `<a href="#notes" ${r.act}>${esc(r.t)}</a>` : `<a href="${esc(r.href)}">${esc(r.t)}</a>`}${r.s ? `<small>${esc(dn(S.subjects[r.s]))}</small>` : ''}</li>`).join('')}</ul>` : '<p class="sub small">No matches.</p>') : ''}</div>
  <div class="notes"><div><div class="row" style="margin-bottom:8px"><input type="search" placeholder="Filter notes" value="${esc(V.nq)}" data-bind="nq" data-key="nq" aria-label="Filter notes"><select data-bind="ns" aria-label="Filter by subject"><option value="">All subjects</option>${subjects().map(s => opt(s.id, dn(s), V.ns)).join('')}</select></div>
  <div class="nlist">${items.length ? items.map(n => `<button class="nitem${n.id === V.note ? ' on' : ''}" data-act="pickNote" data-item="${esc(n.id)}"><b>${n.pinned ? '★ ' : ''}${esc(n.title || 'Untitled')}</b><small>${esc(dn(S.subjects[n.subject]))} · ${esc(String(n.body || '').slice(0, 70))}</small></button>`).join('') : '<div class="empty">No notes yet.</div>'}</div></div>
  <div>${cur ? `<div class="row" style="margin-bottom:8px"><input ${a('title')} value="${esc(cur.title || '')}" placeholder="Title" aria-label="Title" class="ttl"><select ${a('subject')} aria-label="Subject" style="flex:0 1 160px">${subOpts(cur.subject || '')}</select></div>
  <textarea ${a('body')} style="min-height:50vh" placeholder="Write…" aria-label="Note">${esc(cur.body || '')}</textarea>
  <div class="row" style="margin-top:8px"><label class="row nowrap"><input type="checkbox" ${a('pinned')} ${cur.pinned ? 'checked' : ''}> Pin to top</label><span style="margin-left:auto"></span><button class="ghost" data-act="delNote" data-item="${esc(cur.id)}">Delete</button></div>` : '<div class="empty">Pick a note or start a new one.</div>'}</div></div></section></div>`;
}

/* ---------------- deadlines ---------------- */
function vDeadlines() {
  const t = today(), l = (S.config.deadlines || []).slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.date || '9999').localeCompare(b.date || '9999'));
  const a = (d, k) => `data-bind="dl" data-item="${esc(d.id)}" data-k="${k}" data-key="dl|${esc(d.id)}|${k}"`;
  const od = l.filter(d => !d.done && d.date && d.date < t).length;
  return `<div class="wrap"><section class="sec"><h1 class="h1">Deadlines</h1><p class="sub">Submissions, presentations and other dates outside the compre timetable. Leave the date empty if it’s still TBA.${od ? ` <b>${od} overdue.</b>` : ''}</p>
  ${l.length ? `<div class="tcard scroll"><table class="stack"><thead><tr><th>Done</th><th>What</th><th>Subject</th><th>Date</th><th>Details</th><th><span class="vh">Remove</span></th></tr></thead><tbody>${l.map(d => { const du = d.date ? daysTo(d.date) : null; return `<tr class="${d.done ? 'isdone' : du !== null && du < 0 ? 'overdue' : ''}"><td data-l="Done"><input type="checkbox" ${a(d, 'done')} ${d.done ? 'checked' : ''} aria-label="Done: ${esc(d.title)}"></td><td data-l="What"><input ${a(d, 'title')} value="${esc(d.title)}" aria-label="What"></td><td data-l="Subject"><select ${a(d, 'subject')} aria-label="Subject">${subOpts(d.subject || '')}</select></td><td data-l="Date"><input type="date" ${a(d, 'date')} value="${esc(d.date || '')}" aria-label="Date">${d.date && !d.done ? `<small>${du < 0 ? `<b class="neg">overdue by ${-du}d</b>` : du === 0 ? 'today' : 'in ' + du + ' days'}</small>` : d.date ? '' : '<small>TBA</small>'}</td><td data-l="Details"><input ${a(d, 'info')} value="${esc(d.info || '')}" aria-label="Details"></td><td><button class="x" data-act="delDl" data-item="${esc(d.id)}" aria-label="Remove ${esc(d.title)}">×</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No deadlines yet.</div>'}
  <form class="card sun" style="margin-top:24px" data-form="addDl"><h2 class="h3">Add a deadline</h2><div class="row"><input id="nd-title" placeholder="e.g. Lab report" aria-label="What"><select id="nd-sub" aria-label="Subject" style="flex:0 1 160px">${subOpts('')}</select><input type="date" id="nd-date" aria-label="Date" style="flex:0 1 180px"><button type="submit">Add</button></div></form></section></div>`;
}

/* ---------------- backup & data ---------------- */
function vData() {
  const sm = SC.summarize(S), w = prefs().prepWeights, ip = V.importPreview;
  return `<div class="wrap"><section class="sec"><h1 class="h1">Backup &amp; data</h1>
  <div class="grid2"><div class="card"><h2 class="h3">Where your data is</h2><p>Saved in <b>${esc(store.label)}</b>.</p>
    <p class="sub small">${mode === 'claude' ? 'This is the Claude version: data syncs between your devices when you open this artifact in Claude.' : 'This is the standalone version: data stays in this browser on this device and does not sync. Clearing site data erases it. Export a backup regularly, and import it on another device to move your data.'}</p>
    <p class="sub small">${sm.subjects} subjects · ${sm.assessments} assessments · ${sm.goals} goals · ${sm.notes} notes · ${sm.deadlines} deadlines · ${sm.files} files · schema v${esc(S.meta.schema)} · app ${VERSION}</p></div>
  <div class="card"><h2 class="h3">Export</h2><label class="row nowrap"><input type="checkbox" id="xfiles" ${sm.files ? 'checked' : ''}> Include uploaded files (bigger file)</label>
    <div class="row" style="margin-top:12px"><button data-act="exportJson">Export backup (.json)</button><button class="ghost" data-act="exportCsv">Assessments (.csv)</button></div><div id="xmsg" class="sub small" role="status"></div></div></div>
  <div class="card" style="margin-top:24px"><h2 class="h3">Import a backup</h2><p class="sub small">Accepts Compre Desk V2 backups and the Claude database backup. You’ll see what’s inside before anything is replaced, and you can undo right after.</p>
    <input type="file" accept=".json,application/json" data-bind="import" aria-label="Choose a backup file">
    ${ip ? `<div class="importbox"><p><b>${esc(ip.source)}</b>: ${Object.entries(SC.summarize(ip.state)).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>${ip.changes.length ? `<details class="fold sm"><summary>${ip.changes.length} upgrade change${ip.changes.length === 1 ? '' : 's'}</summary><ul class="list">${ip.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}<p class="sub small">This replaces everything currently saved ${mode === 'claude' ? 'in this artifact' : 'in this browser'}.</p><div class="row"><button class="ghost" data-act="importCancel">Cancel</button><button class="warn" data-act="importApply">Replace my data</button></div></div>` : ''}</div>
  <div class="grid2" style="margin-top:24px"><div class="card"><h2 class="h3">Prep weights</h2><p class="sub small">How much each category counts in estimated prep (0 ignores it).</p><div class="kv">${['modules', 'slides', 'tuts', 'pyqs'].map(k => `<div><label for="pw-${k}">${({ modules: 'Modules', slides: 'Slides', tuts: 'Tut sheets', pyqs: 'PYQs' })[k]}</label><input id="pw-${k}" type="number" min="0" max="5" step="0.5" data-bind="pw" data-k="${k}" data-type="num" value="${esc(w[k])}"></div>`).join('')}</div></div>
    <div class="card"><h2 class="h3">Quick links</h2>${(S.config.links || []).map((l, i) => `<div class="row nowrap" style="margin-bottom:8px"><input data-bind="qlink" data-i="${i}" data-k="label" value="${esc(l.label)}" aria-label="Label"><input type="url" data-bind="qlink" data-i="${i}" data-k="url" value="${esc(l.url)}" aria-label="URL"><button class="x" data-act="delQlink" data-i="${i}" aria-label="Remove link">×</button></div>`).join('')}<button class="ghost sm" data-act="addQlink">Add link</button>
    <p class="sub small">Semester label</p><input data-bind="meta" data-k="semester" value="${esc(S.meta.semester || '')}" placeholder="e.g. 2026-27 Sem 1" aria-label="Semester label"></div></div>
  ${mode === 'local' ? `<div class="card" style="margin-top:24px"><h2 class="h3">Erase this device</h2><p class="sub small">Deletes all Compre Desk data from this browser. Export first.</p><button class="ghost warn-o" data-act="wipe">Erase all data…</button></div>` : ''}
  </section></div>`;
}

/* ---------------- events ---------------- */
const setPath = (o, k, v) => { const p = k.split('.'); let x = o; p.slice(0, -1).forEach(q => { if (typeof x[q] !== 'object' || !x[q]) x[q] = {}; x = x[q]; }); x[p[p.length - 1]] = v; };
const readVal = el => (el.type === 'checkbox' ? el.checked : el.dataset.type === 'num' ? num(el.value) : el.value);
main.addEventListener('input', e => {
  const el = e.target, b = el.dataset.bind;
  if (el.type === 'range' && b === 'goal') { const o = el.parentNode.querySelector('output'); if (o) o.textContent = el.value + '%'; }
  if (el.type === 'range' && el.dataset.k === 'whatIf') { const s = S.subjects[el.dataset.id]; if (!s) return; const w = C.absoluteWhatIf(s, +el.value, s.boundScenario || 'historical'); const box = el.closest('.whatif'); box.querySelector('output').textContent = el.value; box.querySelectorAll('.wit').forEach(x => (x.textContent = w.projected)); box.querySelectorAll('.wig').forEach(x => (x.textContent = w.grade || '—')); }
  if (b === 'nq') { V.nq = el.value; clearTimeout(V.nqT); V.nqT = setTimeout(render, 250); }
  if (b === 'gq') { V.gq = el.value; clearTimeout(V.gqT); V.gqT = setTimeout(render, 250); }
  if (b === 'bulk') { V.bulk[el.dataset.id] = { text: el.value, rows: null }; }
});
main.addEventListener('change', async e => {
  const el = e.target, b = el.dataset.bind; if (!b) return; const v = readVal(el), k = el.dataset.k;
  if (b === 'sub') { const s = S.subjects[el.dataset.id]; if (!s) return;
    if (k === 'total' && v !== null && v <= 0) { toast('Course total must be above 0.'); render(); return; }
    if (k === 'credits' && v !== null && (v < 0 || v > 10)) { toast('Credits look wrong.'); render(); return; }
    if (k === 'short' && !String(v).trim()) { toast('Short name can’t be empty.'); render(); return; }
    setPath(s, k, v); touchSub(s.id); if (['syllabus', 'notes'].includes(k)) return; }
  else if (b === 'cut') { const s = S.subjects[el.dataset.id]; if (v !== null && v < 0) { toast('Cutoffs can’t be negative.'); render(); return; } s[el.dataset.set] = s[el.dataset.set] || {}; s[el.dataset.set][k] = v; touchSub(s.id); }
  else if (b === 'item') {
    const s = S.subjects[el.dataset.id], list = el.dataset.list, it = (s[list] || []).find(x => x.id === el.dataset.item); if (!it) return;
    const key = el.dataset.key;
    if (list === 'components') {
      const before = C.validateComponent(it), old = it[k]; it[k] = v;
      const after = C.validateComponent(it).filter(x => !before.some(y => y.field === x.field && y.msg === x.msg));
      const stc = C.structure(s);
      if (after.length || (k === 'max' && stc.errors.some(x => /more than the course total/.test(x)))) { V.ferr[key] = after.length ? after[0].msg : stc.errors[0]; it[k] = old; render(); return; }
      Object.keys(V.ferr).filter(x => x.startsWith(`i|${s.id}|components|${it.id}|`)).forEach(x => delete V.ferr[x]);
    } else if (el.dataset.type === 'num' && v !== null && v < 0) { toast('Negative numbers aren’t allowed here.'); render(); return; }
    else it[k] = v;
    if (list !== 'components') it[k] = v;
    touchSub(s.id);
  }
  else if (b === 'sim') { const s = S.subjects[el.dataset.id]; s.sim = s.sim || {}; s.sim[el.dataset.item] = { ...(s.sim[el.dataset.item] || {}), [k]: v }; touchSub(s.id); }
  else if (b === 'simComp') { V.simComp = V.simComp || {}; V.simComp[el.dataset.id] = el.value; }
  else if (b === 'goal') { const g = S.planner.goals.find(x => x.id === el.dataset.item); if (!g) return; g[k] = v; touch('app/planner'); }
  else if (b === 'day') { S.planner.days[k] = { ...(S.planner.days[k] || {}), note: v }; touch('app/planner'); return; }
  else if (b === 'note') { const n = S.notes.items.find(x => x.id === el.dataset.item); if (!n) return; n[k] = v; n.updated = new Date().toISOString(); touch('app/notes'); if (k === 'body') return; }
  else if (b === 'dl') { const d = S.config.deadlines.find(x => x.id === el.dataset.item); if (!d) return; d[k] = v || (k === 'date' ? null : v); touch('app/config'); }
  else if (b === 'pw') { if (v === null || v < 0) { toast('Weights must be 0 or more.'); render(); return; } prefs().prepWeights[k] = v; touch('app/config'); }
  else if (b === 'qlink') { const l = S.config.links[+el.dataset.i]; if (!l) return; if (k === 'url' && v && !safeUrl(v)) { toast('Links must start with https://'); render(); return; } l[k] = v; touch('app/config'); }
  else if (b === 'meta') { S.meta[k] = v; touch('app/meta'); }
  else if (b === 'seldate') { if (v) V.sel = v; }
  else if (b === 'ns') V.ns = v;
  else if (b === 'nq' || b === 'gq' || b === 'bulk') return;
  else if (b === 'upload') { await uploadFiles(el.dataset.id, [...el.files]); return; }
  else if (b === 'import') { await readImport(el.files[0]); return; }
  render();
});
main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.enter) { e.preventDefault(); act(e.target.dataset.enter, e.target); } });
main.addEventListener('submit', e => { const f = e.target.dataset.form; if (!f) return; e.preventDefault(); act(f, e.target); });
main.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || !main.contains(b)) return; if (b.tagName === 'A') e.preventDefault(); act(b.dataset.act, b); });
$('#subs').addEventListener('click', e => { const b = e.target.closest('[data-act="addSub"]'); if (b) act('addSub', b); });
main.addEventListener('keydown', e => { // arrow keys between tabs
  const t = e.target; if (t.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = [...t.parentNode.querySelectorAll('[role=tab]')]; const i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1); const n = tabs[(i + tabs.length) % tabs.length]; act('tab', n); setTimeout(() => { const x = main.querySelector(`[role=tab][data-t="${n.dataset.t}"]`); if (x) x.focus(); }, 0);
});

async function act(a, b) {
  const s = b.dataset && b.dataset.id ? S && S.subjects[b.dataset.id] : null;
  switch (a) {
    case 'addItem': { const inp = $('#new-' + b.dataset.list), name = inp && inp.value.trim(); if (!name || !s) { if (inp) inp.focus(); return; } s[b.dataset.list] = s[b.dataset.list] || []; const it = { id: uid('i'), name }; if (['modules', 'tuts', 'pyqs'].includes(b.dataset.list)) it.status = 0; if (b.dataset.list === 'components') Object.assign(it, { max: null, scored: null, avg: null }); s[b.dataset.list].push(it); touchSub(s.id); render(); const n = $('#new-' + b.dataset.list); if (n) n.focus(); break; }
    case 'delItem': { const list = b.dataset.list, it = (s[list] || []).find(x => x.id === b.dataset.item); withUndo(['subjects/' + s.id], `Removed ${it && it.name ? '“' + it.name + '”' : 'item'}.`, () => { s[list] = s[list].filter(x => x.id !== b.dataset.item); if (list === 'components' && s.sim) delete s.sim[b.dataset.item]; }); break; }
    case 'slideDone': { const it = s.slides.find(x => x.id === b.dataset.item); if (!it || !num(it.total)) return; it.covered = num(it.total); touchSub(s.id); render(); break; }
    case 'addTuts': { const n = Math.min(30, Math.max(0, parseInt(($('#ntuts') || {}).value) || 0)); if (!n) { toast('Enter how many sheets (1–30).'); return; } s.tuts = s.tuts || []; const have = new Set(s.tuts.map(x => x.name)); for (let i = 1; i <= n; i++) { const nm = 'Tut sheet ' + i; if (!have.has(nm)) s.tuts.push({ id: uid('i'), name: nm, status: 0 }); } touchSub(s.id); render(); break; }
    case 'syl2mod': { const lines = String(s.syllabus || '').split(/\n+/).map(l => l.replace(/^[\s\-•*·\d.)]+/, '').trim()).filter(l => l.length > 1); s.modules = s.modules || []; const have = new Set(s.modules.map(m => m.name.toLowerCase())); let n = 0; lines.forEach(l => { if (!have.has(l.toLowerCase())) { s.modules.push({ id: uid('i'), name: l.slice(0, 200), status: 0 }); have.add(l.toLowerCase()); n++; } }); if (n) touchSub(s.id); toast(n ? `${n} modules added from the syllabus.` : 'No new lines to add. Paste the syllabus first.'); render(); break; }
    case 'tab': { lsSet('cd:tab:' + b.dataset.id, b.dataset.t); render(); break; }
    case 'goDay': { V.sel = b.dataset.d; if (route() !== 'planner') location.hash = 'planner'; else render(); break; }
    case 'dayMove': { V.sel = C.addDays(V.sel, +b.dataset.n); render(); break; }
    case 'calMove': { const n = +b.dataset.n; const d = n ? new Date(V.calY, V.calM + n, 1) : new Date(); V.calY = d.getFullYear(); V.calM = d.getMonth(); render(); break; }
    case 'addGoal': { const tx = $('#ng-text').value.trim(); if (!tx) { $('#ng-text').focus(); toast('Write what you’ll cover first.'); return; } V.lastSub = $('#ng-sub').value; S.planner.goals.push({ id: uid('g'), date: V.sel, subject: V.lastSub, text: tx, target: $('#ng-target').value.trim(), priority: $('#ng-pri').value, progress: 0 }); touch('app/planner'); render(); $('#ng-text').focus(); break; }
    case 'delGoal': { const g = S.planner.goals.find(x => x.id === b.dataset.item); withUndo(['app/planner'], `Removed goal “${g ? g.text : ''}”.`, () => { S.planner.goals = S.planner.goals.filter(x => x.id !== b.dataset.item); }); break; }
    case 'goalPct': { const g = S.planner.goals.find(x => x.id === b.dataset.item); if (!g) return; g.progress = +b.dataset.v; touch('app/planner'); render(); break; }
    case 'goalPri': { const g = S.planner.goals.find(x => x.id === b.dataset.item); if (!g) return; g.priority = { normal: 'high', high: 'low', low: 'normal' }[g.priority || 'normal']; touch('app/planner'); render(); break; }
    case 'newNote': { const n = { id: uid('n'), title: '', body: '', subject: V.ns || '', pinned: false, updated: new Date().toISOString() }; S.notes.items.push(n); V.note = n.id; touch('app/notes'); render(); const t = main.querySelector('[data-k="title"]'); if (t) t.focus(); break; }
    case 'pickNote': { V.note = b.dataset.item; if (route() !== 'notes') location.hash = 'notes'; else render(); break; }
    case 'delNote': { const n = S.notes.items.find(x => x.id === b.dataset.item); withUndo(['app/notes'], `Deleted note “${(n && n.title) || 'Untitled'}”.`, () => { S.notes.items = S.notes.items.filter(x => x.id !== b.dataset.item); V.note = null; }); break; }
    case 'addDl': { const t = $('#nd-title').value.trim(); if (!t) { $('#nd-title').focus(); return; } S.config.deadlines.push({ id: uid('d'), title: t, subject: $('#nd-sub').value, date: $('#nd-date').value || null, done: false, info: '' }); touch('app/config'); render(); break; }
    case 'delDl': { const d = S.config.deadlines.find(x => x.id === b.dataset.item); withUndo(['app/config'], `Removed deadline “${d ? d.title : ''}”.`, () => { S.config.deadlines = S.config.deadlines.filter(x => x.id !== b.dataset.item); }); break; }
    case 'dlDone': { const d = S.config.deadlines.find(x => x.id === b.dataset.item); if (!d) return; withUndo(['app/config'], `Marked “${d.title}” done.`, () => { d.done = true; }); break; }
    case 'delFile': { const f = (s.files || []).find(x => x.id === b.dataset.item); withUndo(['subjects/' + s.id], `Removed ${f ? f.name : 'file'}.`, () => { s.files = s.files.filter(x => x.id !== b.dataset.item); }, () => { if (f && f.storage === mode) store.delFile(f.id); }); break; }
    case 'openFile': { const f = (s.files || []).find(x => x.id === b.dataset.item); if (!f) return; if (f.storage === 'claude' && mode === 'claude') { window.open('/_blob/' + encodeURIComponent(f.id), '_blank', 'noopener'); return; } if (f.storage === 'local' && mode === 'local') { const blob = await store.fileBlob(f); if (!blob) { toast('That file isn’t in this browser any more.'); return; } const u = URL.createObjectURL(blob); const w = window.open(u, '_blank', 'noopener'); if (!w) { const a2 = document.createElement('a'); a2.href = u; a2.download = f.name; a2.click(); } setTimeout(() => URL.revokeObjectURL(u), 60000); return; } toast('This file was stored in the other version of Compre Desk. Re-upload it here.'); break; }
    case 'delSub': { const ok = await confirmDlg({ title: `Remove ${dn(s)}?`, body: 'Its marks, trackers and notes are removed. Planner goals and deadlines that mention it stay. You can undo right after.', ok: 'Remove', danger: true }); if (!ok) return; withUndo(['subjects/' + s.id], `Removed ${dn(s)}.`, () => { delete S.subjects[s.id]; }); location.hash = 'home'; break; }
    case 'addSub': { const id = 'c' + uid().slice(0, 6); S.subjects[id] = SC.newSubject(id); touchSub(id); location.hash = 's-' + id; lsSet('cd:tab:' + id, 'perf'); break; }
    case 'prio': { const ov = S.config.priorityOverrides; if (b.dataset.v) ov[b.dataset.id] = b.dataset.v; else delete ov[b.dataset.id]; touch('app/config'); render(); break; }
    case 'pref': { prefs()[b.dataset.k] = b.dataset.v; touch('app/config'); render(); break; }
    case 'dismissFlash': V.flash.splice(+b.dataset.i, 1); render(); break;
    case 'crow': { V.openRow = V.openRow === b.dataset.id ? null : b.dataset.id; render(); break; }
    case 'simPreset': { const c = s.components.find(x => x.id === b.dataset.item), sim = (s.sim = s.sim || {}), cur = sim[c.id] || {}; const A = num(cur.avg), lim = C.entryLimit(c); if (A === null) return; const my = r1(Math.max(0, Math.min(lim ?? Infinity, A + (+b.dataset.v) * (lim ?? 0)))); sim[c.id] = { ...cur, my }; touchSub(s.id); render(); break; }
    case 'simReset': { withUndo(['subjects/' + s.id], 'Scenario cleared.', () => { s.sim = {}; }); break; }
    case 'quickAdd': quickAdd(b.dataset.id); break;
    case 'bulkPreview': { const bk = V.bulk[s.id] || { text: '' }; bk.rows = parseBulk(s, bk.text); V.bulk[s.id] = bk; render(); break; }
    case 'bulkAdd': { const bk = V.bulk[s.id]; if (!bk || !bk.rows) return; const ok = bk.rows.filter(r => !r.err); ok.forEach(r => placeAssessment(s, r.c)); touchSub(s.id); V.bulk[s.id] = { text: '', rows: null }; toast(`Added ${ok.length} assessment${ok.length === 1 ? '' : 's'}.`); render(); break; }
    case 'exportJson': await doExport(); break;
    case 'exportCsv': await save(`compre-desk-assessments-${today()}.csv`, SC.assessmentsCsv(S, dn), 'text/csv'); break;
    case 'importCancel': V.importPreview = null; render(); break;
    case 'importApply': await applyImport(); break;
    case 'startEmpty': { S = SC.emptyState(); Object.keys(SC.toDocs(S)).forEach(p => saver.mark(p)); location.hash = 'home'; render(); break; }
    case 'addQlink': S.config.links.push({ label: 'New link', url: 'https://' }); touch('app/config'); render(); break;
    case 'delQlink': withUndo(['app/config'], 'Link removed.', () => { S.config.links.splice(+b.dataset.i, 1); }); break;
    case 'wipe': { const ok = await confirmDlg({ title: 'Erase everything on this device?', body: 'All subjects, marks, goals, notes and files saved in this browser are deleted. This can’t be undone. Export a backup first.', ok: 'Erase', danger: true }); if (!ok) return; await saver.flush(); for (const p of Object.keys(SC.toDocs(S))) await store.del(p); for (const sub of Object.values(S.subjects)) for (const f of sub.files || []) await store.delFile(f.id); S = null; render(); toast('All data erased from this browser.'); break; }
  }
}
const normName = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Put a new assessment into an existing empty row with the same name (e.g. the imported blank "Mid-sem"), else insert before Compre. */
function placeAssessment(s, c) {
  const ex = s.components.find(x => normName(x.name) === normName(c.name) && num(x.scored) === null);
  if (ex) { ['max', 'rawMax', 'scored', 'avg'].forEach(k => { if (c[k] !== null && c[k] !== undefined) ex[k] = c[k]; }); if (!ex.name) ex.name = c.name; return ex; }
  s.components.splice(compreIndex(s), 0, c); return c;
}
const compreIndex = s => { const i = s.components.findIndex(c => c.isCompre); return i < 0 ? s.components.length : i; };
function parseBulk(s, text) {
  return String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean).map(line => {
    const p = line.split(/\t|,/).map(x => x.trim());
    const c = { id: uid('a'), name: p[0], max: num(p[1]), scored: p[2] === undefined || p[2] === '' ? null : num(p[2]), avg: p[3] === undefined || p[3] === '' ? null : num(p[3]), rawMax: p[4] === undefined || p[4] === '' ? null : num(p[4]) };
    let err = !c.name ? 'needs a name' : c.max === null ? 'needs course points' : (p[2] && c.scored === null) || (p[3] && c.avg === null) || (p[4] && c.rawMax === null) ? 'not a number' : (C.validateComponent(c)[0] || {}).msg;
    if (!err) { const same = s.components.find(x => normName(x.name) === normName(c.name) && num(x.scored) === null); const t = C.structure({ ...s, components: [...s.components.filter(x => x !== same), c] }); if (t.errors.length) err = 'would exceed the course total'; }
    return { line, c, err };
  });
}
function quickAdd(preId) {
  const cs = courses(); if (!cs.length) { toast('Add a subject first.'); return; }
  const sel = preId || V.qaSub || cs[0].id;
  dialog(`<h2 id="dlg-t">Quick add assessment</h2><form class="qa" novalidate>
  <div class="kv"><div><label for="qa-s">Subject</label><select id="qa-s">${cs.map(s => opt(s.id, dn(s), sel)).join('')}</select></div><div><label for="qa-n">Assessment</label><input id="qa-n" placeholder="e.g. Quiz 2" required></div>
  <div><label for="qa-m">Course points</label><input id="qa-m" type="number" step="any" min="0" inputmode="decimal" placeholder="worth, out of course total"></div><div><label for="qa-r">Marked out of <small>(optional)</small></label><input id="qa-r" type="number" step="any" min="0" inputmode="decimal" placeholder="same as course pts"></div>
  <div><label for="qa-y">Your score</label><input id="qa-y" type="number" step="any" min="0" inputmode="decimal"></div><div><label for="qa-a">Class average <small>(add later if unknown)</small></label><input id="qa-a" type="number" step="any" min="0" inputmode="decimal"></div></div>
  <p class="ferr" id="qa-e" role="alert"></p><div class="row end"><button type="button" class="ghost" data-close>Cancel</button><button type="submit">Add assessment</button></div></form>`, (d, close) => {
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault(); const g = id => d.querySelector(id).value;
      const s = S.subjects[g('#qa-s')]; V.qaSub = s.id;
      const c = { id: uid('a'), name: g('#qa-n').trim(), max: num(g('#qa-m')), rawMax: num(g('#qa-r')), scored: num(g('#qa-y')), avg: num(g('#qa-a')) };
      const same = s.components.find(x => normName(x.name) === normName(c.name) && num(x.scored) === null);
      if (same && c.max === null) c.max = num(same.max);
      const err = !c.name ? 'Give it a name.' : c.max === null ? 'Enter the course points it is worth (0 for bonus).' : (C.validateComponent(c)[0] || {}).msg || (C.structure({ ...s, components: [...s.components.filter(x => x !== same), c] }).errors[0]);
      if (err) { d.querySelector('#qa-e').textContent = err; return; }
      placeAssessment(s, c); touchSub(s.id); close(); toast(`Added ${c.name} to ${dn(s)}${c.scored !== null && c.avg !== null ? `: ${fmtAv(C.toPts(c, c.scored) - C.toPts(c, c.avg))}` : ''}.`); render();
    });
  });
}

/* ---------------- files ---------------- */
const CODE_EXT = ['py', 'm', 'c', 'cpp', 'h', 'v', 'sv', 'vhd', 'vhdl', 'sp', 'cir', 'net', 'txt', 'tcl', 'sh', 'r', 'jl', 'log', 'asc'];
async function uploadFiles(id, files) {
  const s = S.subjects[id], kind = ($('#fkind') || {}).value || 'Other'; if (!s || !files.length) return;
  const bad = []; let ok = 0; s.files = s.files || []; const msg = t => { const m = $('#upmsg'); if (m) m.textContent = t; };
  for (const f of files) {
    msg('Uploading ' + f.name + '…');
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    try {
      if (mode === 'claude') { let blob = f; if (CODE_EXT.includes(ext)) blob = new Blob([await f.arrayBuffer()], { type: 'text/plain' }); const r = await store.putFile(null, blob); s.files.push({ id: r.id, name: f.name, kind, size: r.sizeBytes || f.size, mime: f.type, added: today(), storage: 'claude' }); }
      else { if (f.size > 50 * 1048576) throw new Error('too big'); const fid = uid('f'); await store.putFile(fid, f, { name: f.name, mime: f.type, size: f.size }); s.files.push({ id: fid, name: f.name, kind, size: f.size, mime: f.type, added: today(), storage: 'local' }); }
      ok++;
    } catch (e) { bad.push(f.name); }
  }
  if (ok) touchSub(id); render();
  msg((ok ? ok + ' uploaded. ' : '') + (bad.length ? `Couldn’t store ${bad.join(', ')} (unsupported type, too big or storage full). Add a link instead.` : ''));
}

/* ---------------- export / import ---------------- */
const b64 = async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s, type) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'application/octet-stream' }); };
async function save(filename, text, type = 'application/json') {
  if (mode === 'claude') {
    if (downloads) { try { await downloads.save({ filename, data: text }); return true; } catch (e) { /* declined or failed: fall back */ } }
    dialog(`<h2 id="dlg-t">Copy your export</h2><p class="sub">Downloads aren’t available here. Copy this and save it as <b>${esc(filename)}</b>.</p><textarea readonly style="min-height:240px" id="xcopy"></textarea><div class="row end"><button class="ghost" data-close>Close</button><button data-copy>Copy</button></div>`, d => { d.querySelector('#xcopy').value = text; d.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { d.querySelector('#xcopy').select(); toast('Select all and copy.'); } }; });
    return false;
  }
  const u = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); return true;
}
async function doExport() {
  await saver.flush();
  const inc = ($('#xfiles') || {}).checked; const files = []; const missing = [];
  if (inc) for (const s of Object.values(S.subjects)) for (const f of s.files || []) {
    const blob = f.storage === mode ? await store.fileBlob(f) : null;
    if (blob) files.push({ id: f.id, name: f.name, mime: f.mime || blob.type, base64: await b64(blob) }); else missing.push(f.name);
  }
  const ok = await save(`compre-desk-backup-${today()}.json`, JSON.stringify(SC.makeBackup(S, files), null, 1));
  const m = $('#xmsg'); if (m) m.textContent = (ok ? 'Backup saved.' : '') + (missing.length ? ` Not included (couldn’t read): ${missing.join(', ')}.` : '') + (saver.pending ? ' Some edits were still saving; export again in a moment to be safe.' : '');
}
async function readImport(file) {
  if (!file) return;
  try { const text = await file.text(); V.importPreview = SC.parseBackup(text); if (!S) { await applyImport(); return; } location.hash = 'data'; render(); }
  catch (e) { toast(e.message || 'Couldn’t read that file.'); }
}
async function applyImport() {
  const ip = V.importPreview; if (!ip) return;
  const prev = S ? clone(S) : null; const prevPaths = S ? Object.keys(SC.toDocs(S)) : [];
  const next = clone(ip.state);
  // files: store blobs in this version's storage and re-point references
  const byId = Object.fromEntries((ip.files || []).map(f => [f.id, f])); let reup = 0, lost = 0;
  for (const s of Object.values(next.subjects)) for (const f of s.files || []) {
    const src = byId[f.id];
    if (!src) { if (f.storage !== mode) lost++; continue; }
    try { const blob = unb64(src.base64, src.mime); if (mode === 'claude') { const r = await store.putFile(null, blob); f.id = r.id; } else { const nid = uid('f'); await store.putFile(nid, blob, { name: f.name, mime: src.mime, size: blob.size }); f.id = nid; } f.storage = mode; reup++; } catch { lost++; }
  }
  S = next; V.importPreview = null;
  const nextPaths = Object.keys(SC.toDocs(S));
  prevPaths.filter(p => !nextPaths.includes(p)).forEach(p => saver.mark(p)); // deletes
  nextPaths.forEach(p => saver.mark(p));
  const t = today(); const cf = C.carryForward(S.planner.goals, t, () => uid('g')); if (cf.moved) { S.planner.goals = cf.goals; saver.mark('app/planner'); }
  location.hash = 'home'; render();
  toast(`Imported ${Object.keys(S.subjects).length} subjects${reup ? `, ${reup} files` : ''}.${lost ? ` ${lost} file(s) need re-uploading.` : ''}`, prev ? () => { const cur = Object.keys(SC.toDocs(S)); S = prev; cur.filter(p => !prevPaths.includes(p)).forEach(p => saver.mark(p)); prevPaths.forEach(p => saver.mark(p)); render(); } : null);
}

/* ---------------- boot ---------------- */
function applyRemote(path, data) {
  if (!S || saver.gen.has(path) || saver.inflight.has(path)) return;
  if (data && data.schema === undefined && path === 'app/meta') return;
  if (path.startsWith('subjects/') && data) { const m = SC.migrate({ meta: clone(S.meta), subjects: { [data.id || path.slice(9)]: data } }).state.subjects; data = Object.values(m)[0]; }
  setDoc(path, data); requestRender();
}
async function boot() {
  main.innerHTML = '<div class="loading" role="status">Loading your prep data…</div>';
  const CL = window.claude;
  let dbNS = null;
  if (CL && typeof CL.use === 'function') { try { dbNS = await CL.use('db'); } catch { dbNS = null; } }
  if (dbNS) {
    const user = await CL.use('user').catch(() => null);
    if (user) { try { const w = await user.can('data.write'); if (w === false) canWrite = false; } catch {} }
    const assets = await CL.use('assets').catch(() => null);
    CL.use('downloads').then(d => { downloads = d; }).catch(() => {});
    store = new ClaudeStore(dbNS, assets, canWrite); mode = 'claude';
  } else { store = await new LocalStore().open(); mode = 'local'; }
  document.documentElement.dataset.mode = mode;
  saver = new Saver(store, p => (S ? getDoc(p) : undefined), onSaveStatus);
  let docs;
  try { docs = await store.loadAll(); }
  catch (e) { main.innerHTML = `<div class="wrap"><div class="banner" role="alert">Couldn’t open your saved data (${esc(e.message || e)}). Nothing was changed. <button data-act="reload" onclick="location.reload()">Try again</button></div></div>`; return; }
  const storedAt = {}; const raw = {};
  Object.entries(docs).forEach(([p, v]) => { raw[p] = v.data; storedAt[p] = (v.data && v.data._at) || v.savedAt || 0; });
  const rec = saver.recoverable(storedAt);
  rec.forEach(j => { if (j.del) delete raw[j.path]; else raw[j.path] = j.data; });
  if (!Object.keys(raw).length) {
    if (mode === 'claude') { S = SC.emptyState(); }
    else { S = null; render(); onSaveStatus({ state: 'saved' }); return; }
  } else {
    const st = SC.fromDocs(raw); const wasSchema = st.meta.schema;
    const { state, changes } = SC.migrate(st); S = state;
    if (wasSchema < SC.SCHEMA) {
      if (mode === 'claude' && canWrite) { try { const b = await dbNS.doc('app/backup-pre-v2').get(); if (!b.exists) await dbNS.doc('app/backup-pre-v2').set({ at: new Date().toISOString(), note: 'Copy of every document before the V2 upgrade', docs: JSON.parse(JSON.stringify(raw)) }); } catch (e) { console.warn('pre-upgrade copy failed', e); } }
      Object.keys(SC.toDocs(S)).forEach(p => saver.mark(p));
      if (changes.length) V.flash.push(`Upgraded to Compre Desk V2 (${changes.length} changes: display names, credits, explicit Compre rows). ${mode === 'claude' ? 'A copy of your old data was kept in the database.' : ''}`);
    }
  }
  rec.forEach(j => saver.mark(j.path));
  if (rec.length) V.flash.push(`Recovered ${rec.length} unsaved edit${rec.length === 1 ? '' : 's'} from your last session.`);
  const cf = C.carryForward(S.planner.goals, today(), () => uid('g'));
  if (cf.moved) { S.planner.goals = cf.goals; saver.mark('app/planner'); V.flash.push(`${cf.moved} unfinished goal${cf.moved === 1 ? '' : 's'} carried forward to today.`); }
  saver.status(); render();
  if (mode === 'claude' && store.subscribe) unsub = store.subscribe(applyRemote);
  if (mode === 'local' && 'BroadcastChannel' in window) { // keep several open tabs in step
    const bc = new BroadcastChannel('compre-desk');
    saver.onSaved = p => bc.postMessage({ path: p, del: getDoc(p) === undefined });
    bc.onmessage = async e => { const p = e.data && e.data.path; if (!p || !S || saver.gen.has(p) || saver.inflight.has(p)) return; applyRemote(p, e.data.del ? undefined : await store.get(p)); };
  }
  setInterval(() => { const t = today(); if (t !== V.lastDay) { V.lastDay = t; const r = C.carryForward(S.planner.goals, t, () => uid('g')); if (r.moved) { S.planner.goals = r.goals; saver.mark('app/planner'); } requestRender(); } }, 60000);
  if (mode === 'local' && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('hashchange', () => { V.flash = []; render(); window.scrollTo(0, 0); });
$('#savebar') && $('#savebar').querySelector('button').addEventListener('click', () => saver && saver.retry());
document.addEventListener('change', e => { if (e.target.dataset.bind === 'import' && !main.contains(e.target)) readImport(e.target.files[0]); });
boot();
