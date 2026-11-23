// Day / Night theme. Kept apart from academic data: one localStorage key, never in backups.
// The tiny inline script in index.html applies a saved choice before the first paint;
// this module wires the header toggle, keeps the label right and syncs other tabs.

export const THEME_KEY = 'compre-desk:theme';
export const THEMES = ['light', 'dark'];
export const BAR = { light: '#fff6df', dark: '#1c1740' };

const valid = t => THEMES.includes(t) ? t : null;

/** Saved manual choice, or null when the device setting should be followed. */
export function readPref(storage) {
  try { return valid(storage?.getItem(THEME_KEY)); } catch { return null; }
}

/** Save a manual choice; null goes back to following the device. Returns false if storage is unavailable. */
export function savePref(storage, theme) {
  try {
    if (valid(theme)) storage.setItem(THEME_KEY, theme); else storage.removeItem(THEME_KEY);
    return true;
  } catch { return false; }
}

/** The theme actually showing: a manual choice wins, otherwise the system theme. */
export const effective = (pref, systemDark) => valid(pref) || (systemDark ? 'dark' : 'light');
export const opposite = t => (t === 'dark' ? 'light' : 'dark');
export const labelFor = shown => (shown === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
export const nameFor = t => (t === 'dark' ? 'Night' : 'Day');

/** Wire everything up in a browser. Safe to call once; returns a small API used by the Backup page. */
export function initTheme(doc = document, win = window) {
  const root = doc.documentElement, mq = win.matchMedia?.('(prefers-color-scheme: dark)');
  const store = (() => { try { return win.localStorage; } catch { return null; } })();
  const systemDark = () => !!mq?.matches;
  let pref = readPref(store);
  const listeners = new Set();

  const paint = () => {
    if (pref) root.setAttribute('data-theme', pref); else root.removeAttribute('data-theme');
    const shown = effective(pref, systemDark());
    doc.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      const forMedia = (m.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
      m.setAttribute('content', BAR[pref || forMedia]);
    });
    doc.querySelectorAll('[data-theme-toggle]').forEach(b => {
      const l = labelFor(shown);
      b.setAttribute('aria-label', l); b.setAttribute('data-tip', l); b.removeAttribute('title');
      b.dataset.shown = shown;
    });
    doc.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.themeSet || null) === pref)));
    listeners.forEach(f => f(api.state()));
  };

  const animate = () => {
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('theme-switching');
    clearTimeout(animate.t); animate.t = setTimeout(() => root.classList.remove('theme-switching'), 360);
  };

  const set = (theme, { save = true, anim = true } = {}) => {
    pref = valid(theme);
    if (save) savePref(store, pref);
    if (anim) animate();
    paint();
  };

  const api = {
    state: () => ({ pref, shown: effective(pref, systemDark()) }),
    toggle: () => set(opposite(effective(pref, systemDark()))),
    set,
    onChange: f => { listeners.add(f); return () => listeners.delete(f); },
  };

  doc.addEventListener('click', e => {
    const b = e.target.closest?.('[data-theme-toggle]');
    if (b) { e.preventDefault(); api.toggle(); return; }
    const s = e.target.closest?.('[data-theme-set]');
    if (s) { e.preventDefault(); set(s.dataset.themeSet || null); }
  });
  // follow the device only while there is no manual choice
  mq?.addEventListener?.('change', () => { if (!pref) paint(); });
  // another tab changed the theme
  win.addEventListener('storage', e => { if (e.key === THEME_KEY || e.key === null) set(readPref(store), { save: false }); });

  paint();
  win.__cdTheme = api;
  return api;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') initTheme();
