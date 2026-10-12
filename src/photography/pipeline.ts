import { developImage, computeOnsetMaps, type DevelopState } from './development.ts';
import { projectNegative, type Framing } from './enlarger.ts';
import type { ExposureField } from './exposureField.ts';
import { createGray, sampleUV, type GrayImage } from './image.ts';
import { imagePixelSize, type PrintLayout } from './layout.ts';
import type { Negative } from './negative.ts';
import { densityFromExposure, LAMP_INTENSITY } from './paper.ts';

/**
 * The one reproducible path from negative + choices to a print. Preview,
 * developing tray and export all call these functions; only the resolution
 * differs.
 */
export interface EnlargerSettings {
  framing: Framing;
  focus: number;
  grade: number;
}

/** Final (fully developed) print density from projected light and exposure seconds. */
export function finalDensity(projection: GrayImage, field: ExposureField, grade: number): GrayImage {
  const out = createGray(projection.width, projection.height);
  const fieldImg = field.asImage();
  const { width: w, height: h } = projection;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const seconds = sampleUV(fieldImg, (x + 0.5) / w, v);
      const exposure = LAMP_INTENSITY * projection.data[i] * seconds;
      out.data[i] = densityFromExposure(exposure, grade);
    }
  }
  return out;
}

export interface RenderedPrint {
  projection: GrayImage;
  finalDensity: GrayImage;
  /** density as developed (equals finalDensity when dev is omitted) */
  density: GrayImage;
}

/** Render a print's image area at a given long-side resolution. */
export function renderPrint(
  negative: Negative,
  layout: PrintLayout,
  settings: EnlargerSettings,
  field: ExposureField,
  longSide: number,
  dev?: DevelopState,
): RenderedPrint {
  const { width, height } = imagePixelSize(layout, longSide);
  const projection = projectNegative(negative, settings.framing, settings.focus, width, height);
  const fd = finalDensity(projection, field, settings.grade);
  const density = dev ? developImage(fd, computeOnsetMaps(fd, dev), dev) : fd;
  return { projection, finalDensity: fd, density };
}
