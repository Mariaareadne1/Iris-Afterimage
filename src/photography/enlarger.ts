import { gaussianBlur } from './blur.ts';
import { createGray, downsampleBox, sampleBilinear, type GrayImage } from './image.ts';
import type { Negative } from './negative.ts';

/**
 * Enlarger optics: framing (magnification + negative position), focus, and
 * the projection of negative transmittance onto the image area of the paper.
 */
export interface Framing {
  /** magnification relative to a full-frame print, 1..MAX_ZOOM (crops in) */
  zoom: number;
  /** pan of the negative, in negative-width / negative-height fractions */
  offsetX: number;
  offsetY: number;
}

export const MAX_ZOOM = 3;
export const DEFAULT_FRAMING: Framing = { zoom: 1, offsetX: 0, offsetY: 0 };

/** Focus knob position where the projection is sharp. Knob range is 0..1. */
export const FOCUS_SHARP = 0.5;
/** Blur sigma (fraction of image-area width) per unit of focus error. */
const BLUR_PER_FOCUS = 0.09;
const MAX_BLUR_FRACTION = 0.04;

/** Clamp framing so the projected frame never shows the negative carrier. */
export function clampFraming(f: Framing): Framing {
  const zoom = Math.min(Math.max(Number.isFinite(f.zoom) ? f.zoom : 1, 1), MAX_ZOOM);
  const lim = 0.5 - 0.5 / zoom;
  const clamp = (v: number) => Math.min(Math.max(Number.isFinite(v) ? v : 0, -lim), lim);
  return { zoom, offsetX: clamp(f.offsetX), offsetY: clamp(f.offsetY) };
}

/** Map image-area UV (0..1, v down) to negative UV under a framing. */
export function paperToNegativeUV(u: number, v: number, f: Framing): [number, number] {
  return [0.5 + f.offsetX + (u - 0.5) / f.zoom, 0.5 + f.offsetY + (v - 0.5) / f.zoom];
}

/**
 * Blur radius produced by a focus setting, as a fraction of the image-area
 * width. The circle of confusion grows with magnification too: a defocused
 * enlarger is blurrier at larger print sizes.
 */
export function focusBlurFraction(focus: number, zoom = 1): number {
  const err = Math.abs(focus - FOCUS_SHARP);
  return Math.min(MAX_BLUR_FRACTION, err * BLUR_PER_FOCUS * (0.85 + 0.15 * zoom));
}

/**
 * Project the negative onto an output grid covering the paper's image area.
 * The result is the relative light (transmittance) reaching each point of the
 * paper, including defocus blur. Resolution-independent: preview and export
 * call this with different sizes and get the same picture.
 */
export function projectNegative(
  negative: Negative,
  framing: Framing,
  focus: number,
  outWidth: number,
  outHeight: number,
): GrayImage {
  const f = clampFraming(framing);
  const src0 = negative.transmittance;
  // anti-alias: prefilter when the negative is much larger than the output
  const footprintX = src0.width / f.zoom / outWidth;
  const footprintY = src0.height / f.zoom / outHeight;
  const factor = Math.floor(Math.min(footprintX, footprintY));
  const src = factor >= 2 ? downsampleBox(src0, factor) : src0;

  const out = createGray(outWidth, outHeight);
  const d = out.data;
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth;
      const [nu, nv] = paperToNegativeUV(u, v, f);
      d[y * outWidth + x] = sampleBilinear(src, nu * src.width, nv * src.height);
    }
  }
  const sigmaPx = focusBlurFraction(focus, f.zoom) * outWidth;
  return sigmaPx >= 0.3 ? gaussianBlur(out, sigmaPx) : out;
}
