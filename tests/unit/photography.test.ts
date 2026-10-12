import { describe, expect, test } from 'vitest';
import {
  createNegative,
  negativeDensity,
  negativeFromRGBA,
  NEGATIVE,
  T_BASE,
  luminanceFromRGBA,
} from '../../src/photography/negative.ts';
import { projectNegative, focusBlurFraction, FOCUS_SHARP, clampFraming, DEFAULT_FRAMING } from '../../src/photography/enlarger.ts';
import { sharpness } from '../../src/photography/blur.ts';
import {
  paperDensity,
  densityFromExposure,
  densityToSrgb,
  PAPER,
  LOG_PIVOT,
  suggestExposureTime,
  gradeLabel,
  isoRange,
} from '../../src/photography/paper.ts';
import { ExposureField } from '../../src/photography/exposureField.ts';
import { finalDensity, renderPrint } from '../../src/photography/pipeline.ts';
import { computeLayout, imagePixelSize } from '../../src/photography/layout.ts';
import { regionMean, createGray } from '../../src/photography/image.ts';
import { checkerboard, flat, gradient, stepWedge } from './calibration.ts';

const settings = (over: Partial<{ grade: number; focus: number }> = {}) => ({
  framing: DEFAULT_FRAMING,
  focus: FOCUS_SHARP,
  grade: 2.5,
  ...over,
});

function exposedField(aspect: number, seconds: number) {
  const f = new ExposureField(aspect, 64);
  f.addBase(seconds);
  return f;
}

describe('negative', () => {
  test('negative is tonally inverted: brighter scene → denser negative → less light through', () => {
    const { img, levels } = stepWedge();
    const neg = createNegative(img, { grain: 0, normalize: false });
    const t = levels.map((_, i) => neg.transmittance.data[i * 16 + 8]);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThan(t[i - 1]);
    // shadows are near clear base, highlights dense
    expect(t[0]).toBeGreaterThan(T_BASE * 0.5);
    expect(t[t.length - 1]).toBeLessThan(T_BASE * 0.1);
  });

  test('density follows γ·log10(L) above the toe', () => {
    expect(negativeDensity(NEGATIVE.lMin)).toBeCloseTo(NEGATIVE.dMin, 6);
    const d1 = negativeDensity(0.1);
    const d2 = negativeDensity(1);
    expect(d2 - d1).toBeCloseTo(NEGATIVE.gamma, 6);
  });

  test('RGBA conversion uses linear luminance and handles colour', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    const lum = luminanceFromRGBA(rgba, 3, 1);
    expect(lum.data[0]).toBeCloseTo(1, 5);
    expect(lum.data[1]).toBeCloseTo(0, 5);
    expect(lum.data[2]).toBeCloseTo(0.2126, 3);
    const neg = negativeFromRGBA(rgba, 3, 1, { grain: 0 });
    expect(neg.transmittance.data[0]).toBeLessThan(neg.transmittance.data[1]);
  });

  test('normalisation stretches a flat, low-contrast scan to the full film range', () => {
    const g = gradient();
    const dull = { ...g, data: g.data.map((v) => 0.05 + v * 0.3) };
    const neg = createNegative(dull, { grain: 0 });
    const t = neg.transmittance.data;
    const min = Math.min(...t);
    const max = Math.max(...t);
    expect(Math.log10(max / min)).toBeGreaterThan(1.1);
  });

  test('grain is deterministic per seed', () => {
    const a = createNegative(flat(), { seed: 3 });
    const b = createNegative(flat(), { seed: 3 });
    const c = createNegative(flat(), { seed: 4 });
    expect(Array.from(a.transmittance.data)).toEqual(Array.from(b.transmittance.data));
    expect(Array.from(a.transmittance.data)).not.toEqual(Array.from(c.transmittance.data));
  });
});

