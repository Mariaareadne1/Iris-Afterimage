# Progress — Iris: Afterimage

_Living log. Updated at every milestone so work can resume after an interruption._

## Status

| Area | State |
|---|---|
| Photographic model (negative → enlarger → paper → development) | ✅ implemented, unit-tested |
| Paper physics (adapted Iris Verlet cloth) | ✅ implemented, unit-tested |
| 3D darkroom (enlarger, easel, trays, liquids, safelights, drying line) | ✅ working |
| Quick Print flow | ✅ working end-to-end |
| Manual darkroom (focus, time, grade, crop, dodge, burn) | ✅ working |
| Export (PNG, bordered PNG, worker) | ✅ working |
| Capture (canvas recording, showcase, clean mode) | 🟡 implemented, browser test pending |
| Embed mode `?embed=1` | 🟡 implemented, test pending |
| 2D fallback without WebGL | 🟡 implemented, test pending |
| Full E2E suite (downloads, uploads, mobile, modes, embed) | ⏳ in progress |
| Aesthetic refinement pass | ⏳ pending |
| Docs (README, architecture, photography model, testing) | ⏳ pending |
| Deployment | ⏳ pending |

## Milestones (commits)

- `8cff9f7` chore: initialize project, MIT notices, 5 public-domain negatives
- `de6df20` feat: photographic printing model + 34 calibration tests
- `883b224` feat: paper physics + 9 physics tests
- `01f161f` perf: cheaper, steadier paper solver
- `d366904` feat: photographic darkroom scene + session controller
- `b6d365b` feat: interface, quick print, manual controls, export, capture
- `3d6d5c3` test: Playwright visual walkthrough

## Test outcomes (latest)

- `npm test` — 43/43 unit tests pass (model, dodge/burn, development, physics)
- `npx playwright test smoke visual` — 2/2 pass on the production build (headless Chromium, hardware WebGL, ~60 fps)

## Known issues / next

- Safelight red is over-saturated; safelight reflection in the developer and halo in the final view are too strong
- Enlarger head reads poorly in the dark (needs rim light)
- Dodge penumbra slightly hard when the tool is held still
- Remaining E2E coverage: export pixel verification, dodge/burn via exports, uploads (portrait/landscape/invalid), mobile layout, mode switching, reset reproducibility, embed, capture, WebGL fallback

## Environment notes

- The Claude desktop browser pane throttles rAF when hidden; use Playwright for timing-sensitive checks.
- Dev server: `npm run dev` (port 5233 by default, `PORT` env overrides).
