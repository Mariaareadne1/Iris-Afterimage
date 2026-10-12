import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BASEBOARD,
  BENCH,
  COLUMN,
  DRYING_LINE,
  EASEL,
  EASEL_TOP,
  LENS,
  SAFELIGHT,
  TRAY,
  TRAYS,
  WALL_Z,
  type TrayDef,
} from './world.ts';

/** Seeded canvas noise texture for walls and bench surfaces. */
function noiseTexture(size: number, base: number, amp: number, seed: number, streak = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < size; y++) {
    const row = streak ? (rnd() - 0.5) * amp * 0.6 : 0;
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * amp + row));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Soft radial gradient used as a fake contact shadow under objects. */
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const SHADOW_TEX = { tex: null as THREE.CanvasTexture | null };

export function contactShadow(w: number, d: number, opacity = 0.8): THREE.Mesh {
  SHADOW_TEX.tex ??= shadowTexture();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: SHADOW_TEX.tex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

export function buildRoom(): THREE.Group {
  const g = new THREE.Group();
  const wallTex = noiseTexture(256, 34, 14, 7);
  wallTex.repeat.set(6, 3);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.95, roughnessMap: wallTex, bumpMap: wallTex, bumpScale: 0.6 }),
  );
  wall.position.set(0.2, 0.9, WALL_Z);
  g.add(wall);

  const benchTex = noiseTexture(256, 120, 40, 3, true);
  benchTex.repeat.set(4, 2);
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(BENCH.maxX - BENCH.minX, 0.05, BENCH.maxZ - BENCH.minZ),
    new THREE.MeshStandardMaterial({ color: 0x141313, roughness: 0.55, roughnessMap: benchTex, metalness: 0.05 }),
  );
  bench.position.set((BENCH.maxX + BENCH.minX) / 2, -0.025, (BENCH.maxZ + BENCH.minZ) / 2);
  g.add(bench);
  // splash-back trim and a front lip catch highlights
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(BENCH.maxX - BENCH.minX, 0.012, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.35, metalness: 0.4 }),
  );
  lip.position.set((BENCH.maxX + BENCH.minX) / 2, 0.003, BENCH.maxZ);
  g.add(lip);
  return g;
}

export interface EnlargerParts {
  group: THREE.Group;
  lensGlow: THREE.Mesh;
  leak: THREE.Mesh;
  carrierFilm: THREE.Mesh;
  focusKnob: THREE.Mesh;
}

export function buildEnlarger(): EnlargerParts {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1c1c, roughness: 0.38, metalness: 0.1 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x2c2b2b, roughness: 0.28, metalness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb8b6b2, roughness: 0.18, metalness: 1 });
  const board = new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 0.62 });

  const base = new THREE.Mesh(new RoundedBoxGeometry(BASEBOARD.w, BASEBOARD.h, BASEBOARD.d, 2, 0.004), board);
  base.position.set(BASEBOARD.x, BASEBOARD.h / 2, BASEBOARD.z);
  g.add(base);
  const sh = contactShadow(BASEBOARD.w * 1.25, BASEBOARD.d * 1.2, 0.7);
  sh.position.set(BASEBOARD.x, 0.0005, BASEBOARD.z);
  g.add(sh);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(COLUMN.r, COLUMN.r, COLUMN.h, 32), chrome);
  column.position.set(COLUMN.x, BASEBOARD.h + COLUMN.h / 2, COLUMN.z);
  g.add(column);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 32), satin);
  foot.position.set(COLUMN.x, BASEBOARD.h + 0.01, COLUMN.z);
  g.add(foot);

  const headY = LENS.y + 0.2;
  const carriage = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.12, 0.075, 2, 0.01), satin);
  carriage.position.set(COLUMN.x, headY - 0.04, COLUMN.z);
  g.add(carriage);
  const arm = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.05, Math.abs(COLUMN.z - LENS.z) - 0.08, 2, 0.008), satin);
  arm.position.set(COLUMN.x, headY - 0.04, (COLUMN.z + LENS.z) / 2 - 0.04);
  g.add(arm);

  const focusKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 24), chrome);
  focusKnob.rotation.z = Math.PI / 2;
  focusKnob.position.set(COLUMN.x + 0.05, headY - 0.06, COLUMN.z + 0.02);
  g.add(focusKnob);

  const lamphouse = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.16, 0.24, 4, 0.03), black);
  lamphouse.position.set(LENS.x, headY + 0.07, LENS.z);
  g.add(lamphouse);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 32), satin);
  cap.position.set(LENS.x, headY + 0.17, LENS.z);
  g.add(cap);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.008, 0.245), chrome);
  trim.position.set(LENS.x, headY - 0.01, LENS.z);
  g.add(trim);

  // vents leak a little light while the lamp burns
  const leak = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.004, 0.002),
    new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0 }),
  );
  leak.position.set(LENS.x, headY + 0.11, LENS.z + 0.121);
  g.add(leak);

  // negative carrier stage, with the film strip visible from the side
  const stage = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.018, 0.2), satin);
  stage.position.set(LENS.x, headY - 0.03, LENS.z);
  g.add(stage);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.06), chrome);
  handle.position.set(LENS.x - 0.15, headY - 0.03, LENS.z);
  g.add(handle);
  const carrierFilm = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.048),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.95 }),
  );
  carrierFilm.rotation.x = -Math.PI / 2;
  carrierFilm.position.set(LENS.x - 0.15, headY - 0.025, LENS.z);
  g.add(carrierFilm);

  // bellows: stacked ribs
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.12 - t * 0.02, 0.012, 0.12 - t * 0.02), i % 2 ? black : satin);
    rib.position.set(LENS.x, headY - 0.05 - i * 0.012, LENS.z);
    g.add(rib);
  }
  const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 32), black);
  lensBarrel.position.set(LENS.x, LENS.y + 0.03, LENS.z);
  g.add(lensBarrel);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.003, 8, 32), chrome);
  lensRing.rotation.x = Math.PI / 2;
  lensRing.position.set(LENS.x, LENS.y + 0.006, LENS.z);
  g.add(lensRing);
  const lensGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 1 }),
  );
  lensGlow.rotation.x = Math.PI / 2;
  lensGlow.position.set(LENS.x, LENS.y + 0.004, LENS.z);
  g.add(lensGlow);

  return { group: g, lensGlow, leak, carrierFilm, focusKnob };
}

