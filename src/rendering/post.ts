import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Post chain: bloom for the safelight and the enlarger beam, then a finishing
 * pass with fine animated grain and a soft vignette. The grain hash is the
 * sinless one from Iris (stable on every ANGLE backend).
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.42 },
    uTime: { value: 0 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uTime;
    uniform float uFade;
    varying vec2 vUv;
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.1, 1.0)));
      c.rgb *= vig;
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 60.0, 512.0))) - 0.5;
      // grain is strongest in the mid-tones, like film
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb += n * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
      c.rgb *= uFade;
      gl_FragColor = c;
    }`,
};

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  finish: ShaderPass;
  setSize(w: number, h: number): void;
  render(time: number): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number): Post {
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.65, 0.78);
  composer.addPass(bloom);
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    finish,
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.resolution.set(width / 2, height / 2);
    },
    render(time) {
      finish.uniforms.uTime.value = time;
      composer.render();
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
