/**
 * Photographic paper as a stiff Verlet sheet.
 *
 * Adapted from the cloth simulation in Iris (src/cloth.ts), itself adapted
 * from Holocloth by Dmitry Kurash (MIT). Kept: flat-array Verlet
 * integration, structural/shear/bend distance constraints solved by
 * relaxation, smooth-weighted grabbing with per-vertex offsets, fixed
 * substeps. Changed for paper:
 *   - gravity and real-world scale (metres), so the sheet has weight,
 *   - much stiffer bending (2-, 3- and 4-cell bend constraints) and more
 *     solver iterations, so it flexes like card stock rather than silk,
 *   - a slight rest curl at the edges (fibre paper never lies dead flat),
 *   - collisions with the bench / easel / tray floors, tray walls, friction,
 *   - liquid: buoyancy and heavy drag below the developer surface,
 *   - hard pins (clips on a drying line) and a NaN/explosion guard,
 *   - long-range attachment tethers (Kim, Chentanez & Müller 2012) from
 *     every held point, so a sheet hanging from one corner does not stretch.
 * Texture coordinates come from the fixed grid topology, so the image can
 * never slide on the sheet.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PaperParams {
  gravity: number;
  /** velocity damping per 60 Hz frame in air */
  airDamping: number;
  /** velocity damping per 60 Hz frame below the liquid surface */
  liquidDamping: number;
  /** fraction of gravity left when submerged (paper is barely denser than water) */
  submergedGravity: number;
  /** constraint relaxation iterations per substep */
  iterations: number;
  /** tangential friction on contact 0..1 */
  friction: number;
  /** edge curl strength 0..~0.02 */
  curl: number;
}

export const DEFAULT_PAPER_PARAMS: PaperParams = {
  gravity: 9.81,
  airDamping: 0.035,
  liquidDamping: 0.22,
  submergedGravity: 0.12,
  iterations: 18,
  friction: 0.6,
  curl: 0.006,
};

/** Where the sheet currently lives: floor heights, walls and liquid. */
export interface PaperEnvironment {
  /** support height under a point (bench, easel, tray floor) */
  floorAt(x: number, z: number): number;
  /** optional container walls the sheet must stay inside */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  /** liquid surface height, or null when dry */
  liquidLevel: number | null;
}

export const FLAT_GROUND: PaperEnvironment = { floorAt: () => 0, bounds: null, liquidLevel: null };

const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 4;
const THICKNESS = 0.0012;
const MAX_EXTENT = 20;
/** max distance a vertex may travel per substep (≈ 6 m/s) */
const MAX_STEP = 0.05;

interface GrabState {
  indices: Int32Array;
  weights: Float32Array;
  offsets: Float32Array;
  target: Vec3;
}

export class PaperSim {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly positions: Float32Array;
  private prev: Float32Array;
  private safe: Float32Array;
  private cA: Int32Array;
  private cB: Int32Array;
  private cRest: Float32Array;
  private cMul: Float32Array;
  private structuralStart: number;
  private grab: GrabState | null = null;
  private pins = new Map<number, Vec3>();
  /** tether anchors: [vertex index, rest distance per vertex] */
  private tethers: { anchor: number; rest: Float32Array }[] = [];
  private accumulator = 0;
  private recoveries = 0;
  env: PaperEnvironment = FLAT_GROUND;
  params: PaperParams = { ...DEFAULT_PAPER_PARAMS };

