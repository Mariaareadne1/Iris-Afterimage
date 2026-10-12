import { describe, expect, test } from 'vitest';
import { ExposureField, MAX_FIELD_SECONDS } from '../../src/photography/exposureField.ts';
import { createNegative } from '../../src/photography/negative.ts';
import { computeLayout } from '../../src/photography/layout.ts';
import { renderPrint } from '../../src/photography/pipeline.ts';
import { DEFAULT_FRAMING, FOCUS_SHARP } from '../../src/photography/enlarger.ts';
import { regionMean } from '../../src/photography/image.ts';
import {
  advanceDevelopment,
  computeOnsetMaps,
  developImage,
  developedFraction,
  developmentProgress,
  DEVELOPER,
  DEVELOP_GLSL,
  initialDevelopState,
  inductionTime,
  type DevelopState,
} from '../../src/photography/development.ts';
import { PAPER } from '../../src/photography/paper.ts';
import { flat, gradient } from './calibration.ts';

const settings = { framing: DEFAULT_FRAMING, focus: FOCUS_SHARP, grade: 2.5 };

function setup() {
  const neg = createNegative(flat(96, 64, 0.18), { grain: 0, normalize: false });
  const layout = computeLayout(neg.width, neg.height);
  return { neg, layout };
}

/** Simulate a real-time exposure loop: 8 s at 60 fps, optionally dodging. */
function exposeWithTool(field: ExposureField, seconds: number, tool?: { u: number; v: number; radius: number }) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    field.addBase(dt);
    if (tool) field.dodge({ ...tool, feather: 0.5 }, dt);
  }
}

