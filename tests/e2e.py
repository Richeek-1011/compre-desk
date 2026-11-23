"""Browser acceptance tests for the standalone build.
Run:  python3 -m http.server 8765 &  then  python3 tests/e2e.py [path/to/backup.json]
Needs: pip install playwright && playwright install chromium (or set CHROME=/path/to/chrome)."""
import os, sys, json, pathlib
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('CD_URL', 'http://127.0.0.1:8765/index.html')
BACKUP = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('CD_BACKUP')
SHOTS = os.environ.get('CD_SHOTS')
CHROME = os.environ.get('CHROME')
results = []
def check(name, cond):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name)

def shot(page, name):
    if SHOTS: page.screenshot(path=f'{SHOTS}/{name}.png', full_page=True)

with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}), args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    errors = []
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/fonts.g*/**', lambda r: r.abort())
    page.goto(BASE); page.wait_for_selector('#main')
    check('works without window.claude', page.evaluate('typeof window.claude') == 'undefined')
    check('onboarding shown on empty storage', page.locator('text=Your data lives in this browser').count() == 1)
    # import the real backup
    page.set_input_files('#imp0', BACKUP); page.wait_for_selector('.topgrid')
    page.wait_for_function("document.querySelector('#status').dataset.state==='saved'")
    chips = page.eval_on_selector_all('#subs .chip', 'els=>els.map(e=>e.childNodes[1]?.textContent?.trim()).filter(Boolean)')
    check('all seven abbreviations in chips: ' + ', '.join(chips), set(['Commsys','IoT','Prof Ethics','Opti','HAI','ADVD','SOP']) <= set(chips))
    check('no old names on overview', all(x not in page.inner_text('main') for x in ['Comm Sys', 'Optim ', 'Study Project ']))
    shot(page, 'home-empty-marks')
    # enter marks via quick add: Commsys quiz +4, midsem +23
    def quick(sub, name, mx, my, avg, raw=''):
        page.click('.tcard-a button'); page.select_option('#qa-s', sub); page.fill('#qa-n', name); page.fill('#qa-m', str(mx)); page.fill('#qa-r', str(raw)); page.fill('#qa-y', str(my)); page.fill('#qa-a', str(avg)); page.click('.dlg button[type=submit]')
    quick('comm', 'Quiz 1', 20, 16, 12); quick('comm', 'Midsem', 90, 67, 44)
    quick('iot', 'Midsem', 60, 30, 34)          # below average
    quick('opt', 'Quiz', 20, 10, 10)             # exactly average
    quick('ethics', 'Quiz', 10, 0, 5)            # zero is a real mark
    quick('vlsi', 'Midsem', 75, 40, '')          # missing average
    page.wait_for_function("document.querySelector('#status').dataset.state==='saved'")
    txt = page.inner_text('.chart')
    check('Commsys cumulative Av+27', 'Av+27' in txt)
    check('IoT negative Av−4', 'Av−4' in txt)
    check('Opti exactly average Av+0', 'Av+0' in txt)
    check('Prof Ethics zero mark → Av−5', 'Av−5' in txt)
    check('ADVD missing average handled', 'Add class averages' in txt)
    # invalid mark rejected
    page.click('.tcard-a button'); page.select_option('#qa-s', 'comm'); page.fill('#qa-n', 'Bad'); page.fill('#qa-m', '10'); page.fill('#qa-y', '12'); page.click('.dlg button[type=submit]')
    check('impossible mark rejected', 'More than the maximum' in page.inner_text('#qa-e'))
    page.keyboard.press('Escape')
    shot(page, 'home')
    # subject page + simulator does not change real marks
    page.goto(BASE + '#s-comm'); page.wait_for_selector('[role=tablist] [role=tab]')
    check('subject heading uses abbreviation', page.inner_text('h1.disp').strip() == 'Commsys')
    comp_before = page.evaluate("JSON.stringify((window.__cd||{}).x||0)")
    check('simulator waits for a Compre weight (no invented rows)', page.locator('[data-bind=sim]').count() == 0)
    shot(page, 'subject')
    # course points of compre for Commsys unknown → give it 190 (300 − 110 listed)
    page.locator('tr:has(input[value="Compre"]) [data-k=max]').fill('190'); page.keyboard.press('Tab')
    page.wait_for_timeout(300)
    check('simulator row appears once Compre has a weight', page.locator('[data-bind=sim]').count() == 2)
    page.locator('[data-bind=sim][data-k=my]').first.fill('120'); page.keyboard.press('Tab')
    page.locator('[data-bind=sim][data-k=avg]').first.fill('100'); page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    check('projected Av = Av+47', 'Av+47' in page.inner_text('.simres'))
    check('real Av unchanged (Av+27) in header', 'Av+27' in page.inner_text('.hstats'))
    # over-total weight rejected
    page.locator('tr:has(input[value="Compre"]) [data-k=max]').fill('400'); page.keyboard.press('Tab'); page.wait_for_timeout(200)
    check('assessments exceeding course total rejected', 'more than the course total' in page.inner_text('main'))
    # planner, goal, reload persistence
    page.goto(BASE + '#planner'); page.wait_for_selector('#ng-text')
    page.select_option('#ng-sub', 'iot'); page.fill('#ng-text', 'IoT module 3'); page.click('form.addgoal button[type=submit]')
    page.click('.goal .qp:has-text("50%")')
    page.goto(BASE + '#notes'); page.click('text=New note'); page.fill('[data-k=title]', 'Formula sheet'); page.keyboard.press('Tab')
    page.goto(BASE + '#deadlines'); page.fill('#nd-title', 'Lab viva'); page.fill('#nd-date', '2026-11-20'); page.click('form[data-form=addDl] button')
    page.wait_for_function("document.querySelector('#status').dataset.state==='saved'")
    page.reload(); page.wait_for_selector('.topgrid, .wrap')
    page.goto(BASE + '#planner'); page.wait_for_selector('.goal')
    check('goal survives reload (with 50% progress)', page.locator('.goal input.gtext').first.input_value() == 'IoT module 3' and '50%' in page.inner_text('.goal output'))
    check('overdue deadline surfaced in planner', 'overdue' in page.inner_text('main').lower())
    page.goto(BASE + '#home'); page.wait_for_selector('.chart')
    check('marks survive reload', 'Av+27' in page.inner_text('.chart'))
    check('study priority explains IoT', 'IoT' in page.inner_text('.prio'))
    # calendar + notes still work
    page.goto(BASE + '#calendar'); page.click('[data-act=calMove][data-n="1"]'); check('calendar (Dec) shows 6 compre stickers', page.locator('.cell .e').count() == 6)
    page.goto(BASE + '#notes'); check('notes kept', 'Formula sheet' in page.inner_text('main'))
    # export → wipe → import
    page.goto(BASE + '#data'); page.wait_for_selector('text=Export backup')
    with page.expect_download() as dl: page.click('text=Export backup (.json)')
    path = dl.value.path(); data = json.loads(pathlib.Path(path).read_text())
    check('export format v2', data.get('format') == 'compre-desk/v2' and 'comm' in data['data']['subjects'])
    page.click('text=Erase all data'); page.click('.dlg button.warn'); page.wait_for_selector('text=Your data lives in this browser')
    page.set_input_files('#imp0', path); page.wait_for_selector('.chart')
    check('exported data imports back', 'Av+27' in page.inner_text('.chart'))
    # two tabs stay in step
    t2 = ctx.new_page(); t2.route('**/fonts.g*/**', lambda r: r.abort()); t2.goto(BASE + '#notes'); t2.wait_for_selector('.nlist')
    page.goto(BASE + '#notes'); page.click('text=New note'); page.fill('[data-k=title]', 'Cross-tab note'); page.keyboard.press('Tab')
    page.wait_for_function("document.querySelector('#status').dataset.state==='saved'"); t2.wait_for_timeout(600)
    check('second open tab picks up the edit', 'Cross-tab note' in t2.inner_text('.nlist')); t2.close()
    # mobile
    m = ctx.new_page(); m.set_viewport_size({'width': 390, 'height': 844}); m.route('**/fonts.g*/**', lambda r: r.abort())
    m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(BASE); m.wait_for_selector('.chart')
    sw = m.evaluate('document.documentElement.scrollWidth')
    check(f'mobile: no horizontal overflow (scrollWidth {sw})', sw <= 392)
    check('mobile bottom nav visible', m.locator('.bnav').is_visible())
    if SHOTS:
        m.screenshot(path=f'{SHOTS}/m-home.png', full_page=True)
        m.goto(BASE + '#s-iot'); m.wait_for_selector('[role=tablist]'); m.screenshot(path=f'{SHOTS}/m-subject.png', full_page=True)
        m.goto(BASE + '#planner'); m.wait_for_selector('.goal'); m.screenshot(path=f'{SHOTS}/m-planner.png', full_page=True)
        for h in ['planner', 'calendar', 'deadlines', 'data', 's-sop', 's-hai']:
            page.goto(BASE + '#' + h); page.wait_for_timeout(300); page.screenshot(path=f'{SHOTS}/{h}.png', full_page=True)
        d = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark').new_page(); d.route('**/fonts.g*/**', lambda r: r.abort())
        d.goto(BASE); d.wait_for_selector('main'); d.screenshot(path=f'{SHOTS}/dark-onboard.png')
    check('no page errors: ' + '; '.join(errors[:3]), not errors)
    b.close()
fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
