import { sampleUV, type GrayImage } from './image.ts';

/**
 * Exposure field: how many seconds of enlarger light each point of the
 * paper's image area has received.
 *
 * Because the enlarger settings are locked once a sheet starts exposing, the
 * paper exposure separates cleanly into
 *     E(x) = lamp · T_projected(x) · seconds(x)
 * so dodging and burning only need to shape this low-resolution time map:
 *   - the base exposure adds dt everywhere,
 *   - a dodging tool held in the beam removes dt · shadow(x) (never below 0,
 *     because a tool can block at most all of the light it is held in),
 *   - a burning card adds dt only through its aperture.
 * Masks are soft (a tool held above the paper casts a penumbra), so a coarse
 * grid upsampled bilinearly is exact enough for full-resolution export.
 */
export type ExposureOp =
  | { kind: 'base'; seconds: number }
  | { kind: 'dodge'; u: number; v: number; radius: number; feather: number; seconds: number }
  | { kind: 'burn'; u: number; v: number; radius: number; feather: number; seconds: number };

export const MAX_FIELD_SECONDS = 180;
const MAX_LOG = 20000;

export interface ToolShape {
  /** centre in image-area UV (0..1, v down) */
  u: number;
  v: number;
  /** radius in units of the image-area *height* */
  radius: number;
  /** penumbra width as a fraction of radius, 0..1 */
  feather: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Shadow/aperture coverage of a disc tool at a point: 1 inside, 0 outside. */
export function discCoverage(du: number, dv: number, aspect: number, radius: number, feather: number): number {
  const d = Math.hypot(du * aspect, dv);
  const f = Math.min(Math.max(feather, 0.02), 1) * radius;
  return 1 - smoothstep(radius - f, radius + f, d);
}

export class ExposureField {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  /** image-area width / height */
  readonly aspect: number;
  private log: ExposureOp[] = [];
  private logOverflow = false;

  constructor(aspect: number, longSide = 256) {
    if (!(aspect > 0) || !Number.isFinite(aspect)) throw new Error('Invalid aspect');
    this.aspect = aspect;
    this.width = aspect >= 1 ? longSide : Math.max(8, Math.round(longSide * aspect));
    this.height = aspect >= 1 ? Math.max(8, Math.round(longSide / aspect)) : longSide;
    this.data = new Float32Array(this.width * this.height);
  }

  get ops(): readonly ExposureOp[] {
    return this.log;
  }

  /** True when the op log was truncated (field data remains authoritative). */
  get isLogTruncated(): boolean {
    return this.logOverflow;
  }

  private record(op: ExposureOp) {
    if (this.log.length < MAX_LOG) this.log.push(op);
    else this.logOverflow = true;
  }

  get totalBaseSeconds(): number {
    let s = 0;
    for (const op of this.log) if (op.kind === 'base') s += op.seconds;
    return s;
  }

  /** Has the sheet received any light at all? */
  get isExposed(): boolean {
    for (let i = 0; i < this.data.length; i += 7) if (this.data[i] > 0) return true;
    return this.data[this.data.length - 1] > 0;
  }

  addBase(seconds: number) {
    if (!(seconds > 0)) return;
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = Math.min(MAX_FIELD_SECONDS, d[i] + seconds);
    this.record({ kind: 'base', seconds });
  }

  /** Apply a disc op over its bounding box only. */
  private applyDisc(shape: ToolShape, seconds: number, sign: 1 | -1) {
    const { width: w, height: h, data: d, aspect } = this;
    const reach = shape.radius * (1 + Math.min(Math.max(shape.feather, 0.02), 1));
    const x0 = Math.max(0, Math.floor((shape.u - reach / aspect) * w));
    const x1 = Math.min(w - 1, Math.ceil((shape.u + reach / aspect) * w));
    const y0 = Math.max(0, Math.floor((shape.v - reach) * h));
    const y1 = Math.min(h - 1, Math.ceil((shape.v + reach) * h));
    for (let y = y0; y <= y1; y++) {
      const v = (y + 0.5) / h;
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5) / w;
        const c = discCoverage(u - shape.u, v - shape.v, aspect, shape.radius, shape.feather);
        if (c <= 0) continue;
        const i = y * w + x;
        d[i] = Math.min(MAX_FIELD_SECONDS, Math.max(0, d[i] + sign * seconds * c));
      }
    }
  }

  /**
   * Dodge for `seconds` of a running base exposure: the tool's shadow holds
   * back light. Call alongside addBase for the same time slice.
   */
  dodge(shape: ToolShape, seconds: number) {
    if (!(seconds > 0) || !validShape(shape)) return;
    this.applyDisc(shape, seconds, -1);
    this.record({ kind: 'dodge', ...shape, seconds });
  }

  /** Burn: extra light only through the card's aperture. */
  burn(shape: ToolShape, seconds: number) {
    if (!(seconds > 0) || !validShape(shape)) return;
    this.applyDisc(shape, seconds, 1);
    this.record({ kind: 'burn', ...shape, seconds });
  }

  /** Seconds of exposure at an image-area UV (bilinear). */
  secondsAt(u: number, v: number): number {
    return sampleUV(this.asImage(), u, v);
  }

  asImage(): GrayImage {
    return { width: this.width, height: this.height, data: this.data };
  }

  reset() {
    this.data.fill(0);
    this.log = [];
    this.logOverflow = false;
  }

  clone(): ExposureField {
    const f = new ExposureField(this.aspect, Math.max(this.width, this.height));
    f.data.set(this.data);
    f.log = this.log.slice();
    f.logOverflow = this.logOverflow;
    return f;
  }

  /** Rebuild a field by replaying an op log — the result is identical. */
  static replay(aspect: number, ops: readonly ExposureOp[], longSide = 256): ExposureField {
    const f = new ExposureField(aspect, longSide);
    for (const op of ops) {
      if (op.kind === 'base') f.addBase(op.seconds);
      else if (op.kind === 'dodge') f.dodge(op, op.seconds);
      else f.burn(op, op.seconds);
    }
    return f;
  }
}

function validShape(s: ToolShape): boolean {
  return [s.u, s.v, s.radius, s.feather].every(Number.isFinite) && s.radius > 0;
}
