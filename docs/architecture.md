# Architecture

```
src/
├── photography/   pure model — negative, enlarger, paper, exposure field, development, layout, pipeline
├── physics/       paper.ts (Verlet sheet, adapted from Iris cloth), carry.ts (tong choreography paths)
├── session/       DarkroomSession (state machine + model state), negatives loading/import, tiny store
├── rendering/     Three.js darkroom: scene props, print material, liquids, beam, camera rig, paper director, post
├── interaction/   pointer controller (tools, framing, grabbing paper, rocking the tray)
├── capture/       export (worker PNG render), share (Web Share / clipboard), recorder (MediaRecorder), showcase
└── components/    React interface (intro, top bar, film strip, enlarger/developer/finished panels, 2D fallback)
```

## One pipeline, three consumers

The **session** owns the shared image state: the loaded `Negative`, the print
`layout`, enlarger `settings`, the `ExposureField`, the latent `finalDensity`
and onset maps, and the `DevelopState`. Everything visual is derived from it:

| Consumer | Uses | Resolution |
|---|---|---|
| Enlarger projection on the easel/paper | `projectNegative()` → half-float texture | 640 px long side |
| Developing tray | `finalDensity()` + `computeOnsetMaps()` → textures; GLSL `developedFraction` | 640 px |
| Export | `renderPrint()` with the same settings, field and dev state | 2400 px, in a worker |

Nothing in the preview, the developer animation or the export applies an
independent filter.

## Session state machine

```
intro → enlarger ──(develop)──► transfer → developing ──(stop bath)──► stop → fix → wash → finished
           ▲  paper: safe → placing → easel                                          (lights on)   │
           └──────────────────────────────── print again / new negative ◄──────────────────────────┘
```

`session.tick(dt)` advances simulated time (`?speed=` scales it for tests).
During exposure each tick adds the base time slice to the exposure field and,
if a tool is over the paper, the dodge or burn slice. All state is replaced,
never mutated, so React subscribes with `useSyncExternalStore`.

## Rendering

- `darkroom.ts` builds the scene, reacts to state (textures, views, paper
  choreography) and runs the frame loop: session → lamp/tools → physics →
  liquids → lights → camera → post.
- `printMaterial.ts` patches `MeshPhysicalMaterial`: projected light as
  emissive (masked by the same disc coverage function as the model), blank
  latent paper, and development density in the diffuse colour.
- `liquid.ts`: 2D wave equation on a ~80×65 grid, displaced transmissive surface
  (refracts the print beneath), slosh mode for rocking.
- `paperDirector.ts`: slides fresh paper onto the easel, carries it with
  tongs between trays (lay-down path), presses it flat in liquid, hangs it
  with two pegs. All motion goes through the physics grab.
- `cameraRig.ts`: per-stage subject boxes fitted into the screen area *not*
  covered by UI, using an off-axis lens shift (`setViewOffset`), so phones and
  ultrawide screens both frame correctly.
- Post: bloom (safelight, beam), animated mid-tone grain and a soft vignette.
  Quality drops automatically (pixel ratio 1, no transmission) under 32 fps.

## Paper physics (`physics/paper.ts`)

Reused from Iris (`src/cloth.ts`, itself from Holocloth by Dmitry Kurash,
MIT): flat-array Verlet integration, structural/shear/bend distance
constraints, fixed substeps, smooth grabbing with offsets. Changed for paper:
gravity at real scale, 2-/3-/4-cell bend constraints solved before structural
ones plus a strain-limiting pass, long-range attachment tethers from every
held vertex (no stretching when held by a corner), rigid tong-style grips,
seeded edge curl, collisions with bench/easel/tray floors and walls, liquid
buoyancy and drag, pins, NaN recovery. UVs are fixed to the grid, so the image
can't slide.

## Reused vs new

| From Iris / Holocloth | New for Afterimage |
|---|---|
| Verlet sheet core, constraint relaxation, grab offsets (heavily adapted) | entire photographic model |
| Sinless grain hash for the post pass | darkroom scene, liquids, beam, print material |
| Vite + React + Three.js project shape, MIT notices | session, UI, export worker, recorder, showcase, tests |

## Privacy and robustness

- Imported photographs are decoded with `createImageBitmap`, scaled to 2000 px,
  and kept in memory. No network requests are made with them (tested).
- The manifest is validated (ids/filenames sanitised, HTTPS-only sources).
- WebGL 2 missing → a 2D fallback runs the same session and model.
- Physics guards against NaN/explosions; dt is capped; export falls back from
  worker to main thread.
- Textures, workers' buffers, object URLs and GPU resources are disposed.
