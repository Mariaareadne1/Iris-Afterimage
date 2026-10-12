import * as THREE from 'three';
import type { DarkroomSession, SessionState, Stage } from '../session/session.ts';
import { TOOL_FEATHER } from '../session/session.ts';
import { INCH } from './world.ts';
import { createBeam, type Beam } from './beam.ts';
import { CameraRig, type Insets, type View } from './cameraRig.ts';
import { createEnvironments } from './environment.ts';
import { LiquidSurface } from './liquid.ts';
import { PaperDirector } from './paperDirector.ts';
import { PaperMesh } from './paperMesh.ts';
import { createPost, type Post } from './post.ts';
import { createPrintMaterial, createPrintUniforms, floatTexture, float2Texture, type PrintUniforms } from './printMaterial.ts';
import {
  buildBottles,
  buildBurnCard,
  buildDodger,
  buildDryingLine,
  buildEasel,
  buildEnlarger,
  buildRoom,
  buildSafelight,
  buildTimer,
  buildTrays,
  layoutBlades,
  setBurnHole,
  type EaselParts,
  type EnlargerParts,
  type LineParts,
  type SafelightParts,
  type TimerParts,
  type TrayParts,
} from './props.ts';
import { EASEL, EASEL_TOP, HANG, LENS, TRAY, TRAYS, trayById, type TrayDef } from './world.ts';
import { PointerController } from '../interaction/pointer.ts';

export class WebGLUnavailableError extends Error {}

/** Lamp colour through a variable-contrast filter: yellow for soft grades, magenta for hard. */
export function filterTint(grade: number, out = new THREE.Color()): THREE.Color {
  const t = Math.min(Math.max((grade + 0.5) / 5.5, 0), 1);
  const soft = new THREE.Color(1.0, 0.9, 0.58);
  const hard = new THREE.Color(1.0, 0.62, 0.86);
  return out.copy(soft).lerp(hard, t);
}

const LAMP_ON_PAPER = 1.05;
const LAMP_FOCUS = 0.75;

export class Darkroom {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig: CameraRig;
  private post: Post;
  private envs: ReturnType<typeof createEnvironments>;
  readonly paper: PaperMesh;
  readonly director: PaperDirector;
  private easel: EaselParts;
  private easelUniforms: PrintUniforms;
  private enlarger: EnlargerParts;
  readonly trays: TrayParts[];
  readonly liquids = new Map<TrayDef['id'], LiquidSurface>();
  private safelight: SafelightParts;
  private safelight2: SafelightParts;
  private line: LineParts;
  private timer: TimerParts;
  private beam: Beam;
  private dodger: THREE.Group;
  private burnCard: THREE.Group;
  private hemi: THREE.HemisphereLight;
  private roomKey: THREE.DirectionalLight;
  private spill: THREE.SpotLight;
  private pointer: PointerController;
  private projTex: THREE.DataTexture | null = null;
  private densityTex: THREE.DataTexture | null = null;
  private onsetTex: THREE.DataTexture | null = null;
  private lastState: SessionState | null = null;
  private lastProjVersion = -1;
  private lastLatentVersion = -1;
  private layoutKey = '';
  private lampLevel = 0;
  private lightsLevel = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private rockTime = 0;
  private rockAuto = 0;
  private rockTilt = new THREE.Vector2();
  private rockVel = new THREE.Vector2();
  /** frames per second estimate, for adaptive quality */
  fps = 60;
  private lowQuality = false;
  paused = false;

  constructor(private host: HTMLElement, readonly session: DarkroomSession) {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    } catch {
      throw new WebGLUnavailableError('WebGL is not available');
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      throw new WebGLUnavailableError('WebGL 2 is required');
    }
    this.renderer = renderer;
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', 'Darkroom — interactive 3D scene');
    renderer.domElement.setAttribute('role', 'img');
    host.appendChild(renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.02, 30);
    this.rig = new CameraRig(this.camera);
    this.rig.setViewport(w, h);
    this.rig.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.envs = createEnvironments(renderer);
    this.scene.environment = this.envs.dark;
    this.scene.environmentIntensity = 0.4;
    this.scene.background = new THREE.Color(0x040302);
    this.scene.fog = new THREE.Fog(0x040302, 2.2, 5.5);

