import { linearToSrgb } from './color.ts';
import { negativeDensity } from './negative.ts';

/**
 * Silver-gelatin printing paper.
 *
 * The paper's characteristic (H&D) curve maps log exposure to print density.
 * More light → more developed silver → darker print. We use a logistic curve
 * in log exposure, whose slope is set by the contrast grade (variable-contrast
 * paper behind a filter). Grades pivot around a fixed mid-tone exposure, the
 * way Multigrade filters 00–3½ are designed to keep roughly equal speed, so
 * changing contrast does not also wildly change the print's brightness.
 */
export const PAPER = {
  /** paper base + fog density (the white of the paper) */
  dMin: 0.06,
  /** maximum black of a glossy fibre print */
  dMax: 2.05,
  /** mid-tone density held fixed across grades */
  pivotDensity: 0.75,
} as const;

export const GRADE_MIN = -0.5; // "00"
export const GRADE_MAX = 5;
export const DEFAULT_GRADE = 2.5;

/** Relative lamp intensity of the enlarger at the working aperture. */
export const LAMP_INTENSITY = 1;
/** A well-exposed mid-grey negative prints as mid-grey at this time. */
export const REFERENCE_TIME = 8;
export const MIN_TIME = 1;
export const MAX_TIME = 60;

/** Exposure (lamp · seconds · transmittance) that lands on the pivot density. */
const PIVOT_EXPOSURE = LAMP_INTENSITY * REFERENCE_TIME * Math.pow(10, -negativeDensity(0.18));
export const LOG_PIVOT = Math.log10(PIVOT_EXPOSURE);

const U_PIVOT = (PAPER.pivotDensity - PAPER.dMin) / (PAPER.dMax - PAPER.dMin);
const LOGIT_PIVOT = Math.log(U_PIVOT / (1 - U_PIVOT));
/** logit span between 2% and 90% of the density range (ISO range definition) */
const LOGIT_SPAN = Math.log(0.9 / 0.1) - Math.log(0.02 / 0.98);

/** ISO exposure range of the paper (log units) for a contrast grade. */
export function isoRange(grade: number): number {
  const g = Math.min(Math.max(grade, GRADE_MIN), GRADE_MAX);
  return 1.45 - 0.18 * g;
}

/** Curve slope parameter k for a grade. */
export function gradeSlope(grade: number): number {
  return LOGIT_SPAN / isoRange(grade);
}

/** Print density from log10 exposure for a grade (fully developed). */
export function paperDensity(logExposure: number, grade: number): number {
  const k = gradeSlope(grade);
  const x = k * (logExposure - LOG_PIVOT) + LOGIT_PIVOT;
  const u = 1 / (1 + Math.exp(-x));
  return PAPER.dMin + (PAPER.dMax - PAPER.dMin) * u;
}

/** Density for a linear exposure, guarding the zero-exposure case. */
export function densityFromExposure(exposure: number, grade: number): number {
  return paperDensity(Math.log10(Math.max(exposure, 1e-6)), grade);
}

/**
 * Print reflectance relative to the paper base, i.e. how the print looks under
 * white light with paper white = 1. Linear light.
 */
export function relativeReflectance(density: number): number {
  return Math.pow(10, -(density - PAPER.dMin));
}

/** Display value (sRGB 0..1) of a print density. */
export function densityToSrgb(density: number): number {
  return linearToSrgb(relativeReflectance(density));
}

export function gradeLabel(grade: number): string {
  if (grade <= -0.25) return '00';
  const r = Math.round(grade * 2) / 2;
  return Number.isInteger(r) ? String(r) : `${Math.floor(r)}½`;
}

/**
 * "Test strip" in software: find the exposure time that puts the negative's
 * key tone (log-mean transmittance of the central tonal range) on mid-grey —
 * what a printer reads off a real test strip. Rounded to half seconds.
 */
export function suggestExposureTime(transmittance: Float32Array): number {
  const step = Math.max(1, Math.floor(transmittance.length / 40000));
  const logs: number[] = [];
  for (let i = 0; i < transmittance.length; i += step) logs.push(Math.log10(Math.max(transmittance[i], 1e-5)));
  logs.sort((a, b) => a - b);
  const lo = Math.floor(logs.length * 0.1);
  const hi = Math.ceil(logs.length * 0.9);
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += logs[i];
  const keyLogT = sum / Math.max(1, hi - lo);
  // key tone of an average scene ≈ 18% grey
  const t = PIVOT_EXPOSURE / (LAMP_INTENSITY * Math.pow(10, keyLogT));
  const clamped = Math.min(Math.max(t, 2), 40);
  return Math.round(clamped * 2) / 2;
}
