import type { GrayImage } from './image.ts';

/**
 * Gaussian blur approximated by three successive box blurs (Kovesi, "Fast
 * almost-Gaussian filtering"). Cost is O(n) independent of radius, so the same
 * code serves the 640px interactive projection and multi-megapixel exports.
 */
function boxSizesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    let acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      const addIdx = Math.min(x + r, w - 1);
      const subIdx = x - r - 1;
      acc += src[row + addIdx] - (subIdx >= 0 ? src[row + subIdx] : first);
      dst[row + x] = acc * inv;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x];
    let acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[Math.min(j, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      const addIdx = Math.min(y + r, h - 1);
      const subIdx = y - r - 1;
      acc += src[addIdx * w + x] - (subIdx >= 0 ? src[subIdx * w + x] : first);
      dst[y * w + x] = acc * inv;
    }
  }
}

/** Returns a new blurred image; sigma in pixels. sigma < 0.3 returns a copy. */
export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  const { width: w, height: h } = img;
  const a = new Float32Array(img.data);
  if (!(sigma >= 0.3)) return { width: w, height: h, data: a };
  // keep the kernel well inside the image to avoid degenerate clamping
  const s = Math.min(sigma, Math.max(w, h) / 3);
  const b = new Float32Array(a.length);
  for (const size of boxSizesForGauss(s, 3)) {
    const r = Math.max(0, (size - 1) / 2);
    if (r === 0) continue;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return { width: w, height: h, data: a };
}

/** Mean squared gradient — a simple, monotonic sharpness metric. */
export function sharpness(img: GrayImage): number {
  const { width: w, height: h, data: d } = img;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const gx = d[i + 1] - d[i];
      const gy = d[i + w] - d[i];
      sum += gx * gx + gy * gy;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}
