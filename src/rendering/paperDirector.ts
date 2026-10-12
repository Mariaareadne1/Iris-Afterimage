import { carryPoint, type CarryPlan } from '../physics/carry.ts';
import type { PaperEnvironment, PaperSim, Vec3 } from '../physics/paper.ts';
import type { SessionState } from '../session/session.ts';
import { STAGE_SECONDS } from '../session/session.ts';
import { BASEBOARD, DRYING_LINE, EASEL, EASEL_TOP, HANG, TRAY, TRAYS, trayById, type TrayDef } from './world.ts';

/**
 * Choreographs the physical sheet through the darkroom from session state:
 * placing it on the easel, carrying it with tongs between trays, and hanging
 * the finished print on the line. All motion goes through the physics grab,
 * so the paper bends, swings and settles on its own.
 */
/** height of the ribs moulded into a tray floor */
export const TRAY_RIB = 0.0024;

type Location = 'hidden' | 'easel' | 'free' | TrayDef['id'] | 'line';

/** Support height under a point anywhere on the bench. */
export function floorAt(x: number, z: number): number {
  for (const t of TRAYS) {
    const dx = Math.abs(x - t.x);
    const dz = Math.abs(z - t.z);
    // prints rest on the tray's floor ribs
    if (dx < TRAY.w / 2 && dz < TRAY.d / 2) return TRAY.floor + TRAY_RIB;
    if (dx < TRAY.w / 2 + TRAY.wall && dz < TRAY.d / 2 + TRAY.wall) return TRAY.h;
  }
  if (Math.abs(x - EASEL.x) < EASEL.w / 2 && Math.abs(z - EASEL.z) < EASEL.d / 2) return EASEL_TOP;
  if (Math.abs(x - BASEBOARD.x) < BASEBOARD.w / 2 && Math.abs(z - BASEBOARD.z) < BASEBOARD.d / 2) return BASEBOARD.h;
  return 0;
}

export function trayEnv(def: TrayDef, liquid = true): PaperEnvironment {
  const m = 0.004;
  return {
    floorAt,
    bounds: { minX: def.x - TRAY.w / 2 + m, maxX: def.x + TRAY.w / 2 - m, minZ: def.z - TRAY.d / 2 + m, maxZ: def.z + TRAY.d / 2 - m },
    liquidLevel: liquid ? TRAY.liquid : null,
  };
}

export const OPEN_ENV: PaperEnvironment = { floorAt, bounds: null, liquidLevel: null };

/** Which tray (if any) a point is over. */
export function trayAt(x: number, z: number, margin = 0): TrayDef | null {
  for (const t of TRAYS) {
    if (Math.abs(x - t.x) < TRAY.w / 2 + margin && Math.abs(z - t.z) < TRAY.d / 2 + margin) return t;
  }
  return null;
}

interface ActiveCarry {
  plan: CarryPlan;
  duration: number;
  start: number;
  /** tray whose walls/liquid apply once the sheet is over it */
  dest: TrayDef | null;
  /** destination walls already applied */
  arrived?: boolean;
  onDone: () => void;
}

export class PaperDirector {
  location: Location = 'hidden';
  /** the sheet is in the user's hands */
  userHolding = false;
  private carry: ActiveCarry | null = null;
  private time = 0;
  private hangStarted = false;
  /** fired when a sheet lands in a tray: [tray, edge line] for ripples */
  onSplash: ((tray: TrayDef, strength: number) => void) | null = null;

  constructor(private getSim: () => PaperSim) {}

  get sim(): PaperSim {
    return this.getSim();
  }

  get visible(): boolean {
    return this.location !== 'hidden';
  }

  get carrying(): boolean {
    return this.carry !== null;
  }

  /** Put a fresh sheet back in the paper safe. */
  reset() {
    this.carry = null;
    this.slide = null;
    this.settle = null;
    this.userHolding = false;
    this.hangStarted = false;
    this.location = 'hidden';
    this.sim.endGrab();
    this.sim.clearPins();
    this.sim.env = OPEN_ENV;
  }

  /** Lay the sheet registered on the easel. */
  snapToEasel() {
    this.carry = null;
    this.slide = null;
    this.sim.endGrab();
    this.sim.clearPins();
    this.sim.env = OPEN_ENV;
    this.sim.placeFlat({ x: EASEL.x, y: EASEL_TOP + 0.0015, z: EASEL.z });
    this.location = 'easel';
  }

