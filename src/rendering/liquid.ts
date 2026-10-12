import * as THREE from 'three';

/**
 * A shallow tray of liquid: a small 2D wave-equation height field on the CPU
 * driving a displaced, refractive surface. Cheap (≈5k cells), stable, and
 * enough to sell a paper sliding in, a fingertip, or a rocked tray.
 */
export interface LiquidOptions {
  width: number;
  depth: number;
  /** grid cells along the width */
  resolution?: number;
  color?: THREE.ColorRepresentation;
  attenuation?: THREE.ColorRepresentation;
  transmission?: boolean;
}

const WAVE_SPEED = 0.55; // m/s — shallow water, slowed for readability
const DAMPING = 1.6; // per second
const MAX_H = 0.006;

export class LiquidSurface {
  readonly mesh: THREE.Mesh;
  readonly nx: number;
  readonly nz: number;
  private h: Float32Array;
  private v: Float32Array;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshPhysicalMaterial;
  /** global tilt slosh (for rocking): offset of surface slope */
  private sloshX = 0;
  private sloshZ = 0;
  private sloshVX = 0;
  private sloshVZ = 0;
  private time = 0;

  constructor(readonly opts: LiquidOptions) {
    this.nx = opts.resolution ?? 72;
    this.nz = Math.max(8, Math.round((this.nx * opts.depth) / opts.width));
    this.h = new Float32Array(this.nx * this.nz);
    this.v = new Float32Array(this.nx * this.nz);
    this.geometry = new THREE.PlaneGeometry(opts.width, opts.depth, this.nx - 1, this.nz - 1);
    this.geometry.rotateX(-Math.PI / 2);
    const transmission = opts.transmission !== false;
    this.material = new THREE.MeshPhysicalMaterial({
      color: opts.color ?? 0xffffff,
      roughness: 0.085,
      metalness: 0,
      ior: 1.333,
      transmission: transmission ? 1 : 0,
      thickness: 0.012,
      attenuationColor: new THREE.Color(opts.attenuation ?? 0xfff3dd),
      attenuationDistance: 0.25,
      transparent: !transmission,
      opacity: transmission ? 1 : 0.28,
      specularIntensity: 0.55,
      envMapIntensity: 0.8,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
  }

  setTransmission(on: boolean) {
    this.material.transmission = on ? 1 : 0;
    this.material.transparent = !on;
    this.material.opacity = on ? 1 : 0.28;
    this.material.needsUpdate = true;
  }

  /** Disturb the surface at local coordinates (metres from the tray centre). */
  disturb(x: number, z: number, radius: number, strength: number) {
    const { nx, nz, opts } = this;
    const cx = (x / opts.width + 0.5) * (nx - 1);
    const cz = (z / opts.depth + 0.5) * (nz - 1);
    const r = Math.max(1, (radius / opts.width) * (nx - 1));
    const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(nx - 2, Math.ceil(cx + r));
    const z0 = Math.max(1, Math.floor(cz - r)), z1 = Math.min(nz - 2, Math.ceil(cz + r));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - cx, j - cz) / r;
        if (d >= 1) continue;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
        this.v[j * nx + i] -= strength * w;
      }
    }
  }

  /** A line of disturbance — the edge of a sheet entering the liquid. */
  disturbLine(x0: number, z0: number, x1: number, z1: number, strength: number) {
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      this.disturb(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.02, strength / steps * 2);
    }
  }

  /** Rock the tray: impulse to the surface slope along x/z (slope per second). */
  rock(ix: number, iz: number) {
    this.sloshVX += ix;
    this.sloshVZ += iz;
    // waves bounce off the near walls
    const { opts } = this;
    if (Math.abs(ix) > 1e-4) this.disturbLine(-opts.width * 0.48 * Math.sign(ix), -opts.depth * 0.45, -opts.width * 0.48 * Math.sign(ix), opts.depth * 0.45, Math.abs(ix) * 0.6);
    if (Math.abs(iz) > 1e-4) this.disturbLine(-opts.width * 0.45, -opts.depth * 0.48 * Math.sign(iz), opts.width * 0.45, -opts.depth * 0.48 * Math.sign(iz), Math.abs(iz) * 0.6);
  }

  /** Mean surface energy — exposed for tests and agitation feedback. */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.v.length; i++) e += this.v[i] * this.v[i] + this.h[i] * this.h[i] * 50;
    return e / this.v.length + this.sloshVX * this.sloshVX + this.sloshVZ * this.sloshVZ;
  }

  step(dt: number) {
    const d = Math.min(dt, 1 / 30);
    this.time += d;
    const { nx, nz, h, v, opts } = this;
    const dx = opts.width / (nx - 1);
    // CFL-safe substeps
    const sub = Math.max(1, Math.ceil((WAVE_SPEED * d) / (dx * 0.5)));
    const sdt = d / sub;
    const c2 = (WAVE_SPEED * WAVE_SPEED) / (dx * dx);
    const damp = Math.exp(-DAMPING * sdt);
    for (let s = 0; s < sub; s++) {
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          const lap = h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx] - 4 * h[k];
          v[k] = (v[k] + lap * c2 * sdt) * damp;
        }
      }
      for (let k = 0; k < h.length; k++) h[k] = Math.max(-MAX_H, Math.min(MAX_H, h[k] + v[k] * sdt));
      // reflective walls
      for (let i = 0; i < nx; i++) {
        h[i] = h[i + nx];
        h[(nz - 1) * nx + i] = h[(nz - 2) * nx + i];
      }
      for (let j = 0; j < nz; j++) {
        h[j * nx] = h[j * nx + 1];
        h[j * nx + nx - 1] = h[j * nx + nx - 2];
      }
    }
    // slosh: damped spring on the tilt of the whole surface
    // (≈1.2 Hz, a shallow tray's fundamental slosh)
    const k = 60, c = 2.4;
    this.sloshVX += (-k * this.sloshX - c * this.sloshVX) * d;
    this.sloshVZ += (-k * this.sloshZ - c * this.sloshVZ) * d;
    this.sloshX = Math.max(-0.05, Math.min(0.05, this.sloshX + this.sloshVX * d));
    this.sloshZ = Math.max(-0.05, Math.min(0.05, this.sloshZ + this.sloshVZ * d));
    this.writeGeometry();
  }

  private writeGeometry() {
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const nrm = this.geometry.attributes.normal as THREE.BufferAttribute;
    const { nx, nz, h, opts } = this;
    const dx = opts.width / (nx - 1);
    const dz = opts.depth / (nz - 1);
    const t = this.time;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = (i / (nx - 1) - 0.5) * opts.width;
        const z = (j / (nz - 1) - 0.5) * opts.depth;
        // tiny always-on shimmer keeps the surface alive under the safelight
        const shimmer = Math.sin(x * 61 + t * 1.3) * Math.sin(z * 53 - t * 1.1) * 0.00012;
        pos.setY(k, h[k] + this.sloshX * x + this.sloshZ * z + shimmer);
        const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)];
        const hd = h[Math.max(0, j - 1) * nx + i], hu = h[Math.min(nz - 1, j + 1) * nx + i];
        const gx = (hr - hl) / (2 * dx) + this.sloshX;
        const gz = (hu - hd) / (2 * dz) + this.sloshZ;
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nrm.setXYZ(k, -gx * inv, inv, -gz * inv);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