export interface EaselParts {
  group: THREE.Group;
  blades: THREE.Group;
  /** surface where the projection is visible without paper */
  receiver: THREE.Mesh;
}

export function buildEasel(): EaselParts {
  const g = new THREE.Group();
  const enamel = new THREE.MeshStandardMaterial({ color: 0x8f8877, roughness: 0.5, metalness: 0.05 });
  const plate = new THREE.Mesh(new RoundedBoxGeometry(EASEL.w, EASEL.h, EASEL.d, 2, 0.003), enamel);
  plate.position.set(EASEL.x, BASEBOARD.h + EASEL.h / 2, EASEL.z);
  g.add(plate);
  const sh = contactShadow(EASEL.w * 1.2, EASEL.d * 1.2, 0.6);
  sh.position.set(EASEL.x, BASEBOARD.h + 0.0004, EASEL.z);
  g.add(sh);
  const blades = new THREE.Group();
  g.add(blades);
  const receiver = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  receiver.rotation.x = -Math.PI / 2;
  g.add(receiver);
  return { group: g, blades, receiver };
}

/**
 * Easel blades: a frame whose opening is the print's image area, covering
 * the sheet's white border. Rebuilt when the layout changes.
 */
export function layoutBlades(
  blades: THREE.Group,
  image: { x: number; z: number; w: number; d: number },
  sheet: { x: number; z: number; w: number; d: number },
) {
  for (const c of [...blades.children]) {
    blades.remove(c);
    (c as THREE.Mesh).geometry.dispose();
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a564d, roughness: 0.35, metalness: 0.35 });
  const y = EASEL_TOP + 0.0045;
  const t = 0.003;
  const pad = 0.018;
  const x0 = sheet.x - sheet.w / 2 - pad;
  const x1 = sheet.x + sheet.w / 2 + pad;
  const z0 = sheet.z - sheet.d / 2 - pad;
  const z1 = sheet.z + sheet.d / 2 + pad;
  const left = image.x - image.w / 2;
  const right = image.x + image.w / 2;
  const far = image.z - image.d / 2;
  const near = image.z + image.d / 2;
  // [cx, cz, w, d]: left and right blades run full depth, top/bottom fill between
  const parts: [number, number, number, number][] = [
    [(x0 + left) / 2, (z0 + z1) / 2, left - x0, z1 - z0],
    [(right + x1) / 2, (z0 + z1) / 2, x1 - right, z1 - z0],
    [image.x, (z0 + far) / 2, image.w, far - z0],
    [image.x, (near + z1) / 2, image.w, z1 - near],
  ];
  for (const [cx, cz, w, d] of parts) {
    if (w <= 0 || d <= 0) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat);
    m.position.set(cx, y, cz);
    blades.add(m);
  }
}