  private startCarry(gripIndex: number, to: Vec3, layDir: { x: number; z: number }, length: number, duration: number, dest: TrayDef | null, onDone: () => void) {
    const sim = this.sim;
    sim.clearPins();
    // lifting out of a tray: its walls no longer apply
    sim.env = OPEN_ENV;
    this.settle = null;
    const from = sim.vertex(gripIndex);
    sim.endGrab();
    sim.grabVertex(gripIndex, 0.02);
    this.carry = {
      plan: { from, to, layDir, length, clearance: dest ? 0.2 : 0.12 },
      duration,
      start: this.time,
      dest,
      onDone,
    };
    this.userHolding = false;
  }

  /** Slide a new sheet from the paper safe (off-screen front) onto the easel. */
  beginPlacing() {
    const sim = this.sim;
    sim.clearPins();
    sim.endGrab();
    sim.env = OPEN_ENV;
    this.carry = null;
    this.location = 'free';
    this.slide = { start: this.time, duration: STAGE_SECONDS.place * 0.9 };
  }

  /** pressing a sheet flat in a tray after it lands */
  private settle: { center: Vec3; yaw: number; until: number } | null = null;

  /** Press the sheet flat where it lies in its tray (keeps it inside the walls). */
  settleInTray(def: TrayDef, duration = 1.4, centre = false) {
    const c = centre ? { x: def.x, y: 0, z: def.z } : this.sim.centroid();
    const m = 0.012;
    const hx = def.x - TRAY.w / 2 + this.sim.width / 2 + m;
    const hx2 = def.x + TRAY.w / 2 - this.sim.width / 2 - m;
    const hz = def.z - TRAY.d / 2 + this.sim.height / 2 + m;
    const hz2 = def.z + TRAY.d / 2 - this.sim.height / 2 - m;
    // a quarter-turned sheet would not fit: keep it near-square to the tray
    let yaw = this.sim.yaw();
    yaw = Math.abs(yaw) < 0.35 ? yaw : 0;
    this.settle = {
      center: { x: Math.min(Math.max(c.x, hx), Math.max(hx, hx2)), y: TRAY.floor + TRAY_RIB + 0.0013, z: Math.min(Math.max(c.z, hz), Math.max(hz, hz2)) },
      yaw,
      until: this.time + duration,
    };
  }

  /** kinematic slide used for placing: a flat sheet glides into registration */
  private slide: { start: number; duration: number } | null = null;

  /** Carry with tongs into a tray (gripping the left edge, laying out to +x). */
  beginTransfer(to: TrayDef['id'], duration: number) {
    const def = trayById(to);
    const sim = this.sim;
    this.settle = null;
    this.startCarry(sim.edgeMidIndex('left'), { x: def.x, y: TRAY.floor, z: def.z }, { x: 1, z: 0 }, sim.width, duration, def, () => {
      this.location = def.id;
      this.onSplash?.(def, 1);
      this.settleInTray(def, 1.4, true);
    });
  }

  /** Lift the finished print by its top edge and hang it on the line. */
  beginHang() {
    if (this.hangStarted) return;
    this.hangStarted = true;
    this.settle = null;
    const sim = this.sim;
    const grip = sim.edgeMidIndex('top');
    sim.clearPins();
    const from = sim.vertex(grip);
    sim.endGrab();
    sim.grabVertex(grip, 0.02);
    sim.env = OPEN_ENV;
    const to = { x: HANG.x, y: HANG.y - 0.008, z: HANG.z };
    const mid = { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + 0.12, z: (from.z + to.z) / 2 + 0.05 };
    const duration = 2.2;
    const start = this.time;
    this.carry = {
      plan: { from, to, layDir: { x: 0, z: 1 }, length: 0, clearance: 0 },
      duration,
      start,
      dest: null,
      onDone: () => {
        // two clothes-pegs at the top corners
        const tl = sim.cornerIndex('tl');
        const tr = sim.cornerIndex('tr');
        const half = sim.width / 2 - 0.003;
        sim.endGrab();
        sim.pin(tl, { x: HANG.x - half, y: DRYING_LINE.y - 0.006, z: HANG.z });
        sim.pin(tr, { x: HANG.x + half, y: DRYING_LINE.y - 0.006, z: HANG.z });
        this.location = 'line';
      },
    };
    // custom path: arc up and over (not the lay-down path)
    this.hangPath = (t: number) => {
      const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const a = { x: from.x + (mid.x - from.x) * k, y: from.y + (mid.y - from.y) * Math.min(1, k * 1.5), z: from.z + (mid.z - from.z) * k };
      const b = { x: mid.x + (to.x - mid.x) * k, y: mid.y + (to.y - mid.y) * k, z: mid.z + (to.z - mid.z) * k };
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    };
  }