describe('dodging and burning', () => {
  test('dodging lightens the dodged region and leaves distant regions unaffected', () => {
    const { neg, layout } = setup();
    const plain = new ExposureField(layout.aspect, 128);
    exposeWithTool(plain, 8);
    const dodged = new ExposureField(layout.aspect, 128);
    exposeWithTool(dodged, 8, { u: 0.25, v: 0.5, radius: 0.15 });
    const a = renderPrint(neg, layout, settings, plain, 120).density;
    const b = renderPrint(neg, layout, settings, dodged, 120).density;
    const inA = regionMean(a, 0.2, 0.45, 0.3, 0.55);
    const inB = regionMean(b, 0.2, 0.45, 0.3, 0.55);
    expect(inB).toBeLessThan(inA - 0.2); // markedly lighter (less density)
    const farA = regionMean(a, 0.75, 0.3, 0.95, 0.7);
    const farB = regionMean(b, 0.75, 0.3, 0.95, 0.7);
    expect(Math.abs(farA - farB)).toBeLessThan(1e-6);
  });

  test('burning darkens the burned region and leaves distant regions unaffected', () => {
    const { neg, layout } = setup();
    const base = new ExposureField(layout.aspect, 128);
    base.addBase(8);
    const burned = base.clone();
    for (let i = 0; i < 240; i++) burned.burn({ u: 0.7, v: 0.5, radius: 0.12, feather: 0.4 }, 1 / 60);
    const a = renderPrint(neg, layout, settings, base, 120).density;
    const b = renderPrint(neg, layout, settings, burned, 120).density;
    expect(regionMean(b, 0.66, 0.45, 0.74, 0.55)).toBeGreaterThan(regionMean(a, 0.66, 0.45, 0.74, 0.55) + 0.2);
    expect(Math.abs(regionMean(b, 0.02, 0.1, 0.25, 0.9) - regionMean(a, 0.02, 0.1, 0.25, 0.9))).toBeLessThan(1e-6);
  });

  test('the dodge effect scales with the time the tool is held there', () => {
    const { layout } = setup();
    const short = new ExposureField(layout.aspect, 64);
    const long = new ExposureField(layout.aspect, 64);
    short.addBase(8);
    long.addBase(8);
    short.dodge({ u: 0.5, v: 0.5, radius: 0.1, feather: 0.3 }, 1);
    long.dodge({ u: 0.5, v: 0.5, radius: 0.1, feather: 0.3 }, 4);
    expect(long.secondsAt(0.5, 0.5)).toBeLessThan(short.secondsAt(0.5, 0.5));
    expect(short.secondsAt(0.5, 0.5)).toBeCloseTo(7, 1);
  });

  test('masks are soft: exposure changes gradually across the tool edge', () => {
    const { layout } = setup();
    const f = new ExposureField(layout.aspect, 256);
    f.addBase(10);
    f.dodge({ u: 0.5, v: 0.5, radius: 0.2, feather: 0.6 }, 10);
    const samples = [0.5, 0.56, 0.62, 0.68, 0.74].map((v) => f.secondsAt(0.5, v));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-6);
    expect(samples[2]).toBeGreaterThan(samples[0] + 0.5);
    expect(samples[2]).toBeLessThan(samples[4] - 0.5);
  });

  test('exposure stays bounded: dodging cannot go negative, burning is capped', () => {
    const f = new ExposureField(1, 32);
    f.addBase(1);
    f.dodge({ u: 0.5, v: 0.5, radius: 0.3, feather: 0.1 }, 50);
    expect(Math.min(...f.data)).toBeGreaterThanOrEqual(0);
    f.burn({ u: 0.5, v: 0.5, radius: 0.3, feather: 0.1 }, 1e6);
    expect(Math.max(...f.data)).toBeLessThanOrEqual(MAX_FIELD_SECONDS);
  });

  test('invalid tool input is ignored rather than corrupting the field', () => {
    const f = new ExposureField(1.5, 32);
    f.addBase(5);
    f.dodge({ u: NaN, v: 0.5, radius: 0.1, feather: 0.2 }, 1);
    f.burn({ u: 0.5, v: 0.5, radius: -1, feather: 0.2 }, 1);
    f.addBase(-3);
    expect(f.data.every((v) => v === 5)).toBe(true);
    expect(f.ops.length).toBe(1);
  });

  test('replaying the op log reproduces the field exactly; reset clears it', () => {
    const f = new ExposureField(0.8, 96);
    exposeWithTool(f, 2, { u: 0.4, v: 0.3, radius: 0.1 });
    f.burn({ u: 0.6, v: 0.7, radius: 0.08, feather: 0.5 }, 1.5);
    const r = ExposureField.replay(0.8, f.ops, 96);
    expect(Array.from(r.data)).toEqual(Array.from(f.data));
    f.reset();
    expect(f.isExposed).toBe(false);
    expect(f.ops.length).toBe(0);
  });
});

