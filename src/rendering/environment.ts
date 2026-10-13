import * as THREE from 'three';
import { SAFELIGHT } from './world.ts';

/**
 * Image-based lighting for reflections on liquid, glass and chrome. Two tiny
 * procedural rooms: one lit only by the red safelight, one with the room
 * lights on. Prefiltered once with PMREM.
 */
function room(lightsOn: boolean): THREE.Scene {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(6, 3, 6),
    new THREE.MeshBasicMaterial({ color: lightsOn ? 0x4a4642 : 0x070302, side: THREE.BackSide }),
  );
  box.position.y = 1;
  scene.add(box);
  const add = (color: THREE.ColorRepresentation, intensity: number, w: number, h: number, pos: [number, number, number], lookY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, lookY, 0);
    scene.add(m);
  };
  // the safelight as seen from the trays
  add(0xff2a10, lightsOn ? 1.5 : 5, 0.22, 0.22, [SAFELIGHT.x, SAFELIGHT.y, SAFELIGHT.z]);
  if (lightsOn) {
    add(0xfff1dc, 1.3, 2.2, 0.5, [0, 2.3, 0.6], 0); // ceiling fixture
    add(0xfff6ea, 1.1, 1.6, 1.2, [1.8, 1.2, 1.4]); // window-ish fill
  } else {
    add(0x601808, 1.4, 1.2, 0.5, [-1.2, 1.4, 1.6]); // faint red bounce
  }
  return scene;
}

export function createEnvironments(renderer: THREE.WebGLRenderer): { dark: THREE.Texture; lit: THREE.Texture; dispose(): void } {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const darkRT = pmrem.fromScene(room(false), 0.02);
  const litRT = pmrem.fromScene(room(true), 0.02);
  pmrem.dispose();
  return {
    dark: darkRT.texture,
    lit: litRT.texture,
    dispose() {
      darkRT.dispose();
      litRT.dispose();
    },
  };
}