export interface TrayParts {
  def: TrayDef;
  group: THREE.Group;
  /** rocking pivot: liquid + tray rotate together */
  rocker: THREE.Group;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(20,18,16,0.85)';
  ctx.font = '600 34px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildTray(def: TrayDef): TrayParts {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  const rocker = new THREE.Group();
  group.add(rocker);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.38, metalness: 0 });
  const { w, d, wall, h, floor } = TRAY;
  const floorMesh = new THREE.Mesh(new RoundedBoxGeometry(w + wall * 2, floor, d + wall * 2, 2, 0.003), mat);
  floorMesh.position.y = floor / 2;
  rocker.add(floorMesh);
  // ribbed floor, a detail every darkroom tray has
  const ribMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5 });
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.002, 0.006), ribMat);
    rib.position.set(0, floor + 0.001, i * d * 0.17);
    rocker.add(rib);
  }
  const walls: [number, number, number, number][] = [
    [0, -(d / 2 + wall / 2), w + wall * 2, wall],
    [0, d / 2 + wall / 2, w + wall * 2, wall],
    [-(w / 2 + wall / 2), 0, wall, d],
    [w / 2 + wall / 2, 0, wall, d],
  ];
  for (const [x, z, ww, dd] of walls) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(ww, h, dd, 2, 0.004), mat);
    m.position.set(x, h / 2, z);
    rocker.add(m);
  }
  // pouring spout on the near-right corner
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, h * 0.6, 12, 1, true, 0, Math.PI), mat);
  spout.position.set(w / 2 + wall, h * 0.7, d / 2 + wall);
  rocker.add(spout);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.025),
    new THREE.MeshBasicMaterial({ map: labelTexture(def.label), transparent: true, depthWrite: false }),
  );
  label.position.set(-w / 2 + 0.06, h * 0.55, d / 2 + wall + 0.0012);
  rocker.add(label);
  const sh = contactShadow(w * 1.35, d * 1.4, 0.75);
  sh.position.y = 0.0006;
  group.add(sh);
  return { def, group, rocker };
}

export function buildTrays(): TrayParts[] {
  return TRAYS.map(buildTray);
}

export interface SafelightParts {
  group: THREE.Group;
  light: THREE.PointLight;
  lens: THREE.Mesh;
  halo: THREE.Sprite;
}

function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,90,50,0.9)');
  g.addColorStop(0.18, 'rgba(255,40,16,0.45)');
  g.addColorStop(0.5, 'rgba(160,16,6,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSafelight(scale = 1): SafelightParts {
  const group = new THREE.Group();
  group.position.set(SAFELIGHT.x, SAFELIGHT.y, SAFELIGHT.z);
  group.scale.setScalar(scale);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.1, 0.09, 40),
    new THREE.MeshStandardMaterial({ color: 0x1c1a19, roughness: 0.5, metalness: 0.5 }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), body.material);
  bracket.position.set(0, 0.09, -0.03);
  group.add(bracket);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.078, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a0302, emissive: 0xff1a06, emissiveIntensity: 1.1, roughness: 0.25, toneMapped: false }),
  );
  lens.position.z = 0.0455;
  group.add(lens);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(0.55, 0.55, 1);
  halo.position.z = 0.05;
  group.add(halo);
  const light = new THREE.PointLight(0xff1e06, 2.1, 0, 1.4);
  light.position.set(0, -0.02, 0.12);
  group.add(light);
  return { group, light, lens, halo };
}

export interface LineParts {
  group: THREE.Group;
  pins: THREE.Group[];
}

export function buildDryingLine(): LineParts {
  const group = new THREE.Group();
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.35, metalness: 0.9 });
  const len = DRYING_LINE.x1 - DRYING_LINE.x0;
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, len, 8), wireMat);
  wire.rotation.z = Math.PI / 2;
  wire.position.set((DRYING_LINE.x0 + DRYING_LINE.x1) / 2, DRYING_LINE.y, DRYING_LINE.z);
  group.add(wire);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 });
  const pins: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const pin = new THREE.Group();
    const a = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.075, 0.007, 2, 0.002), wood);
    const b = a.clone();
    a.position.z = 0.0042;
    b.position.z = -0.0042;
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0012, 6, 16), wireMat);
    spring.rotation.y = Math.PI / 2;
    spring.position.y = 0.006;
    pin.add(a, b, spring);
    pin.visible = false;
    pins.push(pin);
    group.add(pin);
  }
  return { group, pins };
}

