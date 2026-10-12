import { createGray, type GrayImage } from '../../src/photography/image.ts';

/** Horizontal linear-luminance gradient 0.01 → 1. */
export function gradient(w = 128, h = 32): GrayImage {
  const img = createGray(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = 0.01 + 0.99 * (x / (w - 1));
  return img;
}

/** 11-step wedge of luminances, log-spaced like a Stouffer step tablet. */
export function stepWedge(steps = 11, stepW = 16, h = 16): { img: GrayImage; levels: number[] } {
  const levels = Array.from({ length: steps }, (_, i) => Math.pow(10, -2 + (2 * i) / (steps - 1)));
  const w = steps * stepW;
  const img = createGray(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[y * w + x] = levels[Math.floor(x / stepW)];
  return { img, levels };
}

/** Checkerboard of two luminances. */
export function checkerboard(w = 128, h = 128, cell = 8, a = 0.05, b = 0.9): GrayImage {
  const img = createGray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) img.data[y * w + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? b : a;
  return img;
}

/** Uniform mid-grey scene. */
export function flat(w = 64, h = 48, l = 0.18): GrayImage {
  return createGray(w, h, l);
}
