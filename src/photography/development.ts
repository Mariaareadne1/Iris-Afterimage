import { createGray, type GrayImage } from './image.ts';
import { fbm } from './noise.ts';
import { PAPER } from './paper.ts';

/**
 * Development: turning the invisible latent image into silver.
 *
 * Each point has a final density D∞ (set by its exposure and the paper
 * curve). In the developer, density grows after an induction period:
 *     D(t) = Dmin + (D∞ − Dmin) · (1 − e^(−(t − onset)/τ))   for t > onset
 * where the onset is the sum of
 *   - wetting: the sheet slides in from one edge, so the far edge is wetted
 *     a moment later,
 *   - induction: heavily exposed areas (shadows) start first, highlights
 *     last — this is why a print "comes up" shadows-first,
 *   - unevenness: a still tray develops a little unevenly; agitation brings
 *     fresh developer and washes this out (it can only ever *reduce*).
 * Everything is a pure function of the clock, so the developing view, a
 * pulled-early print and the exported file always agree.
 */
export const DEVELOPER = {
  /** induction time for the deepest shadows (developer seconds) */
  inductionShadow: 4.5,
  /** extra induction time for the lightest highlights */
  inductionSpread: 9,
  /** density growth time constant */
  tau: 7,
  /** time for the developer to sweep across the sheet */
  wetSpread: 2.6,
  /** maximum extra onset in a still, unagitated tray */
  unevenAmp: 4,
  /** fresh developer at the edges starts slightly earlier */
  edgeLead: 1.2,
  /** developer seconds after which development is considered complete */
  completeAt: 60,
  /** a print pulled before this point is visibly underdeveloped */
  recommendedMin: 45,
  /** simulated developer seconds per real second (keeps the wait short) */
  speed: 3.2,
  /** evenness gained per second without agitation (slow diffusion) */
  passiveEvenRate: 0.004,
  /** clock speed-up from agitation (fresh developer at the surface) */
  agitationBoost: 0.45,
} as const;

/** Development state — small, serialisable, and the only thing that changes over time. */
export interface DevelopState {
  /** developer clock in developer seconds since immersion */
  clock: number;
  /** 0 = still tray, 1 = perfectly even (only ever increases) */
  evenness: number;
  /** current agitation level 0..1 (decays) */
  agitation: number;
  /** angle the sheet entered the tray from (radians in UV space) */
  entryAngle: number;
  /** noise seed for this sheet */
  seed: number;
}

export function initialDevelopState(seed = 7, entryAngle = Math.PI / 2): DevelopState {
  return { clock: 0, evenness: 0, agitation: 0, entryAngle, seed };
}

/**
 * Advance development by a real-time step. `agitate` is the agitation applied
 * during this step (0..1, e.g. from rocking the tray). Returns a new state.
 */
export function advanceDevelopment(state: DevelopState, realDt: number, agitate = 0): DevelopState {
  const dt = Math.min(Math.max(realDt, 0), 0.25);
  const a = Math.min(Math.max(agitate, 0), 1);
  const agitation = Math.min(1, Math.max(a, state.agitation * Math.exp(-dt * 1.6)));
  const rate = DEVELOPER.speed * (1 + DEVELOPER.agitationBoost * agitation);
  const evenness = Math.min(1, state.evenness + dt * (DEVELOPER.passiveEvenRate + 0.55 * agitation));
  return { ...state, clock: state.clock + dt * rate, agitation, evenness };
}

/** Per-point onset components, independent of the clock. */
export interface OnsetMaps {
  /** wetting + induction + edge lead (developer seconds) */
  base: GrayImage;
  /** maximum additional onset from still-tray unevenness */
  uneven: GrayImage;
}

/** Normalised final density 0..1 → induction time. Shadows start first. */
export function inductionTime(normalizedDensity: number): number {
  const u = Math.min(Math.max(normalizedDensity, 0), 1);
  return DEVELOPER.inductionShadow + DEVELOPER.inductionSpread * Math.pow(1 - u, 1.5);
}

