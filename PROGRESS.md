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

Full run on 2026-10-12: **25 passed, 2 skipped** (the opt-in `og` image
generator and the `live` deployment check, which passed separately against
https://mariaareadne1.github.io/Iris-Afterimage/). Desktop 1440×900 and Pixel 7.

One intermittent failure was seen in an earlier full run (the crop test
timed out waiting once under load). It did not reproduce in 4 isolated
repeats or the next full run; the controls tests no longer run serially, so a
single stall can't cascade.

## Known issues / limitations

- `scripts/webm-to-mp4.sh` could not be exercised on the development machine:
  the local Homebrew ffmpeg 8.1 fails to start (missing `libx265.216.dylib`).
  Chromium 156 records MP4 directly, so conversion is only needed for WebM.
- The enlarger head is intentionally dim: it reads as a silhouette rather than
  a detailed model.
- Split-grade printing, reciprocity failure and developer exhaustion are not
  modelled (see docs/photography-model.md).
- The Claude desktop browser pane throttles animation frames while hidden;
  Playwright headless Chromium runs at ~60 fps and is used for timing checks.

## Next ideas (not started)

Manual 35 mm camera → negative, contact sheets from a roll, double exposure,
a personal gallery of the photographer's own prints.
