import * as THREE from 'three';

/**
 * The enlarger's light cone from the lens to the image area, rendered as an
 * additive volume with drifting dust, plus a few motes caught in the beam.
 */
const vertex = /* glsl */ `
varying float vT;
varying vec3 vWorld;
attribute float t;
void main() {
  vT = t;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragment = /* glsl */ `
uniform float uIntensity;
uniform float uTime;
uniform vec3 uColor;
varying float vT;
varying vec3 vWorld;
float h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  // brighter near the lens, fading toward the paper
  float fall = mix(1.0, 0.18, smoothstep(0.0, 1.0, vT));
  float haze = 0.55 + 0.45 * n3(vWorld * 38.0 + vec3(0.0, uTime * 0.12, uTime * 0.05));
  float a = uIntensity * fall * haze * 0.16;
  gl_FragColor = vec4(uColor * a, a);
}`;

export interface Beam {
  mesh: THREE.Mesh;
  motes: THREE.Points;
  setFrustum(apex: THREE.Vector3, corners: THREE.Vector3[]): void;
  update(intensity: number, time: number, color?: THREE.Color): void;
  dispose(): void;
}

export function createBeam(): Beam {
  const geo = new THREE.BufferGeometry();
  const uniforms = {
    uIntensity: { value: 0 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(1, 0.88, 0.7) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;

  // dust motes, drifting slowly inside the cone
  const N = 140;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(N * 3);
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffe2b8,
    size: 0.0022,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  let apexV = new THREE.Vector3();
  let cornersV: THREE.Vector3[] = [];

  return {
    mesh,
    motes,
    setFrustum(apex, corners) {
      apexV = apex.clone();
      cornersV = corners.map((c) => c.clone());
      const pos: number[] = [];
      const ts: number[] = [];
      // four triangular faces, apex → base edge
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        pos.push(apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z);
        ts.push(0, 1, 1);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('t', new THREE.Float32BufferAttribute(ts, 1));
      geo.computeBoundingSphere();
    },
    update(intensity, time, color) {
      uniforms.uIntensity.value = intensity;
      uniforms.uTime.value = time;
      if (color) uniforms.uColor.value.copy(color);
      moteMat.opacity = Math.min(1, intensity) * 0.7;
      if (intensity <= 0.001 || cornersV.length < 4) return;
      for (let i = 0; i < N; i++) {
        const s0 = seeds[i * 3], s1 = seeds[i * 3 + 1], s2 = seeds[i * 3 + 2];
        const t = (s2 + time * 0.012 * (0.5 + s0)) % 1; // slow fall
        const u = (s0 + Math.sin(time * 0.3 + s1 * 9) * 0.05 + 1) % 1;
        const v = (s1 + Math.cos(time * 0.25 + s0 * 7) * 0.05 + 1) % 1;
        const top = cornersV[0].clone().lerp(cornersV[1], u);
        const bot = cornersV[3].clone().lerp(cornersV[2], u);
        const base = top.lerp(bot, v);
        const p = apexV.clone().lerp(base, 0.15 + t * 0.8);
        motePos[i * 3] = p.x;
        motePos[i * 3 + 1] = p.y;
        motePos[i * 3 + 2] = p.z;
      }
      moteGeo.attributes.position.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
    },
  };
}