describe('development', () => {
  function latent() {
    const neg = createNegative(gradient(128, 64), { grain: 0 });
    const layout = computeLayout(neg.width, neg.height);
    const field = new ExposureField(layout.aspect, 64);
    field.addBase(8);
    const print = renderPrint(neg, layout, settings, field, 128);
    return print.finalDensity;
  }

  function developFor(seconds: number, agitate = 0, s0: DevelopState = initialDevelopState()) {
    let s = s0;
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) s = advanceDevelopment(s, dt, agitate);
    return s;
  }

  test('a latent image exists after exposure but nothing is visible before development', () => {
    const fd = latent();
    const range = Math.max(...fd.data) - Math.min(...fd.data);
    expect(range).toBeGreaterThan(1); // the latent image carries the picture
    const onset = computeOnsetMaps(fd, initialDevelopState());
    const atZero = developImage(fd, onset, initialDevelopState());
    expect(Math.max(...atZero.data)).toBeCloseTo(PAPER.dMin, 6); // blank sheet
  });

  test('the image emerges progressively, shadows first, and completes', () => {
    const fd = latent();
    const s0 = initialDevelopState();
    const onset = computeOnsetMaps(fd, s0);
    const means: number[] = [];
    const states = [2, 4, 6, 9, 14, 20].map((t) => developFor(t, 0, s0));
    for (const st of states) means.push(regionMean(developImage(fd, onset, st), 0, 0, 1, 1));
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThan(means[i - 1]);

    // dark scene (left of the gradient) prints as dense shadows, which appear before highlights
    const early = developImage(fd, onset, developFor(2.6, 0, s0));
    const shadowFrac = (regionMean(early, 0.0, 0.2, 0.2, 0.8) - PAPER.dMin) / (regionMean(fd, 0.0, 0.2, 0.2, 0.8) - PAPER.dMin);
    const lightFrac = (regionMean(early, 0.8, 0.2, 1, 0.8) - PAPER.dMin) / Math.max(1e-6, regionMean(fd, 0.8, 0.2, 1, 0.8) - PAPER.dMin);
    expect(shadowFrac).toBeGreaterThan(lightFrac);

    // complete development matches the photographic model within 1%
    const done = developFor(DEVELOPER.completeAt / DEVELOPER.speed + 1, 0, s0);
    expect(developmentProgress(done)).toBe(1);
    const dev = developImage(fd, onset, done);
    let maxErr = 0;
    for (let i = 0; i < fd.data.length; i++) maxErr = Math.max(maxErr, Math.abs(dev.data[i] - fd.data[i]));
    expect(maxErr).toBeLessThan(0.02);
  });

  test('density never decreases during development, even as agitation changes', () => {
    const fd = latent();
    const s0 = initialDevelopState(11);
    const onset = computeOnsetMaps(fd, s0);
    let s = s0;
    let prev = developImage(fd, onset, s).data;
    for (let k = 0; k < 120; k++) {
      s = advanceDevelopment(s, 1 / 10, k % 20 < 5 ? 1 : 0);
      const cur = developImage(fd, onset, s).data;
      for (let i = 0; i < cur.length; i += 37) expect(cur[i]).toBeGreaterThanOrEqual(prev[i] - 1e-9);
      prev = cur;
    }
  });

  test('agitation speeds development and evens it out without destroying the image', () => {
    const still = developFor(4, 0);
    const agitated = developFor(4, 1);
    expect(agitated.clock).toBeGreaterThan(still.clock);
    expect(agitated.evenness).toBeGreaterThan(still.evenness);
    expect(agitated.evenness).toBeLessThanOrEqual(1);
    // extreme agitation still converges to the same final image
    const fd = latent();
    const onset = computeOnsetMaps(fd, initialDevelopState());
    const a = developImage(fd, onset, developFor(40, 1));
    const b = developImage(fd, onset, developFor(40, 0));
    expect(regionMean(a, 0, 0, 1, 1)).toBeCloseTo(regionMean(b, 0, 0, 1, 1), 1);
  });

  test('development step input is sanitised', () => {
    const s = advanceDevelopment(initialDevelopState(), 100, 5);
    expect(s.clock).toBeLessThan(2);
    expect(s.agitation).toBeLessThanOrEqual(1);
    const n = advanceDevelopment(initialDevelopState(), -1, -1);
    expect(n.clock).toBe(0);
  });

  test('restarting development from the initial state reproduces the same frames', () => {
    const fd = latent();
    const s0 = initialDevelopState(5);
    const onset = computeOnsetMaps(fd, s0);
    const first = developImage(fd, onset, developFor(5, 0.3, s0));
    developImage(fd, onset, developFor(12, 1, s0)); // a different run in between
    const again = developImage(fd, onset, developFor(5, 0.3, s0));
    expect(Array.from(again.data)).toEqual(Array.from(first.data));
  });

  test('induction: shadows start before highlights', () => {
    expect(inductionTime(1)).toBeLessThan(inductionTime(0.5));
    expect(inductionTime(0.5)).toBeLessThan(inductionTime(0));
    expect(developedFraction(0, 0, 0, 0)).toBe(0);
  });

  test('shader source embeds the same constants as the CPU model', () => {
    expect(DEVELOP_GLSL).toContain(DEVELOPER.tau.toFixed(4));
    expect(DEVELOP_GLSL).toContain(PAPER.dMin.toFixed(4));
  });
});
