/**
 * Deterministic, resolution-independent noise. Every stochastic part of the
 * model (film grain, uneven development) is a pure function of position and
 * seed, so a print re-rendered at export resolution matches the preview.
 */

/** 32-bit integer hash → [0,1). */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0,1] at continuous lattice coordinates. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Fractal value noise in [0,1]; `scale` is lattice cells across a unit square. */
export function fbm(u: number, v: number, scale: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = scale;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * f, v * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Approximately normal (mean 0, sd ≈ 1) hash noise for grain. */
export function gaussianHash(ix: number, iy: number, seed: number): number {
  // Irwin–Hall with 4 uniforms: cheap and good enough for grain
  const s = hash2(ix, iy, seed) + hash2(ix, iy, seed + 1) + hash2(ix, iy, seed + 2) + hash2(ix, iy, seed + 3);
  return (s - 2) * 1.7320508;
}