  private hangPath: ((t: number) => Vec3) | null = null;

  /** React to session state changes. */
  sync(prev: SessionState | null, s: SessionState) {
    if (prev?.paper !== s.paper || prev?.stage !== s.stage) {
      if (s.paper === 'safe' && (s.stage === 'enlarger' || s.stage === 'intro')) this.reset();
      if (s.paper === 'placing' && prev?.paper !== 'placing') this.beginPlacing();
      if (s.paper === 'easel' && prev?.paper === 'placing' && this.location !== 'easel') this.snapToEasel();
    }
    if (prev?.stage === s.stage) return;
    const dur = (sec: number) => sec * 0.8;
    switch (s.stage) {
      case 'transfer':
        this.beginTransfer('developer', dur(STAGE_SECONDS.transfer) / 0.8 * 0.95);
        break;
      case 'stop':
        this.beginTransfer('stop', dur(STAGE_SECONDS.stop));
        break;
      case 'fix':
        this.beginTransfer('fix', dur(STAGE_SECONDS.fix) * 0.7);
        break;
      case 'finished':
        if (this.location !== 'hidden') this.beginHang();
        break;
      default:
        break;
    }
  }

  /** Advance carries (in simulated seconds). */
  update(dt: number) {
    this.time += dt;
    if (this.slide) {
      const t = Math.min(1, (this.time - this.slide.start) / this.slide.duration);
      const k = 1 - Math.pow(1 - t, 3);
      this.sim.placeFlat({ x: EASEL.x, y: EASEL_TOP + 0.0015 + Math.sin(Math.PI * k) * 0.025, z: EASEL.z + 0.45 * (1 - k) });
      if (t >= 1) {
        this.slide = null;
        this.snapToEasel();
      }
      return;
    }
    if (this.settle && !this.userHolding && !this.carry) {
      const remaining = this.settle.until - this.time;
      this.sim.blendToFlat(this.settle.center, this.settle.yaw, Math.min(1, dt * 3.2));
      if (remaining <= 0) this.settle = null;
    }
    const c = this.carry;
    if (!c) return;
    const t = Math.min(1, (this.time - c.start) / c.duration);
    const p = this.hangPath && c.plan.length === 0 ? this.hangPath(t) : carryPoint(c.plan, t);
    this.sim.moveGrab(p);
    if (c.dest && t > 0.45 && !c.arrived) {
      c.arrived = true;
      this.sim.env = trayEnv(c.dest);
      this.location = 'free';
    }
    if (t >= 1) {
      this.carry = null;
      if (c.plan.length !== 0) this.sim.endGrab();
      else this.hangPath = null;
      c.onDone();
    }
  }

  /** Can the user pick the sheet up right now? */
  canUserGrab(s: SessionState): boolean {
    if (this.carry || !this.visible) return false;
    if (s.stage === 'enlarger') return s.paper === 'easel' && s.lamp.mode === 'off' && s.locked;
    return s.stage === 'developing' || s.stage === 'finished';
  }

  /** Constrain a user's grab target to the current situation. */
  constrainTarget(s: SessionState, p: Vec3): Vec3 {
    if (s.stage === 'developing') {
      const d = trayById('developer');
      return {
        x: Math.min(Math.max(p.x, d.x - TRAY.w / 2 + 0.03), d.x + TRAY.w / 2 - 0.03),
        y: Math.min(Math.max(p.y, TRAY.floor + 0.004), TRAY.liquid + 0.05),
        z: Math.min(Math.max(p.z, d.z - TRAY.d / 2 + 0.03), d.z + TRAY.d / 2 - 0.03),
      };
    }
    return { x: p.x, y: Math.max(p.y, 0.004), z: p.z };
  }

  /** The user let go of the sheet. Returns the tray it was dropped over, if any. */
  userRelease(): TrayDef | null {
    this.userHolding = false;
    const c = this.sim.centroid();
    this.sim.endGrab();
    const tray = trayAt(c.x, c.z, 0.02);
    if (this.location !== 'line' && tray) {
      // let it fall in, kept inside the walls, and lie down flat
      if (this.sim.env.bounds === null) this.sim.env = trayEnv(tray);
      this.settleInTray(tray, 1.2);
    }
    return tray;
  }
}
