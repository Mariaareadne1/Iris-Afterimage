# Progress — Iris: Afterimage

_Living log. Updated at every milestone so work can resume after an interruption._

**Live:** https://mariaareadne1.github.io/Iris-Afterimage/ (GitHub Pages, deployed by `.github/workflows/deploy.yml`, verified with `tests/e2e/live.spec.ts`)

## Status

| Area | State |
|---|---|
| Photographic model (negative → enlarger → paper → development) | ✅ implemented, unit-tested |
| Paper physics (adapted Iris Verlet cloth) | ✅ implemented, unit-tested |
| 3D darkroom (enlarger, easel, trays, liquids, safelights, drying line) | ✅ |
| Quick Print flow | ✅ E2E |
| Manual darkroom (focus, time, grade, crop, dodge, burn, pull early, agitation) | ✅ E2E, measured on exported PNGs |
| Import (portrait / landscape / huge / corrupt) | ✅ E2E |
| Export (PNG, bordered PNG, worker, viewer, contact sheet) | ✅ E2E |
| Capture (canvas recording MP4/WebM, clean mode, automated showcase) | ✅ E2E |
| Embed mode `?embed=1` | ✅ E2E (iframe, parent scroll) |
| 2D fallback without WebGL | ✅ E2E |
| Phone layout | ✅ E2E (Pixel 7) |
| Aesthetic refinement pass | ✅ done (see screenshots in `docs/screenshots/`) |
| Docs (README, architecture, photography model, testing) | ✅ |
| Deployment | ✅ GitHub Pages, live smoke test passed |

## Milestones (commits)

- `8cff9f7` chore: initialize project, MIT notices, 5 public-domain negatives
- `de6df20` feat: photographic printing model + calibration tests
- `883b224` feat: paper physics
- `01f161f` perf: cheaper, steadier paper solver
- `d366904` feat: photographic darkroom scene + session controller
- `b6d365b` feat: interface, quick print, manual controls, export, capture, fallback
- `3d6d5c3` test: Playwright visual walkthrough
- `b82e4f6` feat: footswitch shortcuts (E / B)
- `7e60dc6` fix: phone layout
- `de9401c` test: end-to-end validation of the printing pipeline
- `style` refine darkroom lighting · `feat` OG image · `feat` portfolio tooling · `ci` GitHub Pages
- `fix` carries between trays · `fix` print viewer · `docs` README and docs (this milestone)

## Test outcomes (latest full run)

- Typecheck: clean
- `npm test`: 43/43 unit tests pass
- Playwright (production build, Chromium 156, hardware WebGL): see the latest
  run summary below.

Full run on 2026-10-12 (after the share / video / enlarger pass):
**43/43 unit, 28 passed + 3 skipped browser tests** (skipped = opt-in `og`
image, `demo` video recording and `live` deployment check, each run
separately). Desktop 1440×900 and Pixel 7.

Earlier, one full run had a single crop-test timeout; it hasn't recurred, and
the tray-journey test was made to wait for the print to settle after a trace
showed the stop bath was too short (now 3 s).

Demo videos (not committed, `captures/` is git-ignored): 16:9 and 1:1, ~45 s,
H.264 30 fps, 31–37 MB, produced by `MAKE_DEMO=1 npx playwright test demo` +
`node scripts/prepare-video.mjs`.

## Known issues / limitations

- The local Homebrew ffmpeg 8.1 fails to start (missing `libx265.216.dylib`;
  `brew reinstall ffmpeg` should fix it). The project no longer depends on it:
  `scripts/prepare-video.mjs` falls back to the bundled `ffmpeg-static`.
- Split-grade printing, reciprocity failure and developer exhaustion are not
  modelled (see docs/photography-model.md).
- The Claude desktop browser pane throttles animation frames while hidden;
  Playwright headless Chromium runs at ~60 fps and is used for timing checks.

## Next ideas (not started)

Manual 35 mm camera → negative, contact sheets from a roll, double exposure,
a personal gallery of the photographer's own prints.
