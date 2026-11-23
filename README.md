# Compre Desk

A local-first academic companion for BITS students:

- **Relative standing first.** Every course shows how far above or below the class average you are (`Av+27`, `Av−4`, `Av+0`). A diverging chart compares courses fairly by normalising to the marks assessed so far.
- **Compre prep.** Countdown, compre stickers on a day strip, study-priority suggestions, estimated preparation from modules, slides, tut sheets and PYQs.
- **Daily planner.** Goals with priority and progress. Unfinished goals carry forward, and you can see where each one came from.
- **Calendar, notes with full-text search, deadlines, quick links, project files.**
- **Honest projections.** A relative what-if simulator and grade-boundary scenarios. All are labelled as assumptions, never guarantees.

It's a static site (HTML + CSS + vanilla JS modules), with no build step and no backend.

## Your data

- Everything is stored **in your browser on this device** (IndexedDB, with localStorage as a fallback). Nothing is sent anywhere.
- Browser data **does not sync between devices**. Use **Backup & data → Export backup** and import the file on the other device.
- Clearing your browser's site data deletes it. Export a backup regularly.
- Uploaded project files are stored in the browser too. Tick "Include uploaded files" when exporting to carry them in the backup.
- **Never commit backups to this repository.** `.gitignore` already excludes `*backup*.json` and `*.csv`.

### Moving from the Claude version

1. Open the site and choose **Import a backup**.
2. Pick the JSON backup exported from the Claude artifact (`compre-desk-backup-YYYY-MM-DD.json`).
3. The import upgrades it automatically: display names (Commsys, IoT, Prof Ethics, Opti, HAI, ADVD, SOP), credits, and an explicit Compre row per course. Subject IDs stay the same, so planner goals, deadlines and notes stay linked.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a new repository on GitHub, for example `compre-desk`. It must be **public** for Pages on a free plan. The repository contains code only, no personal data.
2. Push this folder:
   ```bash
   git init && git add . && git commit -m "Compre Desk V2"
   git branch -M main
   git remote add origin https://github.com/<your-username>/compre-desk.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. The workflow in `.github/workflows/pages.yml` runs the unit tests, then deploys. When the run finishes, the site is at `https://<your-username>.github.io/compre-desk/`.
5. Open that URL and import your backup. On a phone, use "Add to Home Screen" to install it like an app.

## Tests

```bash
node --test tests/*.test.mjs        # calculations, migrations, save queue (no install needed)
# browser acceptance tests:
pip install playwright && playwright install chromium
python3 -m http.server 8765 &
python3 tests/e2e.py path/to/your-backup.json
```

## How the numbers work

- **Course points.** Each assessment's "Course pts" is its share of the course total (a 90-mark midsem in a 300-mark course has 90). If it was marked out of something else, fill in "Marked out of" and type the marks as printed. They're converted once: `value × course pts ÷ marked out of`. Weights are never applied twice.
- **Av** = Σ(your score − class average) in course points, over assessments where both are known. Missing averages are left out and flagged. 0 is a valid mark.
- **Normalised %** = Av ÷ course points of those assessments × 100. It's used for comparing courses with different totals. Bonus items (worth 0) count in Av but not in the normalised figure.
- **Overall** = credit-weighted mean of each course's normalised %. It is labelled partial until a course is fully graded or marked completed.
- **Grade boundaries.** These are last offering's cutoffs, optionally shifted by (expected average − last average), which is a heuristic, or your own estimates. They're reference only, because BITS grading is relative.
- **Estimated prep** = weighted mix of the categories you track. Syllabus (modules, slides) and practice (tut sheets, PYQs) are shown separately. Weights are adjustable.

## Files

```
index.html            app shell
css/style.css         Neo Memphis theme (light + dark)
js/calc.js            all calculations (pure, unit-tested)
js/schema.js          data model, migrations, backup formats
js/store.js           IndexedDB / Claude storage + reliable save queue
js/app.js             UI
sw.js, manifest.webmanifest, assets/   offline + installable app
tests/                unit tests (node) and browser tests (playwright)
```

## Releasing an update

Bump the `?v=` version in `index.html`, the imports at the top of `js/app.js` and `js/schema.js`, and the `CACHE` name in `sw.js`, all to the same value. That way browsers never mix old and new files.