    // ── lights ──
    this.hemi = new THREE.HemisphereLight(0x2a0804, 0x030101, 0.45);
    this.scene.add(this.hemi);
    this.roomKey = new THREE.DirectionalLight(0xfff0dc, 0);
    this.roomKey.position.set(0.6, 2.4, 1.4);
    this.scene.add(this.roomKey);
    this.spill = new THREE.SpotLight(0xffe2b8, 0, 1.2, 0.62, 0.8, 1.2);
    this.spill.position.set(LENS.x, LENS.y, LENS.z);
    this.spill.target.position.set(EASEL.x, 0, EASEL.z);
    this.scene.add(this.spill, this.spill.target);

    // ── props ──
    this.scene.add(buildRoom());
    this.enlarger = buildEnlarger();
    this.scene.add(this.enlarger.group);
    this.easel = buildEasel();
    this.scene.add(this.easel.group);
    this.easelUniforms = createPrintUniforms();
    this.easel.receiver.material = createPrintMaterial(this.easelUniforms, { receiverOnly: true, color: 0x9a927f });
    this.trays = buildTrays();
    for (const t of this.trays) {
      this.scene.add(t.group);
      const liquid = new LiquidSurface({
        width: TRAY.w,
        depth: TRAY.d,
        resolution: t.def.id === 'developer' ? 80 : 48,
        color: t.def.liquid,
        attenuation: t.def.attenuation,
      });
      liquid.mesh.position.y = TRAY.liquid;
      t.rocker.add(liquid.mesh);
      this.liquids.set(t.def.id, liquid);
    }
    this.safelight = buildSafelight();
    this.scene.add(this.safelight.group);
    // a second, dimmer safelight over the enlarger end of the bench
    this.safelight2 = buildSafelight(0.55);
    this.safelight2.group.position.set(-0.95, 0.78, -0.5);
    this.scene.add(this.safelight2.group);
    this.line = buildDryingLine();
    this.scene.add(this.line.group);
    this.scene.add(buildBottles());
    this.timer = buildTimer();
    this.timer.group.position.set(-0.2, 0, -0.32);
    this.timer.group.rotation.y = -0.25;
    this.scene.add(this.timer.group);
    this.beam = createBeam();
    this.scene.add(this.beam.mesh, this.beam.motes);
    this.dodger = buildDodger();
    this.burnCard = buildBurnCard();
    this.scene.add(this.dodger, this.burnCard);

    this.paper = new PaperMesh();
    this.scene.add(this.paper.mesh);
    this.director = new PaperDirector(() => this.paper.sim);
    this.director.onSplash = (tray, strength) => this.splash(tray, strength);
    this.paper.mesh.visible = false;