  /**
   * @param width  sheet width in metres (local x)
   * @param height sheet height in metres (local z, image "down" = +z)
   */
  constructor(
    readonly width: number,
    readonly height: number,
    readonly segX: number,
    readonly segY: number,
  ) {
    if (!(width > 0 && height > 0 && segX >= 2 && segY >= 2)) throw new Error('Invalid paper dimensions');
    this.cols = segX + 1;
    this.rows = segY + 1;
    this.count = this.cols * this.rows;
    this.positions = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.safe = new Float32Array(this.count * 3);

    const a: number[] = [];
    const b: number[] = [];
    const mul: number[] = [];
    const idx = (x: number, y: number) => y * this.cols + x;
    const add = (i: number, j: number, m: number) => {
      a.push(i);
      b.push(j);
      mul.push(m);
    };
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (x + 1 < this.cols) add(idx(x, y), idx(x + 1, y), 1);
        if (y + 1 < this.rows) add(idx(x, y), idx(x, y + 1), 1);
        if (x + 1 < this.cols && y + 1 < this.rows) {
          add(idx(x, y), idx(x + 1, y + 1), 0.9);
          add(idx(x + 1, y), idx(x, y + 1), 0.9);
        }
        // bending: paper resists it far more than cloth does
        for (const [span, m] of [[2, 0.9], [3, 0.6], [4, 0.45]] as const) {
          if (x + span < this.cols) add(idx(x, y), idx(x + span, y), m);
          if (y + span < this.rows) add(idx(x, y), idx(x, y + span), m);
        }
      }
    }
    // Solve order matters: bend constraints first, structural last, so that
    // in a sharp fold the sheet bends instead of stretching.
    const order = mul.map((_, i) => i).sort((i, j) => mul[i] - mul[j]);
    this.cA = new Int32Array(order.map((i) => a[i]));
    this.cB = new Int32Array(order.map((i) => b[i]));
    this.cMul = new Float32Array(order.map((i) => mul[i]));
    this.structuralStart = order.findIndex((i) => mul[i] === 1);
    this.cRest = new Float32Array(a.length);
    this.computeRestLengths();
    this.placeFlat({ x: 0, y: 0, z: 0 });
  }

  /** Rest lengths from the flat grid, shortened slightly near edges for curl. */
  private computeRestLengths() {
    const sx = this.width / this.segX;
    const sy = this.height / this.segY;
    const curl = this.params.curl;
    for (let c = 0; c < this.cA.length; c++) {
      const ia = this.cA[c];
      const ib = this.cB[c];
      const ax = ia % this.cols, ay = Math.floor(ia / this.cols);
      const bx = ib % this.cols, by = Math.floor(ib / this.cols);
      let len = Math.hypot((ax - bx) * sx, (ay - by) * sy);
      const span = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
      if (span >= 2 && curl > 0) {
        // distance from the nearest edge along the constraint's axis
        const horizontal = ay === by;
        const edgeDist = horizontal
          ? Math.min(ax, bx, this.segX - Math.max(ax, bx))
          : Math.min(ay, by, this.segY - Math.max(ay, by));
        const edgeFactor = Math.max(0, 1 - edgeDist / 3);
        len *= 1 - curl * edgeFactor * span * 0.5;
      }
      this.cRest[c] = len;
    }
  }

  setCurl(curl: number) {
    this.params = { ...this.params, curl: Math.min(Math.max(curl, 0), 0.03) };
    this.computeRestLengths();
  }

  /** Lay the sheet flat, centred at `center`, rotated `yaw` radians about +y. No velocity. */
  placeFlat(center: Vec3, yaw = 0) {
    const sx = this.width / this.segX;
    const sy = this.height / this.segY;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let k = 0;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const lx = (x - this.segX / 2) * sx;
        const lz = (y - this.segY / 2) * sy;
        this.positions[k] = center.x + lx * c + lz * s;
        // seed the edge curl upward so it can break symmetry and lift
        const edge = Math.min(x, y, this.segX - x, this.segY - y);
        const lift = Math.max(0, 1 - edge / 2.5);
        this.positions[k + 1] = center.y + lift * lift * this.params.curl * 0.4;
        this.positions[k + 2] = center.z - lx * s + lz * c;
        k += 3;
      }
    }
    this.prev.set(this.positions);
    this.safe.set(this.positions);
    this.grab = null;
    this.grabAnchor = -1;
    this.rebuildTethers();
    this.accumulator = 0;
  }

  /** Grid index of a corner: 'tl','tr','bl','br' (t = row 0). */
  cornerIndex(corner: 'tl' | 'tr' | 'bl' | 'br'): number {
    const x = corner[1] === 'l' ? 0 : this.segX;
    const y = corner[0] === 't' ? 0 : this.segY;
    return y * this.cols + x;
  }

  /** Grid index of the middle of an edge — where print tongs grip. */
  edgeMidIndex(edge: 'left' | 'right' | 'top' | 'bottom'): number {
    const midX = Math.round(this.segX / 2);
    const midY = Math.round(this.segY / 2);
    if (edge === 'left') return midY * this.cols;
    if (edge === 'right') return midY * this.cols + this.segX;
    if (edge === 'top') return midX;
    return this.segY * this.cols + midX;
  }

  vertex(i: number): Vec3 {
    const p = this.positions;
    return { x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] };
  }

  centroid(): Vec3 {
    const p = this.positions;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < this.count; i++) {
      x += p[i * 3];
      y += p[i * 3 + 1];
      z += p[i * 3 + 2];
    }
    return { x: x / this.count, y: y / this.count, z: z / this.count };
  }

  /**
   * Begin a grab around a world point. Returns false if the sheet is not
   * within `radius`. Tongs and fingertips hold a small *rigid* spot: the
   * nearest vertex plus any within half the radius. (A soft weighted falloff,
   * as the original cloth used, fights the constraints and stretches paper.)
   */
  startGrab(point: Vec3, radius: number): boolean {
    const p = this.positions;
    let nearest = -1;
    let nearestD = Infinity;
    const dist = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const d = Math.hypot(p[i * 3] - point.x, p[i * 3 + 1] - point.y, p[i * 3 + 2] - point.z);
      dist[i] = d;
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
    }
    if (nearest < 0 || nearestD > radius) return false;
    const indices: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (i !== nearest && dist[i] > radius * 0.5) continue;
      indices.push(i);
      offsets.push(p[i * 3] - point.x, p[i * 3 + 1] - point.y, p[i * 3 + 2] - point.z);
    }
    this.grabAnchor = nearest;
    this.grab = {
      indices: new Int32Array(indices),
      weights: new Float32Array(indices.length).fill(1),
      offsets: new Float32Array(offsets),
      target: { ...point },
    };
    this.rebuildTethers();
    return true;
  }

  /** Grab a specific vertex (e.g. a corner, like print tongs). */
  grabVertex(index: number, radius: number): boolean {
    return this.startGrab(this.vertex(index), radius);
  }

  moveGrab(target: Vec3) {
    if (this.grab && [target.x, target.y, target.z].every(Number.isFinite)) this.grab.target = { ...target };
  }

  get grabTarget(): Vec3 | null {
    return this.grab ? { ...this.grab.target } : null;
  }

  endGrab() {
    this.grab = null;
    this.grabAnchor = -1;
    this.rebuildTethers();
  }

  private grabAnchor = -1;

  /** Rest (flat-grid) distance from an anchor vertex to every vertex. */
  private restDistances(anchor: number): Float32Array {
    const sx = this.width / this.segX;
    const sy = this.height / this.segY;
    const ax = anchor % this.cols;
    const ay = Math.floor(anchor / this.cols);
    const out = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = Math.hypot(((i % this.cols) - ax) * sx, (Math.floor(i / this.cols) - ay) * sy);
    }
    return out;
  }

  private rebuildTethers() {
    const anchors = new Set<number>(this.pins.keys());
    if (this.grabAnchor >= 0) anchors.add(this.grabAnchor);
    if (this.grab) for (const i of this.grab.indices) anchors.add(i);
    this.tethers = [...anchors].map((anchor) => ({ anchor, rest: this.restDistances(anchor) }));
  }

  private applyTethers() {
    const p = this.positions;
    for (const t of this.tethers) {
      const a = t.anchor * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        const dx = p[k] - ax, dy = p[k + 1] - ay, dz = p[k + 2] - az;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const r = t.rest[i] * 1.01;
        if (d <= r || d < 1e-9) continue;
        const f = (d - r) / d;
        p[k] -= dx * f; p[k + 1] -= dy * f; p[k + 2] -= dz * f;
      }
    }
  }

  get isGrabbing(): boolean {
    return this.grab !== null;
  }

  pin(index: number, at: Vec3) {
    if (index < 0 || index >= this.count) return;
    this.pins.set(index, { ...at });
    this.rebuildTethers();
  }

  clearPins() {
    this.pins.clear();
    this.rebuildTethers();
  }

  get recoveryCount(): number {
    return this.recoveries;
  }

  step(dt: number) {
    if (!(dt > 0)) return;
    this.accumulator += Math.min(dt, 0.05);
    let steps = 0;
    while (this.accumulator >= SUBSTEP && steps < MAX_SUBSTEPS) {
      this.substep();
      this.accumulator -= SUBSTEP;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    this.guard();
  }

  private substep() {
    const p = this.positions;
    const prev = this.prev;
    const n = this.count;
    const prm = this.params;
    const liquid = this.env.liquidLevel;
    const airDamp = Math.pow(1 - prm.airDamping, SUBSTEP * 60);
    const liqDamp = Math.pow(1 - prm.liquidDamping, SUBSTEP * 60);
    const g = prm.gravity * SUBSTEP * SUBSTEP;

    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const submerged = liquid !== null && p[k + 1] < liquid;
      const damp = submerged ? liqDamp : airDamp;
      const gy = submerged ? g * prm.submergedGravity : g;
      for (let c = 0; c < 3; c++) {
        const cur = p[k + c];
        let vel = (cur - prev[k + c]) * damp;
        if (vel > MAX_STEP) vel = MAX_STEP;
        else if (vel < -MAX_STEP) vel = -MAX_STEP;
        prev[k + c] = cur;
        p[k + c] = cur + vel - (c === 1 ? gy : 0);
      }
    }

    const iters = Math.max(1, Math.round(prm.iterations));
    const { cA, cB, cRest, cMul } = this;
    const nc = cA.length;
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < nc; c++) {
        const ia = cA[c] * 3, ib = cB[c] * 3;
        const dx = p[ib] - p[ia];
        const dy = p[ib + 1] - p[ia + 1];
        const dz = p[ib + 2] - p[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const diff = ((d - cRest[c]) / d) * 0.5 * cMul[c];
        const ox = dx * diff, oy = dy * diff, oz = dz * diff;
        p[ia] += ox; p[ia + 1] += oy; p[ia + 2] += oz;
        p[ib] -= ox; p[ib + 1] -= oy; p[ib + 2] -= oz;
      }
      this.applyGrab();
      this.applyPins();
      this.applyTethers();
      this.collide();
    }
    // strain limiting: two structural-only passes keep the image unstretched
    for (let pass = 0; pass < 2; pass++) {
      for (let c = this.structuralStart; c < nc; c++) {
        const ia = cA[c] * 3, ib = cB[c] * 3;
        const dx = p[ib] - p[ia];
        const dy = p[ib + 1] - p[ia + 1];
        const dz = p[ib + 2] - p[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const diff = ((d - cRest[c]) / d) * 0.5;
        const ox = dx * diff, oy = dy * diff, oz = dz * diff;
        p[ia] += ox; p[ia + 1] += oy; p[ia + 2] += oz;
        p[ib] -= ox; p[ib + 1] -= oy; p[ib + 2] -= oz;
      }
      this.applyGrab();
      this.applyPins();
    }
  }

  private applyGrab() {
    const g = this.grab;
    if (!g) return;
    const p = this.positions;
    for (let k = 0; k < g.indices.length; k++) {
      const i = g.indices[k] * 3;
      const w = g.weights[k];
      p[i] += (g.target.x + g.offsets[k * 3] - p[i]) * w;
      p[i + 1] += (g.target.y + g.offsets[k * 3 + 1] - p[i + 1]) * w;
      p[i + 2] += (g.target.z + g.offsets[k * 3 + 2] - p[i + 2]) * w;
    }
  }

  private applyPins() {
    const p = this.positions;
    for (const [i, at] of this.pins) {
      p[i * 3] = at.x;
      p[i * 3 + 1] = at.y;
      p[i * 3 + 2] = at.z;
    }
  }

  private collide() {
    const p = this.positions;
    const prev = this.prev;
    const env = this.env;
    const b = env.bounds;
    const fr = this.params.friction;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      if (b) {
        if (p[k] < b.minX) p[k] = b.minX;
        else if (p[k] > b.maxX) p[k] = b.maxX;
        if (p[k + 2] < b.minZ) p[k + 2] = b.minZ;
        else if (p[k + 2] > b.maxZ) p[k + 2] = b.maxZ;
      }
      const floor = env.floorAt(p[k], p[k + 2]) + THICKNESS;
      if (p[k + 1] < floor) {
        p[k + 1] = floor;
        // friction: bleed tangential velocity while in contact
        prev[k] += (p[k] - prev[k]) * fr;
        prev[k + 2] += (p[k + 2] - prev[k + 2]) * fr;
        if (prev[k + 1] < floor) prev[k + 1] = floor;
      }
    }
  }

  /** Recover from numerical blow-ups instead of letting the sheet vanish. */
  private guard() {
    const p = this.positions;
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (!Number.isFinite(v) || Math.abs(v) > MAX_EXTENT) {
        ok = false;
        break;
      }
    }
    if (ok) {
      this.safe.set(p);
      return;
    }
    this.recoveries++;
    p.set(this.safe);
    this.prev.set(this.safe);
    this.grab = null;
    this.grabAnchor = -1;
    this.rebuildTethers();
  }

  /** Largest relative stretch of any structural edge — 0 means perfectly inextensible. */
  maxStretch(): number {
    const p = this.positions;
    let worst = 0;
    for (let c = 0; c < this.cA.length; c++) {
      if (this.cMul[c] !== 1) continue; // structural only
      const ia = this.cA[c] * 3, ib = this.cB[c] * 3;
      const d = Math.hypot(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
      worst = Math.max(worst, Math.abs(d / this.cRest[c] - 1));
    }
    return worst;
  }

  /** Kinetic proxy: mean per-vertex displacement over the last substep. */
  motion(): number {
    let s = 0;
    for (let i = 0; i < this.positions.length; i++) s += Math.abs(this.positions[i] - this.prev[i]);
    return s / this.count;
  }

  heightRange(): { min: number; max: number } {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const y = this.positions[i * 3 + 1];
      if (y < min) min = y;
      if (y > max) max = y;
    }
    return { min, max };
  }
}
