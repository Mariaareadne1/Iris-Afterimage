# The photographic model

Iris: Afterimage is a creative simulation, not a sensitometry lab, but every
relationship a darkroom printer relies on is modelled explicitly and tested.
All of it lives in `src/photography/` as pure TypeScript (no DOM, no GPU), so
the same code runs in the browser, in the export worker and in Node tests.

```
photograph ──► negative ──► enlarger ──► exposure field ──► paper curve ──► latent image ──► development ──► print
 (sRGB)        density      framing,      seconds of light    H&D curve       final density    onset, τ,        reflectance
               + grain      focus blur    dodge / burn        by grade                         agitation
```

## 1. Negative (`negative.ts`)

- The photograph is decoded to **linear luminance** (sRGB transfer removed, Rec. 709 weights).
- Tones are **normalised in the log domain** (0.5% / 99.5% percentiles), the
  equivalent of a well-exposed negative. Old scans with grey blacks still
  print with a full scale.
- Film records log luminance as silver density:
  `D_neg = D_min + γ · log10(L / L_min)` with `D_min = 0.22`, `γ = 0.62`,
  `L_min = 0.008`. Bright subjects become dense; shadows stay clear.
- **Grain**: seeded Gaussian noise in density, strongest in the mid densities.
  It is fixed to the negative, so it moves with the framing and is identical
  in preview and export.
- The enlarger needs **transmittance** `T = 10^(−D_neg)`. The negative selector
  shows `T / T_base` so it reads tonally inverted, like film on a light box.

## 2. Enlarger (`enlarger.ts`)

- **Framing**: magnification 1–3× and a pan of the negative. The image area
  of the paper maps to the negative by `n = 0.5 + offset + (p − 0.5)/zoom`;
  the pan is clamped so the negative carrier's edge never shows.
- **Easel / layout** (`layout.ts`): 8×10 in paper turned to the negative's
  orientation, blades set to the negative's aspect with ≥ ½ in white border.
- **Focus**: the knob's distance from the sharp point sets a blur radius
  (fraction of the image width, growing slightly with magnification). Blur
  is applied to the **projected light** with an O(n) three-box approximation
  of a Gaussian, so it affects the exposure, not just the preview.
- Downsampling uses a box prefilter to keep grain from aliasing.

## 3. Exposure field — dodging and burning (`exposureField.ts`)

Enlarger settings lock once a sheet has seen light, so exposure separates:

```
E(x) = lamp · T_projected(x) · seconds(x)
```

`seconds(x)` is a 256-pixel map of how long each point received light:

| Action | Effect on `seconds(x)` |
|---|---|
| Base exposure, time slice `dt` | `+dt` everywhere |
| Dodging tool held in the beam | `−dt · shadow(x)` (never below 0) |
| Burning card, time slice `dt` | `+dt · aperture(x)` only |

Shadows and apertures are soft discs (a tool held between lens and paper casts
a penumbra). The 3D dodger is positioned on the ray from the lens through the
masked point, so the shadow you see is the mask that is recorded. Values stay
within `[0, 180 s]`; every operation is also logged and can be replayed
exactly.

## 4. Paper and contrast (`paper.ts`)

Print density follows a logistic characteristic curve in log exposure:

```
D = D_min + (D_max − D_min) · σ(k_g · (log10 E − log E_pivot) + logit(u_pivot))
```

- `D_min = 0.06` (paper white), `D_max = 2.05` (glossy fibre black).
- **More exposure → more density → a darker positive.** Always.
- The slope `k_g` comes from the ISO exposure range of the grade
  (`R = 1.45 − 0.18·g`, grade 00 ≈ 1.54 … grade 5 ≈ 0.55). Higher grades are
  steeper.
- Grades **pivot around a fixed mid-grey**, as variable-contrast filters 00–3½
  are designed to: changing contrast doesn't also wildly change brightness.
- **Software test strip**: `suggestExposureTime` finds the time that puts the
  negative's key tone (log-mean of the central 80% of transmittances) on mid
  grey — what a printer reads off a real test strip. Quick Print uses it.
- Display: reflectance relative to paper white, `10^−(D − D_min)`, then the
  sRGB transfer. Exports add a deterministic triangular dither.

## 5. Latent image and development (`development.ts`)

After exposure the paper holds a **latent image**: the final density `D∞(x)`
exists in the model but nothing is shown on the sheet. In the developer:

```
D(t) = D_min + (D∞ − D_min) · (1 − e^(−(t − onset)/τ))      for t > onset
onset(x) = wetting(x) + induction(D∞) − edge_lead(x) + uneven(x)·(1 − evenness)
```

- **Induction**: 4.5 s for the deepest shadows up to 13.5 s for the lightest
  highlights, which is why a print comes up shadows first.
- **Wetting**: the sheet slides in from one edge, which reaches developer about 2.6 s
  before the far side.
- **Edges** develop fractionally earlier (fresh developer).
- **Unevenness**: a still tray develops a little unevenly. **Agitation**
  (rocking the tray, nudging the print) raises `evenness`, which only ever
  increases, and briefly speeds the clock (fresh developer at the surface).
  Density is therefore monotonic in time: agitation cannot destroy the image.
- τ = 7 s; development is complete at 60 developer-seconds (shown at 3.2×
  real time so the wait stays short).
- **Pulling early** (manual mode) freezes the state: the print stays lighter
  and flatter, exactly as computed.

The shader that animates the tray uses a GLSL twin of `developedFraction`
generated from the same constants. The CPU computes the per-pixel onset maps
once, so the GPU only evaluates one exponential per pixel per frame.

## 6. Stop, fix, wash

Simplified but coherent: the stop bath freezes development; the fixer makes the
print light-safe, so the room lights come on (the print's true neutral tones are
seen for the first time); a short wash; then the print is lifted and pegged on
the drying line.

## 7. Export

The finished print is a recipe: negative, enlarger settings, exposure field
and development state. `capture/printRender.ts` re-renders it at 2400 px
(in a worker) through the same functions, optionally on the full sheet with
white borders. The PNG is the photograph — never a screenshot.

## Simplifications (honest list)

- One logistic curve per grade; real VC paper has two emulsions and grade-
  dependent speed. Split-grade printing is not modelled (the grade is fixed per
  sheet).
- Negative density is a straight line above a sharp toe; no shoulder, no
  reciprocity failure, no flare.
- Focus blur is Gaussian (a real lens gives a disc/bokeh-shaped blur).
- Dodging wands' wires and the burning card's own penumbra are folded into
  one feathered disc.
- Development is first-order kinetics with an induction delay; no
  developer exhaustion, temperature or fog growth.
- Stop, fix and wash have no chemistry beyond ending development.
