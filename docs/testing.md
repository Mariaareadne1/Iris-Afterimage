# Testing

```bash
npm test             # unit tests (Vitest, Node) — model + physics
npm run test:e2e     # browser tests (Playwright) against the production build
npm run test:all     # typecheck + unit + build + e2e
SAVE_SCREENSHOTS=1 npx playwright test visual   # refresh docs/screenshots
MAKE_OG=1 npx playwright test og                # refresh public/og.jpg
```

E2E runs on `vite preview` (production build), in Chromium with hardware
WebGL (falls back to SwiftShader). Tests use `?speed=N` to compress time;
results don't depend on speed because the model integrates simulated seconds.

## Unit tests (43) — `tests/unit/`

Generated calibration images (`calibration.ts`): gradient, 11-step wedge,
checkerboard, flat grey.

| File | What is verified |
|---|---|
| `photography.test.ts` | negative is tonally inverted; density follows γ·log L; colour → luminance; normalisation; deterministic grain; more exposure → darker, shorter → lighter; higher grade → steeper; grades share the pivot; default exposure gives mid grey; paper white/black; unexposed paper stays white; defocus lowers sharpness of projection **and print**; blur symmetric/bounded; crop changes output; framing clamped; sheet orientation/aspect; identical inputs → identical prints, resolution-independent tone |
| `dodgeBurnDevelop.test.ts` | dodging lightens the region and leaves distant regions exactly unchanged; burning darkens likewise; effect scales with time; soft masks; bounded field; invalid input ignored; op-log replay is exact; latent image blank before development; progressive, shadows-first emergence; completes to within 0.02 D of the model; monotonic under changing agitation; agitation speeds/evens without changing the result; restart reproducibility; GLSL constants match |
| `paper.test.ts` | settles flat with slight curl; picked up by a corner it bends (far corner stays down); local drag; < 8% stretch hanging from a corner; stable after 40 random violent drags; carried into a tray it lies submerged inside the walls; pins; NaN recovery; invalid input |

## Browser tests — `tests/e2e/`

| Spec | What is verified |
|---|---|
| `smoke` | WebGL 2 boots, no page errors, frame rate |
| `journey` | open → choose negatives → expose (latent image not shown) → progressive development → stop/fix/wash → lights on → print hung on the line → **download**: valid PNG, 2400 px, correct aspect, correlates > 0.85 with the source photograph yet differs from it; bordered 8×10 export with white margins; contact sheet; print again / another negative (portrait sheet) |
| `controls` | **measured on downloaded PNGs**: 3 s vs 8 s vs 16 s exposure; reproducible repeat prints; grade 00 vs 5 contrast; defocused print sharpness; 2× crop matches the centre of the full frame; dodging (real mouse over the easel during the exposure) lightens only that region; burning (card, `B` footswitch) darkens only that region; settings lock per sheet |
| `import` | portrait and landscape uploads produce matching sheets and prints; no POST/PUT requests; huge images scaled to 2000 px; corrupt and unsupported files show friendly errors and leave the app usable |
| `modes` | Quick ⇄ manual keeps settings and stage; agitation; keyboard dodging + footswitch |
| `embed` | `?embed=1` inside an iframe: compact chrome, no gallery/capture, parent page still scrolls with the wheel over the iframe |
| `capture` | canvas recording downloads a non-empty video whose extension matches the actual MediaRecorder container; the automated showcase runs the real workflow (with dodging) to a finished print |
| `fallback` | with WebGL disabled the 2D darkroom still produces a real print |
| `share` | Share gives the native share sheet a real PNG of the print; without a share sheet it copies a clean link |
| `mobile` (Pixel 7) | full quick print by tapping; no overlapping controls; no horizontal overflow; manual drawer fits; **dodging with a finger** (real touch events) holds light back only under the finger |
| `demo` (opt-in, `MAKE_DEMO=1`) | records the showcase to `captures/` in 16:9 or 1:1 |
| `visual` | screenshots of every stage for inspection |

## Latest results

See `PROGRESS.md` for the most recent run and counts.