describe('paper curve and exposure', () => {
  test('more exposure → darker print, monotonically', () => {
    let prev = -Infinity;
    for (let logE = -3; logE <= 2; logE += 0.1) {
      const d = paperDensity(logE, 2.5);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(paperDensity(-4, 2)).toBeCloseTo(PAPER.dMin, 2);
    expect(paperDensity(3, 2)).toBeCloseTo(PAPER.dMax, 1);
  });

  test('longer exposure darkens and shorter exposure lightens the developed positive', () => {
    const neg = createNegative(gradient(), { grain: 0 });
    const layout = computeLayout(neg.width, neg.height);
    const mean = (seconds: number) => {
      const r = renderPrint(neg, layout, settings(), exposedField(layout.aspect, seconds), 96);
      return regionMean(r.density, 0, 0, 1, 1);
    };
    const short = mean(4);
    const normal = mean(8);
    const long = mean(16);
    expect(long).toBeGreaterThan(normal + 0.1);
    expect(short).toBeLessThan(normal - 0.1);
  });

  test('higher grades produce a steeper tonal response around the pivot', () => {
    const slope = (g: number) => (paperDensity(LOG_PIVOT + 0.05, g) - paperDensity(LOG_PIVOT - 0.05, g)) / 0.1;
    const grades = [-0.5, 0, 1, 2, 3, 4, 5];
    for (let i = 1; i < grades.length; i++) expect(slope(grades[i])).toBeGreaterThan(slope(grades[i - 1]));
    expect(isoRange(0)).toBeGreaterThan(isoRange(5));
  });

  test('grade changes contrast of a step wedge print without moving the mid-tone much', () => {
    const { img } = stepWedge();
    const neg = createNegative(img, { grain: 0, normalize: false });
    const layout = computeLayout(neg.width, neg.height);
    const field = exposedField(layout.aspect, 8);
    const range = (grade: number) => {
      const r = renderPrint(neg, layout, settings({ grade }), field, 176);
      const shadows = regionMean(r.density, 0.0, 0.2, 0.08, 0.8);
      const lights = regionMean(r.density, 0.92, 0.2, 1, 0.8);
      return shadows - lights;
    };
    expect(range(5)).toBeGreaterThan(range(2.5));
    expect(range(2.5)).toBeGreaterThan(range(0));
    // pivot density is shared by all grades
    expect(paperDensity(LOG_PIVOT, 0)).toBeCloseTo(paperDensity(LOG_PIVOT, 5), 6);
  });

  test('default exposure yields a pleasing print: mid-grey scene → mid-grey print', () => {
    const neg = createNegative(flat(64, 48, 0.18), { grain: 0, normalize: false });
    const t = suggestExposureTime(neg.transmittance.data);
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(12);
    const d = densityFromExposure(neg.transmittance.data[0] * t, 2.5);
    const srgb = densityToSrgb(d);
    expect(srgb).toBeGreaterThan(0.35);
    expect(srgb).toBeLessThan(0.6);
  });

  test('paper white is display white and maximum black is deep', () => {
    expect(densityToSrgb(PAPER.dMin)).toBeCloseTo(1, 5);
    expect(densityToSrgb(PAPER.dMax)).toBeLessThan(0.12);
  });

  test('grade labels', () => {
    expect(gradeLabel(-0.5)).toBe('00');
    expect(gradeLabel(2.5)).toBe('2½');
    expect(gradeLabel(4)).toBe('4');
  });

  test('unexposed paper develops to paper white', () => {
    const neg = createNegative(gradient(), { grain: 0 });
    const layout = computeLayout(neg.width, neg.height);
    const r = renderPrint(neg, layout, settings(), new ExposureField(layout.aspect, 32), 64);
    expect(Math.max(...r.density.data)).toBeLessThan(PAPER.dMin + 0.02);
  });
});

describe('focus', () => {
  test('defocus reduces sharpness of the projected image and the final print', () => {
    const neg = createNegative(checkerboard(), { grain: 0, normalize: false });
    const sharp = projectNegative(neg, DEFAULT_FRAMING, FOCUS_SHARP, 128, 128);
    const soft = projectNegative(neg, DEFAULT_FRAMING, FOCUS_SHARP + 0.2, 128, 128);
    const softer = projectNegative(neg, DEFAULT_FRAMING, FOCUS_SHARP - 0.4, 128, 128);
    expect(sharpness(soft)).toBeLessThan(sharpness(sharp) * 0.5);
    expect(sharpness(softer)).toBeLessThan(sharpness(soft));

    const field = exposedField(1, 8);
    const pSharp = finalDensity(sharp, field, 2.5);
    const pSoft = finalDensity(soft, field, 2.5);
    expect(sharpness(pSoft)).toBeLessThan(sharpness(pSharp) * 0.5);
  });

  test('blur is symmetric around the sharp point and bounded', () => {
    expect(focusBlurFraction(FOCUS_SHARP)).toBe(0);
    expect(focusBlurFraction(FOCUS_SHARP + 0.1)).toBeCloseTo(focusBlurFraction(FOCUS_SHARP - 0.1), 9);
    expect(focusBlurFraction(0)).toBeLessThanOrEqual(0.04);
  });
});

describe('framing', () => {
  test('crop changes are reflected in the output', () => {
    // left half dark scene, right half bright scene
    const img = createGray(100, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) img.data[y * 100 + x] = x < 50 ? 0.02 : 0.9;
    const neg = createNegative(img, { grain: 0, normalize: false });
    const full = projectNegative(neg, DEFAULT_FRAMING, FOCUS_SHARP, 64, 64);
    const zoomLeft = projectNegative(neg, { zoom: 2, offsetX: -0.25, offsetY: 0 }, FOCUS_SHARP, 64, 64);
    const zoomRight = projectNegative(neg, { zoom: 2, offsetX: 0.25, offsetY: 0 }, FOCUS_SHARP, 64, 64);
    // left crop shows only the (thin, bright-light) shadow area
    expect(regionMean(zoomLeft, 0, 0, 1, 1)).toBeGreaterThan(regionMean(full, 0, 0, 1, 1));
    expect(regionMean(zoomRight, 0, 0, 1, 1)).toBeLessThan(regionMean(full, 0, 0, 1, 1));
  });

  test('framing is clamped so the carrier edge never shows', () => {
    const f = clampFraming({ zoom: 2, offsetX: 1, offsetY: -1 });
    expect(f.offsetX).toBeCloseTo(0.25);
    expect(f.offsetY).toBeCloseTo(-0.25);
    expect(clampFraming({ zoom: 0.2, offsetX: 0.3, offsetY: 0 })).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
    expect(clampFraming({ zoom: NaN, offsetX: NaN, offsetY: 0 }).zoom).toBe(1);
  });
});

describe('layout', () => {
  test('sheet orientation follows the negative; image area keeps its aspect', () => {
    const land = computeLayout(3000, 2000);
    expect(land.sheetW).toBeGreaterThan(land.sheetH);
    expect(land.image.w / land.image.h).toBeCloseTo(1.5, 6);
    const port = computeLayout(1600, 2000);
    expect(port.sheetH).toBeGreaterThan(port.sheetW);
    const sq = computeLayout(1000, 1000);
    expect(sq.image.w).toBeCloseTo(sq.image.h, 6);
    for (const l of [land, port, sq]) {
      expect(l.image.x).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(l.image.y).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(l.image.x + l.image.w).toBeLessThanOrEqual(l.sheetW - 0.5 + 1e-9);
    }
    expect(imagePixelSize(port, 1000).height).toBe(1000);
  });
});

describe('reproducibility', () => {
  test('identical inputs render identical prints; resolution changes do not change tone', () => {
    const neg = createNegative(gradient(), { seed: 9 });
    const layout = computeLayout(neg.width, neg.height);
    const f = exposedField(layout.aspect, 9);
    const a = renderPrint(neg, layout, settings(), f, 96);
    const b = renderPrint(neg, layout, settings(), f, 96);
    expect(Array.from(a.density.data)).toEqual(Array.from(b.density.data));
    const big = renderPrint(neg, layout, settings(), f, 192);
    expect(regionMean(big.density, 0.3, 0.3, 0.7, 0.7)).toBeCloseTo(regionMean(a.density, 0.3, 0.3, 0.7, 0.7), 1);
  });
});