    this.post = createPost(renderer, this.scene, this.camera, w, h);
    this.pointer = new PointerController(this);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);
    this.unsubscribe = session.store.subscribe(() => this.onState());
    this.onState();
    this.rig.setView(this.viewFor(session.state), true);
    this.loop();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  // ───────────────────────────── state → scene ─────────────────────────────

  private onState() {
    const s = this.session.state;
    const prev = this.lastState;
    this.lastState = s;
    this.syncLayout();
    if (s.projectionVersion !== this.lastProjVersion) this.uploadProjection();
    if (s.latentVersion !== this.lastLatentVersion) this.uploadLatent();
    this.director.sync(prev, s);
    if (!prev || prev.stage !== s.stage || prev.tool !== s.tool || prev.lamp.mode !== s.lamp.mode || prev.paper !== s.paper) {
      this.rig.setView(this.viewFor(s));
    }
    if (prev && prev.stage !== s.stage && s.stage === 'developing') {
      // a wet sheet is glossy
      this.paper.material.clearcoat = 0.6;
      this.paper.material.clearcoatRoughness = 0.3;
    }
    if (s.stage === 'enlarger' && prev?.stage !== 'enlarger') this.paper.material.clearcoat = 0;
  }

  private syncLayout() {
    const layout = this.session.layout;
    if (!layout) return;
    const key = `${layout.sheetW}x${layout.sheetH}:${layout.aspect.toFixed(5)}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.paper.setLayout(layout);
    this.director.reset();
    const sheet = { x: EASEL.x, z: EASEL.z, w: layout.sheetW * INCH, d: layout.sheetH * INCH };
    const img = this.imageRectWorld();
    layoutBlades(this.easel.blades, img, sheet);
    this.easel.receiver.scale.set(img.w, img.d, 1);
    this.easel.receiver.position.set(img.x, EASEL_TOP + 0.0004, img.z);
    this.easelUniforms.uImageRect.value.set(0, 0, 1, 1);
    this.easelUniforms.uAspect.value = layout.aspect;
    const y = EASEL_TOP + 0.002;
    this.beam.setFrustum(new THREE.Vector3(LENS.x, LENS.y, LENS.z), [
      new THREE.Vector3(img.x - img.w / 2, y, img.z - img.d / 2),
      new THREE.Vector3(img.x + img.w / 2, y, img.z - img.d / 2),
      new THREE.Vector3(img.x + img.w / 2, y, img.z + img.d / 2),
      new THREE.Vector3(img.x - img.w / 2, y, img.z + img.d / 2),
    ]);
  }

  /** Image area of the registered sheet on the easel, in world metres. */
  imageRectWorld(): { x: number; z: number; w: number; d: number } {
    const l = this.session.layout!;
    const sw = l.sheetW * INCH;
    const sd = l.sheetH * INCH;
    const x0 = EASEL.x - sw / 2 + l.image.x * INCH;
    const z0 = EASEL.z - sd / 2 + l.image.y * INCH;
    return { x: x0 + (l.image.w * INCH) / 2, z: z0 + (l.image.h * INCH) / 2, w: l.image.w * INCH, d: l.image.h * INCH };
  }

  /** World point on the easel plane → image-area UV (may be outside 0..1). */
  worldToImageUV(p: THREE.Vector3): { u: number; v: number } {
    const r = this.imageRectWorld();
    return { u: (p.x - (r.x - r.w / 2)) / r.w, v: (p.z - (r.z - r.d / 2)) / r.d };
  }

  private uploadProjection() {
    const proj = this.session.projection;
    this.lastProjVersion = this.session.state.projectionVersion;
    if (!proj) return;
    this.projTex = floatTexture(proj.data, proj.width, proj.height, this.projTex);
    this.paper.uniforms.uProj.value = this.projTex;
    this.easelUniforms.uProj.value = this.projTex;
    const neg = this.session.negative;
    if (neg) this.setCarrierFilm(neg.thumb);
  }

  private carrierThumb = '';
  private setCarrierFilm(url: string) {
    if (!url || url === this.carrierThumb) return;
    this.carrierThumb = url;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = this.enlarger.carrierFilm.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = tex;
      m.color.set(0x8a8a8a);
      m.needsUpdate = true;
    });
  }

  private uploadLatent() {
    this.lastLatentVersion = this.session.state.latentVersion;
    const fd = this.session.finalDensity;
    const on = this.session.onset;
    if (!fd || !on) return;
    this.densityTex = floatTexture(fd.data, fd.width, fd.height, this.densityTex);
    this.onsetTex = float2Texture(on.base.data, on.uneven.data, fd.width, fd.height, this.onsetTex);
    this.paper.uniforms.uDensity.value = this.densityTex;
    this.paper.uniforms.uOnset.value = this.onsetTex;
  }

  // ───────────────────────────── views ─────────────────────────────

  private viewFor(s: SessionState): View {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const stage: Stage = s.stage;
    const dev = trayById('developer');
    switch (stage) {
      case 'intro':
        return { target: V(0.12, 0.28, -0.08), from: V(-0.08, 0.42, 1), fit: [1.9, 1.15] };
      case 'enlarger': {
        const working = s.tool === 'dodge' || s.tool === 'burn' || s.tool === 'frame';
        if (working) return { target: V(EASEL.x, EASEL_TOP, EASEL.z + 0.01), from: V(0, 1.7, 0.75), fit: [0.36, 0.3] };
        return { target: V(EASEL.x + 0.01, 0.2, EASEL.z), from: V(0.1, 0.62, 1), fit: [0.4, 0.56] };
      }
      case 'transfer':
        return { target: V((EASEL.x + dev.x) / 2, 0.12, 0.02), from: V(0, 0.75, 1), fit: [1.0, 0.55] };
      case 'developing':
        return { target: V(dev.x, TRAY.liquid, dev.z + 0.005), from: V(0, 1.55, 0.72), fit: [0.4, 0.32] };
      case 'stop': {
        const t = trayById('stop');
        return { target: V(t.x, TRAY.liquid, t.z), from: V(0, 1.4, 0.8), fit: [0.5, 0.36] };
      }
      case 'fix':
      case 'wash': {
        const t = trayById('fix');
        return { target: V(t.x - 0.05, TRAY.liquid + 0.02, t.z), from: V(-0.05, 1.3, 0.85), fit: [0.6, 0.42] };
      }
      case 'finished':
        return { target: V(HANG.x, HANG.y - 0.13, HANG.z), from: V(0.0, 0.06, 1), fit: [0.4, 0.34] };
    }
  }

  // ───────────────────────────── per-frame ─────────────────────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused) return;
    // generous cap: throttled tabs still keep near-real time (physics substeps itself)
    const realDt = Math.min(this.clock.getDelta(), 0.25);
    this.frame(realDt);
  };

  /** One frame (exposed so capture/showcase can drive deterministic steps). */
  frame(realDt: number) {
    this.fps = this.fps * 0.95 + (1 / Math.max(realDt, 1e-3)) * 0.05;
    this.adaptQuality();
    this.session.tick(realDt);
    const dt = realDt * this.session.speed;
    this.elapsed += realDt;
    const s = this.session.state;

    this.updateLamp(s, realDt);
    this.updateTools(s);
    this.updateRocking(s, realDt);
    // choreography never outruns what the physics can simulate this frame
    const physDt = Math.min(dt, 0.1);
    this.director.update(physDt);
    this.paper.sim.step(physDt);
    this.paper.mesh.visible = this.director.visible;
    if (this.paper.mesh.visible) this.paper.sync();
    this.updateChemistry(s, dt);
    this.updateLights(s, realDt);
    this.updateTimer(s);
    for (const l of this.liquids.values()) l.step(realDt);
    this.paper.uniforms.uTime.value = this.elapsed;
    this.rig.update(realDt);
    this.post.render(this.elapsed);
  }

  private updateLamp(s: SessionState, dt: number) {
    const target = s.stage === 'enlarger' ? (s.lamp.mode === 'focus' ? LAMP_FOCUS : s.lamp.mode === 'off' ? 0 : LAMP_ON_PAPER) : 0;
    // filament warm-up / cool-down
    this.lampLevel += (target - this.lampLevel) * (1 - Math.exp(-dt * (target > this.lampLevel ? 22 : 14)));
    const lvl = this.lampLevel;
    const tint = filterTint(s.settings.grade);
    const color = new THREE.Color(1, 0.86, 0.66).multiply(tint);
    const onPaper = this.director.location === 'easel';
    this.paper.uniforms.uLamp.value = onPaper ? lvl : 0;
    this.paper.uniforms.uLampColor.value.copy(color);
    this.easelUniforms.uLamp.value = onPaper ? 0 : lvl;
    this.easelUniforms.uLampColor.value.copy(color);
    this.beam.update(lvl / LAMP_ON_PAPER, this.elapsed, color);
    this.spill.intensity = lvl * 0.22;
    this.spill.color.copy(color);
    (this.enlarger.lensGlow.material as THREE.MeshBasicMaterial).color.setRGB(0.1 + lvl * 1.6, 0.08 + lvl * 1.35, 0.06 + lvl * 1.0);
    (this.enlarger.leak.material as THREE.MeshBasicMaterial).opacity = Math.min(1, lvl * 0.5);
    (this.enlarger.carrierFilm.material as THREE.MeshBasicMaterial).color.setScalar(0.25 + lvl * 0.5);
  }

  private updateTools(s: SessionState) {
    const tool = s.stage === 'enlarger' && s.paper === 'easel' ? s.tool : 'none';
    const uv = this.session.toolPosition;
    const show = (tool === 'dodge' || tool === 'burn') && uv !== null;
    const mode = tool === 'dodge' ? 1 : tool === 'burn' ? 2 : 0;
    const active = show && (s.lamp.mode === 'expose' || s.lamp.mode === 'burn' || s.lamp.mode === 'off');
    this.paper.uniforms.uTool.value.set(uv?.u ?? 0.5, uv?.v ?? 0.5, s.toolRadius, active && this.lampLevel > 0.01 ? mode : 0);
    this.paper.uniforms.uFeather.value = TOOL_FEATHER;
    this.dodger.visible = show && tool === 'dodge';
    this.burnCard.visible = show && tool === 'burn';
    if (!show || !uv) return;
    // place the tool on the ray from the lens through the paper point, so its
    // shadow lands exactly where the exposure model puts it
    const r = this.imageRectWorld();
    const px = r.x - r.w / 2 + uv.u * r.w;
    const pz = r.z - r.d / 2 + uv.v * r.d;
    const height = tool === 'dodge' ? 0.09 : 0.15;
    const k = height / (LENS.y - EASEL_TOP);
    const wx = px + (LENS.x - px) * k;
    const wz = pz + (LENS.z - pz) * k;
    const radiusPaper = s.toolRadius * r.d;
    const radiusAtTool = radiusPaper * (1 - k);
    const wobble = Math.sin(this.elapsed * 7.3) * 0.0012; // dodging is done with a gentle jiggle
    if (tool === 'dodge') {
      this.dodger.position.set(wx + wobble, EASEL_TOP + height, wz);
      const disc = this.dodger.getObjectByName('disc')!;
      disc.scale.setScalar(radiusAtTool * 0.85);
    } else {
      this.burnCard.position.set(wx, EASEL_TOP + height, wz + wobble);
      setBurnHole(this.burnCard, Math.round(radiusAtTool * 1000) / 1000);
    }
  }

  /** Start an automated rocking cycle (button / keyboard). */
  rockTray(seconds = 2.4) {
    this.rockAuto = Math.max(this.rockAuto, seconds);
  }

  /** User drag on the tray: tilt impulse in tray-local x/z. */
  rockImpulse(ix: number, iz: number) {
    this.rockVel.x += ix;
    this.rockVel.y += iz;
  }

  private updateRocking(s: SessionState, dt: number) {
    const dev = this.trays.find((t) => t.def.id === 'developer')!;
    if (s.stage !== 'developing') {
      this.rockAuto = 0;
      this.rockTilt.multiplyScalar(0.9);
      this.rockVel.set(0, 0);
    } else if (this.rockAuto > 0) {
      this.rockAuto -= dt;
      this.rockTime += dt;
      const target = Math.sin(this.rockTime * 4.2) * 0.045;
      this.rockVel.y += (target - this.rockTilt.y) * 18 * dt;
    }
    // spring back to level
    this.rockVel.x += -this.rockTilt.x * 60 * dt - this.rockVel.x * 6 * dt;
    this.rockVel.y += -this.rockTilt.y * 60 * dt - this.rockVel.y * 6 * dt;
    this.rockTilt.x = THREE.MathUtils.clamp(this.rockTilt.x + this.rockVel.x * dt, -0.07, 0.07);
    this.rockTilt.y = THREE.MathUtils.clamp(this.rockTilt.y + this.rockVel.y * dt, -0.07, 0.07);
    dev.rocker.rotation.z = -this.rockTilt.x;
    dev.rocker.rotation.x = this.rockTilt.y;
    const speed = this.rockVel.length();
    if (s.stage === 'developing' && speed > 0.02) {
      const liquid = this.liquids.get('developer')!;
      liquid.rock(this.rockVel.x * dt * 0.6, this.rockVel.y * dt * 0.6);
      this.session.agitate(Math.min(1, speed * 1.4));
      this.paper.sim.nudge(this.rockVel.x * dt * 0.0016, this.rockVel.y * dt * 0.0016);
    }
  }

  private updateChemistry(s: SessionState, dt: number) {
    const u = this.paper.uniforms;
    const showDev = ['developing', 'stop', 'fix', 'wash', 'finished'].includes(s.stage);
    u.uDev.value.set(s.dev.clock, s.dev.evenness, showDev ? 1 : 0);
    // the paper moving through liquid makes waves
    if (this.director.location === 'free' || this.director.userHolding || this.director.carrying) {
      const c = this.paper.sim.centroid();
      const tray = TRAYS.find((t) => Math.abs(c.x - t.x) < TRAY.w / 2 && Math.abs(c.z - t.z) < TRAY.d / 2);
      if (tray) {
        const motion = this.paper.sim.motion();
        if (motion > 0.0004) this.liquids.get(tray.id)!.disturb(c.x - tray.x, c.z - tray.z, 0.06, Math.min(0.05, motion * 2.5));
      }
    }
    // gentle running water during the wash
    if (s.stage === 'wash') {
      const fix = trayById('fix');
      const l = this.liquids.get('fix')!;
      if (Math.random() < dt * 14) l.disturb((Math.random() - 0.5) * TRAY.w * 0.8, (Math.random() - 0.5) * TRAY.d * 0.8, 0.02, 0.012);
      void fix;
    }
  }

  private splash(tray: TrayDef, strength: number) {
    const l = this.liquids.get(tray.id);
    if (!l) return;
    l.disturbLine(-TRAY.w * 0.35, -TRAY.d * 0.3, -TRAY.w * 0.35, TRAY.d * 0.3, 0.12 * strength);
    l.disturb(0, 0, 0.12, 0.02 * strength);
  }

  private updateLights(s: SessionState, dt: number) {
    const target = s.lightsOn ? 1 : 0;
    this.lightsLevel += (target - this.lightsLevel) * (1 - Math.exp(-dt * 1.4));
    const L = this.lightsLevel;
    this.hemi.color.setRGB(0.16 + L * 0.77, 0.03 + L * 0.7, 0.015 + L * 0.62);
    this.hemi.intensity = 0.45 + L * 0.85;
    this.roomKey.intensity = L * 2.2;
    this.safelight.light.intensity = 2.1 * (1 - L * 0.6);
    this.safelight2.light.intensity = 1.3 * (1 - L * 0.6);
    this.safelight.halo.material.opacity = 1 - L * 0.75;
    this.safelight2.halo.material.opacity = 1 - L * 0.75;
    this.scene.environment = L > 0.5 ? this.envs.lit : this.envs.dark;
    this.scene.environmentIntensity = 0.4 + L * 0.65;
    const bg = new THREE.Color(0x040302).lerp(new THREE.Color(0x24211e), L);
    (this.scene.background as THREE.Color).copy(bg);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.post.bloom.strength = 0.55 - L * 0.3;
  }

  private updateTimer(s: SessionState) {
    const lit = s.lamp.mode === 'expose' || s.lamp.mode === 'burn';
    const secs = lit ? Math.max(0, s.lamp.duration - s.lamp.elapsed) : s.settings.time;
    this.timer.setText(secs.toFixed(1), lit);
  }

  private adaptQuality() {
    if (!this.lowQuality && this.elapsed > 4 && this.fps < 32) {
      this.lowQuality = true;
      this.renderer.setPixelRatio(1);
      for (const l of this.liquids.values()) l.setTransmission(false);
      this.onResize();
    }
  }

  // ───────────────────────────── misc ─────────────────────────────

  /** Screen space covered by interface panels, so the camera frames around them. */
  setInsets(insets: Insets) {
    this.rig.setInsets(insets);
  }

  pointerParallax(nx: number, ny: number) {
    this.rig.setPointer(nx, ny);
  }

  private onResize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.rig.setViewport(w, h);
  }

  get cameraSettled(): boolean {
    return this.rig.settled;
  }

  /** Screen position (0..1, y down) of a point in the image area — for tests and tooling. */
  imageUVToScreen(u: number, v: number): { x: number; y: number } {
    const r = this.imageRectWorld();
    const p = new THREE.Vector3(r.x - r.w / 2 + u * r.w, EASEL_TOP + 0.002, r.z - r.d / 2 + v * r.d).project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  /** Diagnostics for tests. */
  debug() {
    const sim = this.paper.sim;
    const c = sim.centroid();
    return {
      paperVisible: this.paper.mesh.visible,
      paperLocation: this.director.location,
      centroid: c,
      heightRange: sim.heightRange(),
      maxStretch: sim.maxStretch(),
      recoveries: sim.recoveryCount,
      lampLevel: this.lampLevel,
      lightsLevel: this.lightsLevel,
      developerEnergy: this.liquids.get('developer')!.energy(),
      fps: this.fps,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unsubscribe();
    this.pointer.dispose();
    this.post.dispose();
    this.envs.dispose();
    this.beam.dispose();
    this.paper.dispose();
    for (const l of this.liquids.values()) l.dispose();
    this.projTex?.dispose();
    this.densityTex?.dispose();
    this.onsetTex?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
