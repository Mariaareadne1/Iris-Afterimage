import * as THREE from 'three';
import { PaperSim } from '../physics/paper.ts';
import type { PrintLayout } from '../photography/layout.ts';
import { createPrintMaterial, createPrintUniforms, type PrintUniforms } from './printMaterial.ts';
import { INCH } from './world.ts';

/**
 * Renderable sheet of paper: the physics grid drives a BufferGeometry whose
 * UVs are fixed to the grid, so the image cannot slide or stretch on it.
 */
const SEG_LONG = 24;

export class PaperMesh {
  sim: PaperSim;
  readonly mesh: THREE.Mesh;
  readonly uniforms: PrintUniforms;
  readonly material: THREE.MeshPhysicalMaterial;
  private geometry: THREE.BufferGeometry;

  constructor() {
    this.uniforms = createPrintUniforms();
    this.material = createPrintMaterial(this.uniforms);
    this.sim = new PaperSim(10 * INCH, 8 * INCH, SEG_LONG, Math.round((SEG_LONG * 8) / 10));
    this.geometry = this.buildGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Resize the sheet for a print layout (orientation, image area). */
  setLayout(layout: PrintLayout) {
    const w = layout.sheetW * INCH;
    const h = layout.sheetH * INCH;
    if (Math.abs(w - this.sim.width) > 1e-6 || Math.abs(h - this.sim.height) > 1e-6) {
      const landscape = w >= h;
      const segX = landscape ? SEG_LONG : Math.round((SEG_LONG * w) / h);
      const segY = landscape ? Math.round((SEG_LONG * h) / w) : SEG_LONG;
      const env = this.sim.env;
      this.sim = new PaperSim(w, h, segX, segY);
      this.sim.env = env;
      this.geometry.dispose();
      this.geometry = this.buildGeometry();
      this.mesh.geometry = this.geometry;
    }
    const r = layout.imageUV;
    this.uniforms.uImageRect.value.set(r.x, r.y, r.w, r.h);
    this.uniforms.uAspect.value = layout.aspect;
  }

  private buildGeometry(): THREE.BufferGeometry {
    const { cols, rows, segX, segY } = this.sim;
    const g = new THREE.BufferGeometry();
    const uv = new Float32Array(cols * rows * 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        uv[i * 2] = x / segX;
        uv[i * 2 + 1] = 1 - y / segY;
      }
    }
    const idx: number[] = [];
    for (let y = 0; y < segY; y++) {
      for (let x = 0; x < segX; x++) {
        const a = y * cols + x;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // winding gives +y normals for a sheet lying emulsion-up
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.sim.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  /** Push simulated positions to the GPU. */
  sync() {
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    if (pos.array !== this.sim.positions) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(this.sim.positions, 3));
    } else {
      pos.needsUpdate = true;
    }
    this.geometry.computeVertexNormals();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
