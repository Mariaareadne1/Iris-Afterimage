import type { Vec3 } from './paper.ts';

/**
 * Choreography for moving a sheet with tongs: lift it clear, swing it over
 * the destination, then lower it while drawing the hand back so the sheet
 * lays itself down flat (the way a printer slides a print into a tray).
 */
export interface CarryPlan {
  /** where the tongs grip at the start */
  from: Vec3;
  /** where the sheet's centre should end up (on the destination floor) */
  to: Vec3;
  /** unit direction (in xz) the sheet should lie out along from the grip */
  layDir: { x: number; z: number };
  /** length of the sheet along layDir */
  length: number;
  /** clearance height above the destination floor */
  clearance: number;
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Grip position at normalised time t ∈ [0,1]. */
export function carryPoint(plan: CarryPlan, t: number): Vec3 {
  const u = Math.min(Math.max(t, 0), 1);
  const { from, to, layDir, length, clearance } = plan;
  // over the destination, the hanging sheet's foot is below the grip, so
  // start lowering with the grip pushed forward along layDir...
  const overX = to.x + layDir.x * length * 0.15;
  const overZ = to.z + layDir.z * length * 0.15;
  const high = Math.max(from.y, to.y) + clearance;
  // ...and finish with the grip at the near edge of the sheet's final place
  const endX = to.x - layDir.x * (length / 2 - 0.01);
  const endZ = to.z - layDir.z * (length / 2 - 0.01);
  const endY = to.y + 0.012;

  if (u < 0.45) {
    const k = ease(u / 0.45);
    const arc = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.02;
    return { x: lerp(from.x, overX, k), y: lerp(from.y, high, Math.min(1, k * 1.6)) + arc, z: lerp(from.z, overZ, k) };
  }
  const k = ease((u - 0.45) / 0.55);
  return { x: lerp(overX, endX, k), y: lerp(high, endY, Math.pow(k, 0.8)), z: lerp(overZ, endZ, k) };
}