export function normalizedDensity(d: number): number {
  return (d - PAPER.dMin) / (PAPER.dMax - PAPER.dMin);
}

/** Wetting delay at image UV for a sheet entering along `angle`. */
export function wetDelay(u: number, v: number, angle: number, seed: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // 0 at the entry edge → 1 at the far edge (for a unit square)
  const along = ((u - 0.5) * dx + (v - 0.5) * dy) / (Math.abs(dx) * 0.5 + Math.abs(dy) * 0.5) * 0.5 + 0.5;
  const wobble = (fbm(u, v, 3, seed + 31, 2) - 0.5) * 0.35;
  return DEVELOPER.wetSpread * Math.min(Math.max(along + wobble, 0), 1.2);
}

export function edgeLead(u: number, v: number): number {
  const e = Math.min(u, 1 - u, v, 1 - v);
  return DEVELOPER.edgeLead * Math.max(0, 1 - e / 0.06);
}

export function unevenAt(u: number, v: number, seed: number): number {
  const n = fbm(u, v, 2.5, seed, 3);
  return DEVELOPER.unevenAmp * Math.min(1, Math.max(0, (n - 0.3) / 0.55));
}

/** Build onset maps for a final-density image. */
export function computeOnsetMaps(finalDensity: GrayImage, state: Pick<DevelopState, 'entryAngle' | 'seed'>): OnsetMaps {
  const { width: w, height: h } = finalDensity;
  const base = createGray(w, h);
  const uneven = createGray(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const i = y * w + x;
      const ind = inductionTime(normalizedDensity(finalDensity.data[i]));
      base.data[i] = Math.max(0, wetDelay(u, v, state.entryAngle, state.seed) + ind - edgeLead(u, v));
      uneven.data[i] = unevenAt(u, v, state.seed);
    }
  }
  return { base, uneven };
}

/** Developed fraction for a point — shared by CPU and the GPU shader (see glsl below). */
export function developedFraction(clock: number, onsetBase: number, uneven: number, evenness: number): number {
  const onset = onsetBase + uneven * (1 - evenness);
  const p = Math.max(0, clock - onset);
  return 1 - Math.exp(-p / DEVELOPER.tau);
}

/** Density visible at a moment of development. */
export function densityAt(finalDensity: number, fraction: number): number {
  return PAPER.dMin + (finalDensity - PAPER.dMin) * fraction;
}

/** The developed image for a development state (e.g. when the print is pulled). */
export function developImage(finalDensity: GrayImage, onset: OnsetMaps, state: DevelopState): GrayImage {
  const out = createGray(finalDensity.width, finalDensity.height);
  const f = finalDensity.data;
  for (let i = 0; i < f.length; i++) {
    const frac = developedFraction(state.clock, onset.base.data[i], onset.uneven.data[i], state.evenness);
    out.data[i] = densityAt(f[i], frac);
  }
  return out;
}

/** 0..1 overall progress toward complete development (for UI). */
export function developmentProgress(state: DevelopState): number {
  return Math.min(1, state.clock / DEVELOPER.completeAt);
}

/**
 * GLSL twin of developedFraction/densityAt, with constants injected from the
 * same object so the shader can never drift from the CPU model.
 */
export const DEVELOP_GLSL = /* glsl */ `
float developedFraction(float clock, float onsetBase, float uneven, float evenness) {
  float onset = onsetBase + uneven * (1.0 - evenness);
  float p = max(0.0, clock - onset);
  return 1.0 - exp(-p / ${DEVELOPER.tau.toFixed(4)});
}
float densityAt(float finalDensity, float fraction) {
  return ${PAPER.dMin.toFixed(4)} + (finalDensity - ${PAPER.dMin.toFixed(4)}) * fraction;
}
`;
