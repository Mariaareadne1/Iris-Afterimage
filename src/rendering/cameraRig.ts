import * as THREE from 'three';

/**
 * Guided camera: each stage has a composed view (a subject box to frame, and
 * a direction to look from). The rig fits the subject into the part of the
 * screen not covered by interface panels — using an off-axis "lens shift"
 * (camera.setViewOffset) so perspective stays natural — for any aspect ratio,
 * and glides between views with critically damped smoothing plus a breath of
 * pointer parallax.
 */
export interface View {
  target: THREE.Vector3;
  /** direction from target toward the camera (normalised internally) */
  from: THREE.Vector3;
  /** subject width and height (metres) that must stay in frame */
  fit: [number, number];
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export class CameraRig {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private goalPos = new THREE.Vector3();
  private goalLook = new THREE.Vector3();
  private parallax = new THREE.Vector2();
  private parallaxGoal = new THREE.Vector2();
  private view: View | null = null;
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private shift = { x: 0, y: 0 };
  private shiftGoal = { x: 0, y: 0 };
  smoothing = 1.15;
  reducedMotion = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  setView(view: View, instant = false) {
    this.view = view;
    this.computeGoal();
    if (instant) this.snap();
  }

  snap() {
    this.pos.copy(this.goalPos);
    this.look.copy(this.goalLook);
    this.shift = { ...this.shiftGoal };
  }

  setViewport(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.computeGoal();
  }

  setInsets(insets: Insets) {
    const clampV = (v: number, max: number) => Math.min(Math.max(v || 0, 0), max);
    this.insets = {
      top: clampV(insets.top, this.height * 0.45),
      bottom: clampV(insets.bottom, this.height * 0.6),
      left: clampV(insets.left, this.width * 0.45),
      right: clampV(insets.right, this.width * 0.45),
    };
    this.computeGoal();
  }

  setPointer(nx: number, ny: number) {
    this.parallaxGoal.set(nx, ny);
  }

  private computeGoal() {
    const v = this.view;
    if (!v) return;
    const { width: w, height: h, insets } = this;
    // free region (in pixels) the subject must fit inside
    let availW = w - insets.left - insets.right;
    let availH = h - insets.top - insets.bottom;
    // if panels would leave too little room, let them overlap the scene
    if (availW < w * 0.42) availW = w * 0.42;
    if (availH < h * 0.36) availH = h * 0.36;
    this.shiftGoal = {
      x: insets.left - insets.right,
      y: insets.bottom - insets.top,
    };
    const hv = h + Math.abs(this.shiftGoal.y);
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dist = Math.max((v.fit[1] * hv) / (t * availH), (v.fit[0] * hv) / (t * availW)) * 1.04;
    this.goalLook.copy(v.target);
    this.goalPos.copy(v.from).normalize().multiplyScalar(dist).add(v.target);
  }

  /** Apply the lens shift for the current (smoothed) offsets. */
  private applyShift() {
    const { width: w, height: h } = this;
    const sx = this.shift.x;
    const sy = this.shift.y;
    const fullW = w + Math.abs(sx);
    const fullH = h + Math.abs(sy);
    const cam = this.camera;
    cam.aspect = fullW / fullH;
    if (Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5) {
      cam.clearViewOffset();
    } else {
      // subject moves right by sx/2 and up by sy/2
      cam.setViewOffset(fullW, fullH, sx > 0 ? 0 : -sx, sy > 0 ? sy : 0, w, h);
    }
    cam.updateProjectionMatrix();
  }

  update(dt: number) {
    const k = this.reducedMotion ? 1 : 1 - Math.exp((-dt * 4.2) / this.smoothing);
    this.pos.lerp(this.goalPos, k);
    this.look.lerp(this.goalLook, k);
    this.shift.x += (this.shiftGoal.x - this.shift.x) * k;
    this.shift.y += (this.shiftGoal.y - this.shift.y) * k;
    this.applyShift();
    this.parallax.lerp(this.parallaxGoal, 1 - Math.exp(-dt * 2));
    const amp = this.reducedMotion ? 0 : 0.01;
    this.camera.position.set(this.pos.x + this.parallax.x * amp, this.pos.y + this.parallax.y * amp * 0.6, this.pos.z);
    this.camera.lookAt(this.look);
  }

  get settled(): boolean {
    return this.pos.distanceTo(this.goalPos) < 0.01;
  }
}
