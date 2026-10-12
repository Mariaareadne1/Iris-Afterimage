import * as THREE from 'three';
import { DEVELOP_GLSL } from '../photography/development.ts';
import { T_BASE } from '../photography/negative.ts';
import { PAPER } from '../photography/paper.ts';

/**
 * Material for the photographic paper (and, with `receiverOnly`, the easel
 * surface). It is a MeshPhysicalMaterial patched so that
 *  - while the enlarger runs, the projected negative appears as light on the
 *    surface, shaded by the dodging tool or burning card exactly like the
 *    exposure model's masks,
 *  - before development the sheet is blank (the latent image is invisible),
 *  - in the developer, density grows with the same `developedFraction`
 *    function as the CPU model (GLSL generated from the same constants).
 */
export interface PrintUniforms {
  uImageRect: { value: THREE.Vector4 };
  uDensity: { value: THREE.Texture | null };
  uOnset: { value: THREE.Texture | null };
  uProj: { value: THREE.Texture | null };
  /** x = clock, y = evenness, z = show development (0/1) */
  uDev: { value: THREE.Vector3 };
  uLamp: { value: number };
  uLampColor: { value: THREE.Color };
  /** x,y = tool UV, z = radius (image heights), w = mode (0 none, 1 dodge, 2 burn) */
  uTool: { value: THREE.Vector4 };
  uFeather: { value: number };
  uAspect: { value: number };
  uTime: { value: number };
}

export function createPrintUniforms(): PrintUniforms {
  return {
    uImageRect: { value: new THREE.Vector4(0.05, 0.05, 0.9, 0.9) },
    uDensity: { value: null },
    uOnset: { value: null },
    uProj: { value: null },
    uDev: { value: new THREE.Vector3(0, 0, 0) },
    uLamp: { value: 0 },
    uLampColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
    uTool: { value: new THREE.Vector4(0.5, 0.5, 0.1, 0) },
    uFeather: { value: 0.65 },
    uAspect: { value: 1.25 },
    uTime: { value: 0 },
  };
}

const PARS = /* glsl */ `
uniform vec4 uImageRect;
uniform sampler2D uDensity;
uniform sampler2D uOnset;
uniform sampler2D uProj;
uniform vec3 uDev;
uniform float uLamp;
uniform vec3 uLampColor;
uniform vec4 uTool;
uniform float uFeather;
uniform float uAspect;
uniform float uTime;
varying vec2 vSheetUv;
${DEVELOP_GLSL}
float toolCoverage(vec2 iuv) {
  float r = uTool.z;
  float f = clamp(uFeather, 0.02, 1.0) * r;
  float d = length(vec2((iuv.x - uTool.x) * uAspect, iuv.y - uTool.y));
  return 1.0 - smoothstep(r - f, r + f, d);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export function createPrintMaterial(uniforms: PrintUniforms, opts: { receiverOnly?: boolean; color?: THREE.ColorRepresentation } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? new THREE.Color(0.93, 0.915, 0.885),
    roughness: opts.receiverOnly ? 0.7 : 0.52,
    metalness: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.08,
    side: opts.receiverOnly ? THREE.FrontSide : THREE.DoubleSide,
  });
  const receiverOnly = opts.receiverOnly ? 1 : 0;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheetUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSheetUv = vec2(uv.x, 1.0 - uv.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec2 iuv = (vSheetUv - uImageRect.xy) / uImageRect.zw;
        float inImage = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
        float frontFace = gl_FrontFacing ? 1.0 : 0.0;
        float D = ${PAPER.dMin.toFixed(4)};
        if (${receiverOnly} == 0 && inImage > 0.5 && uDev.z > 0.5 && frontFace > 0.5) {
          float fd = texture2D(uDensity, iuv).r;
          vec2 on = texture2D(uOnset, iuv).rg;
          D = densityAt(fd, developedFraction(uDev.x, on.x, on.y, uDev.y));
          // dither to hide 8-bit banding in smooth skies
          D += (ign(gl_FragCoord.xy + uTime * 37.0) - 0.5) * 0.006;
        }
        float reflectance = pow(10.0, -(D - ${PAPER.dMin.toFixed(4)}));
        diffuseColor.rgb *= reflectance;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (uLamp > 0.0 && inImage > 0.5 && frontFace > 0.5) {
          float T = texture2D(uProj, iuv).r / ${T_BASE.toFixed(5)};
          float cov = toolCoverage(iuv);
          float mask = uTool.w < 0.5 ? 1.0 : (uTool.w < 1.5 ? 1.0 - cov : cov);
          totalEmissiveRadiance += uLampColor * uLamp * T * mask * diffuseColor.rgb;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `print-${receiverOnly}`;
  return mat;
}

/** Upload a float image as a half-float single-channel texture. */
export function floatTexture(data: Float32Array, width: number, height: number, existing?: THREE.DataTexture | null) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  if (existing && existing.image.width === width && existing.image.height === height) {
    (existing.image.data as Uint16Array).set(half);
    existing.needsUpdate = true;
    return existing;
  }
  existing?.dispose();
  const tex = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
  configure(tex);
  return tex;
}

/** Two float images as one RG half-float texture. */
export function float2Texture(a: Float32Array, b: Float32Array, width: number, height: number, existing?: THREE.DataTexture | null) {
  const half = new Uint16Array(a.length * 2);
  for (let i = 0; i < a.length; i++) {
    half[i * 2] = THREE.DataUtils.toHalfFloat(a[i]);
    half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(b[i]);
  }
  existing?.dispose();
  const tex = new THREE.DataTexture(half, width, height, THREE.RGFormat, THREE.HalfFloatType);
  configure(tex);
  return tex;
}

function configure(tex: THREE.DataTexture) {
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
}
