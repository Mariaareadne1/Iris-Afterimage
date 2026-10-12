import { SRGB8_TO_LINEAR, LUMA_B, LUMA_G, LUMA_R } from './color.ts';
import { createGray, type GrayImage } from './image.ts';
import { gaussianHash } from './noise.ts';

/**
 * Film negative model.
 *
 * A camera negative records log scene luminance as silver density:
 *   D_neg = D_min + γ_neg · log10(L / L_min)
 * Bright parts of the scene become dense (dark) on the negative, shadows stay
 * thin (clear). The enlarger later shines light *through* the negative, so the
 * quantity the printing stage needs is transmittance T = 10^(−D_neg).
 */
export const NEGATIVE = {
  /** base + fog density of the film */
  dMin: 0.22,
  /** negative contrast (typical B&W film developed normally ≈ 0.6) */
  gamma: 0.62,
  /** darkest scene luminance the film separates from black */
  lMin: 0.008,
  /** default grain amplitude in density units */
  grain: 0.035,
} as const;

/** Transmittance of clear film base — the brightest light a negative passes. */
export const T_BASE = Math.pow(10, -NEGATIVE.dMin);

export interface Negative {
  readonly width: number;
  readonly height: number;
  /** transmittance of the developed negative, 0..T_BASE */
  readonly transmittance: GrayImage;
}

export interface NegativeOptions {
  /** grain amplitude (density units); 0 disables grain */
  grain?: number;
  /** grain seed — fixed per negative so re-renders match */
  seed?: number;
  /** stretch tones so the negative uses the full film range (default true) */
  normalize?: boolean;
}

/** Linear-light luminance from 8-bit sRGB RGBA pixels. */
export function luminanceFromRGBA(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const img = createGray(width, height);
  const out = img.data;
  const lut = SRGB8_TO_LINEAR;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = LUMA_R * lut[rgba[p]] + LUMA_G * lut[rgba[p + 1]] + LUMA_B * lut[rgba[p + 2]];
  }
  return img;
}

function percentile(values: Float32Array, q: number): number {
  // sample at most 64k values to keep this O(n) cheap on large images
  const step = Math.max(1, Math.floor(values.length / 65536));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  const idx = Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))));
  return sample[idx];
}

/**
 * Normalise scene luminance in the log domain so the darkest ~0.5% maps to the
 * film's toe and the brightest ~0.5% to diffuse white. This plays the role of
 * a well-exposed negative: old scans with grey blacks and dim whites still
 * produce a full-range print.
 */
export function normalizeLuminance(img: GrayImage, lowQ = 0.005, highQ = 0.995): GrayImage {
  const eps = 1e-5;
  const lo = Math.max(percentile(img.data, lowQ), eps);
  const hi = Math.max(percentile(img.data, highQ), lo * 1.5);
  const logLo = Math.log10(lo);
  const span = Math.log10(hi) - logLo;
  const targetLo = Math.log10(NEGATIVE.lMin * 1.1);
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) {
    const s = (Math.log10(Math.max(img.data[i], eps)) - logLo) / span;
    const t = Math.min(Math.max(s, 0), 1);
    out[i] = Math.pow(10, targetLo + (0 - targetLo) * t);
  }
  return { width: img.width, height: img.height, data: out };
}

/** Negative density for a scene luminance (linear, 0..1). */
export function negativeDensity(luminance: number): number {
  const l = Math.max(luminance, NEGATIVE.lMin);
  return NEGATIVE.dMin + NEGATIVE.gamma * Math.log10(l / NEGATIVE.lMin);
}

/** Build a developed negative from a positive linear-luminance image. */
export function createNegative(positive: GrayImage, opts: NegativeOptions = {}): Negative {
  const grain = opts.grain ?? NEGATIVE.grain;
  const seed = opts.seed ?? 1;
  const src = opts.normalize === false ? positive : normalizeLuminance(positive);
  const { width, height } = src;
  const t = createGray(width, height);
  const out = t.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = negativeDensity(src.data[i]);
      if (grain > 0) {
        // silver grain is most visible in the mid densities
        const mid = 1 - Math.abs((d - NEGATIVE.dMin) / 1.3 - 0.5) * 1.2;
        d += gaussianHash(x, y, seed) * grain * Math.max(0.35, mid);
      }
      out[i] = Math.pow(10, -Math.max(d, NEGATIVE.dMin * 0.9));
    }
  }
  return { width, height, transmittance: t };
}

/** Convenience: RGBA pixels → negative. */
export function negativeFromRGBA(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts: NegativeOptions = {},
): Negative {
  return createNegative(luminanceFromRGBA(rgba, width, height), opts);
}

/**
 * Display value for viewing a negative on a light box: brightness relative to
 * clear film base, so the image reads tonally inverted (sky dark, shadows
 * bright). Returned as linear light 0..1.
 */
export function negativeViewingValue(transmittance: number): number {
  return Math.min(1, transmittance / T_BASE);
}
