"""Browser tests for the Day / Night toggle.
Run:  python3 -m http.server 8765 &  then  python3 tests/e2e_theme.py [path/to/backup.json]
Same setup as tests/e2e.py (CD_URL, CHROME). The backup is optional; without it the data checks use a fresh subject."""
import os, sys, json, pathlib
from playwright.sync_api import sync_playwright

BASE = os.environ.get('CD_URL', 'http://127.0.0.1:8765/index.html')
BACKUP = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('CD_BACKUP')
CHROME = os.environ.get('CHROME')
KEY = 'compre-desk:theme'
CREAM, INDIGO = 'rgb(255, 246, 223)', 'rgb(28, 23, 64)'
results = []
def check(name, cond):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name)

def bg(page): return page.evaluate("getComputedStyle(document.body).backgroundColor")
def attr(page): return page.evaluate("document.documentElement.getAttribute('data-theme')")
def stored(page): return page.evaluate(f"localStorage.getItem('{KEY}')")
def label(page): return page.get_attribute('.themetog', 'aria-label')

with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}), args=['--no-sandbox'])
    errors = []
    def newpage(ctx):
        pg = ctx.new_page(); pg.route('**/fonts.g*/**', lambda r: r.abort()); pg.on('pageerror', lambda e: errors.append(str(e))); return pg

    # 1. first visit follows the device
    for scheme, want, lab in [('dark', INDIGO, 'Switch to day mode'), ('light', CREAM, 'Switch to night mode')]:
        ctx = b.new_context(color_scheme=scheme); pg = newpage(ctx); pg.goto(BASE); pg.wait_for_selector('#main .wrap, #main section, .topgrid')
        check(f'first visit, device {scheme}: follows device', bg(pg) == want and attr(pg) is None and stored(pg) is None)
        check(f'first visit, device {scheme}: label "{lab}" + tooltip', label(pg) == lab and pg.get_attribute('.themetog', 'data-tip') == lab)
        ctx.close()

    # 2. manual choice persists through reload, reopen, routes and system changes
    ctx = b.new_context(color_scheme='dark', viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    pg = newpage(ctx); pg.goto(BASE); pg.wait_for_selector('#main')
    if BACKUP:
        pg.set_input_files('#imp0', BACKUP); pg.wait_for_selector('.topgrid')
    else:
        pg.click('button[data-act=startEmpty]'); pg.wait_for_timeout(300)
    pg.wait_for_function("document.querySelector('#status').dataset.state==='saved'")
    chips_before = pg.locator('#subs .chip').count()
    pg.click('.themetog')
    check('click switches to Day instantly', bg(pg) == CREAM or pg.wait_for_function(f"getComputedStyle(document.body).backgroundColor==='{CREAM}'") is not None)
    check('choice saved in localStorage', stored(pg) == 'light' and attr(pg) == 'light')
    check('label now offers Night', label(pg) == 'Switch to night mode')
    check('browser bar colour follows the choice', set(pg.eval_on_selector_all('meta[name=theme-color]', 'm=>m.map(x=>x.content)')) == {'#fff6df'})
    pg.reload(); pg.wait_for_selector('#main')
    check('survives reload (device still dark)', bg(pg) == CREAM and attr(pg) == 'light')
    pg.close(); pg = newpage(ctx); pg.goto(BASE); pg.wait_for_selector('#main')
    check('survives closing and reopening', bg(pg) == CREAM)
    ok = True
    for r in ['planner', 'calendar', 'notes', 'deadlines', 'data', 'home']:
        pg.goto(BASE + '#' + r); pg.wait_for_timeout(120); ok = ok and attr(pg) == 'light' and bg(pg) == CREAM
    check('survives navigating between pages', ok)
    pg.emulate_media(color_scheme='light'); pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(100)
    check('ignores system theme changes after a manual choice', bg(pg) == CREAM)

    # 3. no flash: the saved theme is applied by the inline head script, before any module runs
    pg.click('.themetog'); check('switch back to Night', stored(pg) == 'dark')
    ctx_l = b.new_context(color_scheme='light'); seed = newpage(ctx_l); seed.goto(BASE); seed.evaluate(f"localStorage.setItem('{KEY}','dark')"); seed.close()
    nf = newpage(ctx_l); nf.route('**/js/*.js*', lambda r: r.abort())
    nf.goto(BASE, wait_until='commit'); nf.wait_for_selector('body')
    check('no flash: Night applied with all JS modules blocked (device light)', attr(nf) == 'dark' and bg(nf) == INDIGO)
    ctx_l.close()

    # 4. keyboard + screen reader
    pg.goto(BASE + '#home'); pg.wait_for_selector('#main'); pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.focus('a.vh')
    for _ in range(20):
        if pg.evaluate("document.activeElement.matches('.themetog')"): break
        pg.keyboard.press('Tab')
    check('reachable with Tab', pg.evaluate("document.activeElement.matches('.themetog')"))
    check('is a real <button> with an accessible name', pg.evaluate("document.activeElement.tagName") == 'BUTTON' and label(pg) == 'Switch to day mode')
    pg.wait_for_timeout(250)
    check('tooltip shows on keyboard focus', pg.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.themetog'),'::after');return s.content.includes('Switch to day mode')&&s.opacity==='1'})()"))
    pg.keyboard.press('Enter'); check('Enter toggles', stored(pg) == 'light')
    pg.keyboard.press(' '); check('Space toggles', stored(pg) == 'dark')
    check('icons are hidden from screen readers', pg.eval_on_selector_all('.themetog svg', 'e=>e.every(x=>x.getAttribute("aria-hidden")==="true")'))

    # 5. smooth transition, and none with reduced motion
    pg.click('.themetog'); check('smooth transition class applied on switch', pg.evaluate("document.documentElement.classList.contains('theme-switching')"))
    pg.wait_for_timeout(450); check('transition class removed afterwards', not pg.evaluate("document.documentElement.classList.contains('theme-switching')"))
    ctx_r = b.new_context(color_scheme='light', reduced_motion='reduce'); rm = newpage(ctx_r); rm.goto(BASE); rm.wait_for_selector('#main')
    rm.click('.themetog')
    check('reduced motion: no transition', not rm.evaluate("document.documentElement.classList.contains('theme-switching')") and rm.evaluate("getComputedStyle(document.querySelector('.themetog .ti')).transitionDuration") == '0s')
    ctx_r.close()

    # 6. two tabs stay in step
    t2 = newpage(ctx); t2.goto(BASE); t2.wait_for_selector('#main')
    before = attr(t2); pg.click('.themetog'); t2.wait_for_timeout(250)
    check('other open tab follows the switch', attr(t2) == attr(pg) and attr(t2) != before); t2.close()

    # 7. Appearance setting can go back to following the device
    pg.goto(BASE + '#data'); pg.wait_for_selector('[data-theme-set]')
    pg.click('[data-theme-set=""]')
    check('"Match device" clears the saved choice', stored(pg) is None and attr(pg) is None and bg(pg) == INDIGO)
    check('Appearance buttons show the current setting', pg.get_attribute('[data-theme-set=""]', 'aria-pressed') == 'true')
    pg.click('[data-theme-set="light"]'); check('Day from the Appearance card', stored(pg) == 'light')

    # 8. academic data untouched and never exported with the theme
    pg.goto(BASE + '#home'); pg.wait_for_selector('#main')
    check('subjects unchanged after switching themes', pg.locator('#subs .chip').count() == chips_before)
    pg.goto(BASE + '#data'); pg.wait_for_selector('text=Export backup')
    with pg.expect_download() as dl: pg.click('text=Export backup (.json)')
    text = pathlib.Path(dl.value.path()).read_text()
    check('backup export never contains the theme', KEY not in text and '"theme"' not in text)
    keys = pg.evaluate("Object.keys(localStorage)")
    check('theme uses its own storage key only: ' + ', '.join(sorted(keys)), KEY in keys and all(k == KEY or k.startswith('cd:') for k in keys))

    # 9. mobile
    m = newpage(ctx); m.set_viewport_size({'width': 390, 'height': 844}); m.goto(BASE); m.wait_for_selector('#main')
    box = m.locator('.themetog').bounding_box()
    check(f'mobile: visible top-right, {box["width"]:.0f}px tap target', m.locator('.themetog').is_visible() and box['width'] >= 44 and box['height'] >= 44 and box['x'] + box['width'] > 390 - 40 and box['y'] < 40)
    m.click('.themetog'); check('mobile: tap toggles', stored(m) == 'dark')
    sw = m.evaluate('document.documentElement.scrollWidth'); check(f'mobile: no horizontal overflow ({sw})', sw <= 392)
    m.set_viewport_size({'width': 320, 'height': 640}); box = m.locator('.themetog').bounding_box()
    check('320px: toggle still fully on screen', box['x'] + box['width'] <= 320)

    check('no page errors: ' + '; '.join(errors[:3]), not errors)
    b.close()
fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