/** Dodging tool: a small black disc on a thin wire. */
export function buildDodger(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.6, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat);
  disc.rotation.x = -Math.PI / 2;
  disc.name = 'disc';
  g.add(disc);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.3 }));
  wire.rotation.z = Math.PI / 2;
  wire.position.x = 0.2;
  wire.name = 'wire';
  g.add(wire);
  g.visible = false;
  return g;
}

/** Burning card: black card with a soft-edged hole (scaled per radius). */
export function buildBurnCard(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.17, -0.13);
  shape.lineTo(0.17, -0.13);
  shape.lineTo(0.17, 0.13);
  shape.lineTo(-0.17, 0.13);
  shape.lineTo(-0.17, -0.13);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 1, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const card = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85, side: THREE.DoubleSide }),
  );
  card.rotation.x = -Math.PI / 2;
  card.name = 'card';
  g.add(card);
  g.visible = false;
  return g;
}

/** Rebuild the burn card hole for a world-space radius. */
export function setBurnHole(card: THREE.Group, radius: number) {
  const mesh = card.getObjectByName('card') as THREE.Mesh;
  if (mesh.userData.radius === radius) return;
  mesh.userData.radius = radius;
  const shape = new THREE.Shape();
  shape.moveTo(-0.17, -0.13);
  shape.lineTo(0.17, -0.13);
  shape.lineTo(0.17, 0.13);
  shape.lineTo(-0.17, 0.13);
  shape.lineTo(-0.17, -0.13);
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.min(radius, 0.11), 0, Math.PI * 2, true);
  shape.holes.push(hole);
  mesh.geometry.dispose();
  mesh.geometry = new THREE.ShapeGeometry(shape, 48);
}

/** A darkroom timer on the bench, its red digits mirror the exposure clock. */
export interface TimerParts {
  group: THREE.Group;
  setText(text: string, lit: boolean): void;
}

export function buildTimer(): TimerParts {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(0.15, 0.07, 0.09, 3, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.3 }),
  );
  body.position.y = 0.035;
  group.add(body);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.04),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
  );
  face.position.set(0, 0.04, 0.0455);
  group.add(face);
  const sh = contactShadow(0.22, 0.14, 0.6);
  sh.position.y = 0.0005;
  group.add(sh);
  let last = '';
  return {
    group,
    setText(text: string, lit: boolean) {
      const key = `${text}|${lit}`;
      if (key === last) return;
      last = key;
      ctx.fillStyle = '#0a0302';
      ctx.fillRect(0, 0, 256, 96);
      ctx.font = '600 64px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,40,20,0.08)';
      ctx.fillText('88.8', 128, 52);
      ctx.fillStyle = lit ? '#ff3a1c' : '#7a160b';
      ctx.shadowColor = lit ? 'rgba(255,40,10,0.9)' : 'transparent';
      ctx.shadowBlur = lit ? 18 : 0;
      ctx.fillText(text, 128, 52);
      ctx.shadowBlur = 0;
      tex.needsUpdate = true;
    },
  };
}

/** Brown-glass chemistry bottles against the wall, for silhouette. */
export function buildBottles(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x3a1a08, roughness: 0.12, metalness: 0, transmission: 0, clearcoat: 1 });
  const pts = [
    [0, 0], [0.045, 0], [0.05, 0.005], [0.05, 0.15], [0.045, 0.17], [0.02, 0.19], [0.018, 0.22], [0.02, 0.225], [0, 0.225],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 32);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
  const spots: [number, number, number][] = [[0.24, -0.47, 1], [0.33, -0.49, 0.85], [0.78, -0.48, 1.1]];
  for (const [x, z, s] of spots) {
    const b = new THREE.Mesh(geo, glass);
    b.scale.setScalar(s);
    b.position.set(x, 0, z);
    g.add(b);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.025 * s, 16), capMat);
    cap.position.set(x, 0.232 * s, z);
    g.add(cap);
    const sh = contactShadow(0.16 * s, 0.16 * s, 0.6);
    sh.position.set(x, 0.0005, z);
    g.add(sh);
  }
  return g;
}
