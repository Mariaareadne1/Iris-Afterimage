import { describe, expect, test } from 'vitest';
import { PaperSim } from '../../src/physics/paper.ts';
import { carryPoint } from '../../src/physics/carry.ts';

const W = 0.254;
const H = 0.2032;

function sheet() {
  const s = new PaperSim(W, H, 20, 16);
  s.placeFlat({ x: 0, y: 0.002, z: 0 });
  return s;
}

function run(s: PaperSim, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) s.step(1 / 60);
}

/** Deviation of the sheet from a best-fit horizontal plane. */
function bend(s: PaperSim) {
  const { min, max } = s.heightRange();
  return max - min;
}

describe('paper physics', () => {
  test('settles nearly flat on the bench with a slight edge curl', () => {
    const s = sheet();
    run(s, 2);
    const { min, max } = s.heightRange();
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(0.02); // never floats away
    expect(s.motion()).toBeLessThan(1e-4); // at rest
  });

  test('the sheet can be picked up by a corner and lifts with a natural bend', () => {
    const s = sheet();
    run(s, 0.5);
    const corner = s.cornerIndex('tl');
    expect(s.grabVertex(corner, 0.03)).toBe(true);
    const c0 = s.vertex(corner);
    for (let i = 0; i < 90; i++) {
      s.moveGrab({ x: c0.x, y: c0.y + (0.12 * i) / 90, z: c0.z });
      s.step(1 / 60);
    }
    run(s, 0.5);
    const lifted = s.vertex(corner);
    expect(lifted.y).toBeGreaterThan(0.1);
    // the far corner stays on the bench: the sheet bends rather than tilting rigidly
    const far = s.vertex(s.cornerIndex('br'));
    expect(far.y).toBeLessThan(0.02);
    expect(bend(s)).toBeGreaterThan(0.09);
  });

  test('localised dragging deforms the sheet locally', () => {
    const s = sheet();
    run(s, 0.3);
    const mid = s.vertex(s.cornerIndex('tr'));
    s.startGrab(mid, 0.03);
    s.moveGrab({ x: mid.x, y: 0.05, z: mid.z });
    run(s, 0.6);
    expect(s.vertex(s.cornerIndex('tr')).y).toBeGreaterThan(0.04);
    expect(s.vertex(s.cornerIndex('bl')).y).toBeLessThan(0.01);
  });

  test('the texture stays attached: structural edges barely stretch under load', () => {
    const s = sheet();
    s.grabVertex(s.cornerIndex('tl'), 0.03);
    const c = s.vertex(s.cornerIndex('tl'));
    s.moveGrab({ x: c.x, y: 0.25, z: c.z });
    run(s, 2);
    expect(s.maxStretch()).toBeLessThan(0.08);
  });

  test('stable after many rough interactions: no explosion, no disappearance', () => {
    const s = sheet();
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let round = 0; round < 40; round++) {
      const i = Math.floor(rnd() * s.count);
      if (!s.grabVertex(i, 0.04)) continue;
      for (let k = 0; k < 20; k++) {
        s.moveGrab({ x: (rnd() - 0.5) * 0.6, y: rnd() * 0.3, z: (rnd() - 0.5) * 0.6 });
        s.step(1 / 60);
      }
      s.endGrab();
      s.step(1 / 60);
    }
    run(s, 3);
    for (const v of s.positions) expect(Number.isFinite(v)).toBe(true);
    const c = s.centroid();
    expect(Math.abs(c.x)).toBeLessThan(1);
    expect(c.y).toBeLessThan(0.05);
    expect(s.maxStretch()).toBeLessThan(0.1);
  });

  test('can be carried into a tray, released, and sinks under the liquid inside the walls', () => {
    const s = sheet();
    const trayFloor = (x: number, z: number) => (Math.abs(x - 0.5) < 0.18 && Math.abs(z) < 0.15 ? 0.01 : 0);
    s.env = { floorAt: trayFloor, bounds: null, liquidLevel: null };
    run(s, 0.3);
    const grip = s.vertex(s.edgeMidIndex('left'));
    s.grabVertex(s.edgeMidIndex('left'), 0.02);
    const plan = { from: grip, to: { x: 0.5, y: 0.01, z: 0 }, layDir: { x: 1, z: 0 }, length: W, clearance: 0.3 };
    const frames = 150;
    for (let i = 0; i <= frames; i++) {
      s.moveGrab(carryPoint(plan, i / frames));
      // walls and liquid apply once the sheet is over the tray
      if (i > frames * 0.45) s.env = { floorAt: trayFloor, bounds: { minX: 0.33, maxX: 0.67, minZ: -0.14, maxZ: 0.14 }, liquidLevel: 0.03 };
      s.step(1 / 60);
    }
    s.endGrab();
    run(s, 3);
    const c = s.centroid();
    expect(c.x).toBeGreaterThan(0.4);
    expect(c.x).toBeLessThan(0.6);
    expect(s.heightRange().max).toBeLessThan(0.03); // submerged, lying in the tray
    expect(s.maxStretch()).toBeLessThan(0.08);
  });

  test('pins hold the sheet like clips on a drying line', () => {
    const s = sheet();
    s.pin(s.cornerIndex('tl'), { x: -0.12, y: 0.4, z: 0 });
    s.pin(s.cornerIndex('tr'), { x: 0.12, y: 0.4, z: 0 });
    run(s, 3);
    expect(s.vertex(s.cornerIndex('tl')).y).toBeCloseTo(0.4, 5);
    const bottom = s.vertex(s.cornerIndex('bl'));
    expect(bottom.y).toBeLessThan(0.4 - H * 0.8); // hangs under gravity
    s.clearPins();
  });

  test('recovers from a corrupted state instead of exploding', () => {
    const s = sheet();
    run(s, 0.2);
    s.positions[5] = NaN;
    s.step(1 / 60);
    expect(s.recoveryCount).toBe(1);
    for (const v of s.positions) expect(Number.isFinite(v)).toBe(true);
  });

  test('rejects invalid dimensions and ignores non-finite grab targets', () => {
    expect(() => new PaperSim(0, 1, 4, 4)).toThrow();
    const s = sheet();
    s.grabVertex(0, 0.03);
    s.moveGrab({ x: NaN, y: 1, z: 0 });
    run(s, 0.2);
    for (const v of s.positions) expect(Number.isFinite(v)).toBe(true);
  });
});
