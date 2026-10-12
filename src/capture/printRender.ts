import { densityToSrgb } from '../photography/paper.ts';
import { ExposureField } from '../photography/exposureField.ts';
import { renderPrint, type EnlargerSettings } from '../photography/pipeline.ts';
import type { DevelopState } from '../photography/development.ts';
import type { PrintLayout } from '../photography/layout.ts';
import { hash2 } from '../photography/noise.ts';
import type { GrayImage } from '../photography/image.ts';

/**
 * Everything needed to re-render a print anywhere (main thread, worker,
 * tests): the negative, the enlarger settings, the exposure field and the
 * development state. Plain data — structured-clone friendly.
 */
export interface PrintJob {
  transmittance: Float32Array;
  negWidth: number;
  negHeight: number;
  layout: PrintLayout;
  settings: EnlargerSettings;
  fieldData: Float32Array;
  fieldAspect: number;
  fieldLong: number;
  dev: DevelopState;
  longSide: number;
  border: boolean;
}

export interface PrintPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export const EXPORT_LONG_SIDE = 2400;

/** Density image → 8-bit greyscale RGBA with deterministic triangular dither. */
export function densityToRGBA(density: GrayImage, target?: { rgba: Uint8ClampedArray; stride: number; x: number; y: number }): Uint8ClampedArray {
  const { width: w, height: h, data } = density;
  const out = target?.rgba ?? new Uint8ClampedArray(w * h * 4);
  const stride = target?.stride ?? w;
  const ox = target?.x ?? 0;
  const oy = target?.y ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dither = hash2(x, y, 17) + hash2(x, y, 29) - 1;
      const v = Math.round(densityToSrgb(data[y * w + x]) * 255 + dither * 0.5);
      const i = ((y + oy) * stride + (x + ox)) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Render a print job to pixels, optionally on its full sheet with white borders. */
export function renderJob(job: PrintJob): PrintPixels {
  const field = ExposureField.fromData(job.fieldAspect, job.fieldLong, job.fieldData);
  const negative = {
    width: job.negWidth,
    height: job.negHeight,
    transmittance: { width: job.negWidth, height: job.negHeight, data: job.transmittance },
  };
  const { density } = renderPrint(negative, job.layout, job.settings, field, job.longSide, job.dev);
  if (!job.border) return { width: density.width, height: density.height, rgba: densityToRGBA(density) };
  const l = job.layout;
  const scale = density.width / l.image.w;
  const width = Math.round(l.sheetW * scale);
  const height = Math.round(l.sheetH * scale);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const x = Math.min(width - density.width, Math.max(0, Math.round(l.image.x * scale)));
  const y = Math.min(height - density.height, Math.max(0, Math.round(l.image.y * scale)));
  densityToRGBA(density, { rgba, stride: width, x, y });
  return { width, height, rgba };
}
