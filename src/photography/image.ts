/**
 * Minimal single-channel float image used throughout the photographic model.
 * Pure data — no DOM, no GPU — so the whole pipeline runs in workers and in
 * Node-based unit tests.
 */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export function createGray(width: number, height: number, fill = 0): GrayImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid image size ${width}x${height}`);
  }
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export function cloneGray(img: GrayImage): GrayImage {
  return { width: img.width, height: img.height, data: new Float32Array(img.data) };
}

export function mapGray(img: GrayImage, fn: (v: number, i: number) => number): GrayImage {
  const out = new Float32Array(img.data.length);
  const src = img.data;
  for (let i = 0; i < src.length; i++) out[i] = fn(src[i], i);
  return { width: img.width, height: img.height, data: out };
}

/** Bilinear sample at continuous pixel coordinates (pixel centres at +0.5), edge-clamped. */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const w = img.width;
  const h = img.height;
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = img.data;
  const a = d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx;
  const b = d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx;
  return a * (1 - ty) + b * ty;
}

/** Sample with normalised coordinates in [0,1]². */
export function sampleUV(img: GrayImage, u: number, v: number): number {
  return sampleBilinear(img, u * img.width, v * img.height);
}

/**
 * Box-filter downsample by an integer factor. Used as an anti-aliasing
 * prefilter before bilinear resampling to a much smaller size (otherwise
 * film grain and fine detail alias into moiré).
 */
export function downsampleBox(img: GrayImage, factor: number): GrayImage {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return img;
  const w = Math.max(1, Math.floor(img.width / f));
  const h = Math.max(1, Math.floor(img.height / f));
  const out = new Float32Array(w * h);
  const src = img.data;
  const sw = img.width;
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < f; j++) {
        const row = (y * f + j) * sw + x * f;
        for (let i = 0; i < f; i++) sum += src[row + i];
      }
      out[y * w + x] = sum * inv;
    }
  }
  return { width: w, height: h, data: out };
}

/** Mean over a normalised rectangle — handy for measurements in tests and the UI. */
export function regionMean(img: GrayImage, u0: number, v0: number, u1: number, v1: number): number {
  const x0 = Math.max(0, Math.floor(u0 * img.width));
  const x1 = Math.min(img.width, Math.ceil(u1 * img.width));
  const y0 = Math.max(0, Math.floor(v0 * img.height));
  const y1 = Math.min(img.height, Math.ceil(v1 * img.height));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += img.data[y * img.width + x];
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

/** Fit (w,h) inside a maximum long side, preserving aspect. */
export function fitDimensions(w: number, h: number, maxLong: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxLong) return { width: Math.round(w), height: Math.round(h) };
  const s = maxLong / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
