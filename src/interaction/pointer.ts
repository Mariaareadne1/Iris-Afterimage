import * as THREE from 'three';
import type { Darkroom } from '../rendering/darkroom.ts';
import { EASEL_TOP, TRAY, trayById } from '../rendering/world.ts';

/**
 * Pointer interaction with the darkroom: mouse, pen and touch through Pointer
 * Events with pointer capture.
 *  - dodge / burn tools follow the pointer over the easel,
 *  - the frame tool drags the projected image to compose it,
 *  - the exposed sheet can be picked up, carried and dropped in the developer,
 *  - in the developer you can push the print around or rock the tray.
 */
type Drag =
  | { kind: 'paper'; id: number; plane: THREE.Plane }
  | { kind: 'frame'; id: number; last: { u: number; v: number } }
  | { kind: 'rock'; id: number; last: THREE.Vector2 }
  | { kind: 'tool'; id: number };

const LIFT = 0.07;

export class PointerController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private drag: Drag | null = null;
  private easelPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -EASEL_TOP);
  private tmp = new THREE.Vector3();
  private el: HTMLCanvasElement;

  constructor(private room: Darkroom) {
    this.el = room.canvas;
    this.el.style.touchAction = 'none';
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('pointerleave', this.onLeave);
  }

  private get session() {
    return this.room.session;
  }

  private setNdc(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.room.camera);
  }

  /** Pointer over the easel → image-area UV (null when off the image). */
  private easelUV(): { u: number; v: number } | null {
    const hit = this.raycaster.ray.intersectPlane(this.easelPlane, this.tmp);
    if (!hit) return null;
    const uv = this.room.worldToImageUV(hit);
    // allow a little overhang so tools can reach the edges
    if (uv.u < -0.15 || uv.u > 1.15 || uv.v < -0.15 || uv.v > 1.15) return null;
    return uv;
  }

  private hitPaper(): THREE.Intersection | null {
    if (!this.room.paper.mesh.visible) return null;
    return this.raycaster.intersectObject(this.room.paper.mesh, false)[0] ?? null;
  }

  private hitDeveloperTray(): boolean {
    const t = this.room.trays.find((x) => x.def.id === 'developer');
    return !!t && this.raycaster.intersectObject(t.group, true).length > 0;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.setNdc(e);
    const s = this.session.state;
    const atEasel = s.stage === 'enlarger';

    if (atEasel && (s.tool === 'dodge' || s.tool === 'burn')) {
      this.session.setToolPointer(this.easelUV());
      this.drag = { kind: 'tool', id: e.pointerId };
      this.capture(e);
      return;
    }
    if (atEasel && s.tool === 'frame' && !s.locked) {
      const uv = this.easelUV();
      if (uv) {
        this.drag = { kind: 'frame', id: e.pointerId, last: uv };
        this.capture(e);
        this.el.style.cursor = 'grabbing';
      }
      return;
    }
    const hit = this.hitPaper();
    if (hit && this.room.director.canUserGrab(s)) {
      const sim = this.room.paper.sim;
      if (sim.startGrab(hit.point, 0.03)) {
        this.room.director.userHolding = true;
        const lifted = hit.point.clone();
        lifted.y += s.stage === 'finished' ? 0 : LIFT;
        sim.moveGrab(this.room.director.constrainTarget(s, lifted));
        const plane =
          s.stage === 'finished'
            ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), hit.point)
            : new THREE.Plane(new THREE.Vector3(0, 1, 0), -lifted.y);
        this.drag = { kind: 'paper', id: e.pointerId, plane };
        this.capture(e);
        this.el.style.cursor = 'grabbing';
        return;
      }
    }
    if (s.stage === 'developing' && this.hitDeveloperTray()) {
      this.drag = { kind: 'rock', id: e.pointerId, last: new THREE.Vector2(e.clientX, e.clientY) };
      this.capture(e);
      this.el.style.cursor = 'grabbing';
      // touching the developer makes a ripple
      const dev = trayById('developer');
      const p = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TRAY.liquid), this.tmp);
      if (p) this.room.liquids.get('developer')?.disturb(p.x - dev.x, p.z - dev.z, 0.025, 0.04);
    }
  };

  private onMove = (e: PointerEvent) => {
    this.setNdc(e);
    const r = this.el.getBoundingClientRect();
    this.room.pointerParallax(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    const s = this.session.state;
    const d = this.drag;

    // tools follow a hovering mouse; touch tools follow while touching
    if ((s.tool === 'dodge' || s.tool === 'burn') && s.stage === 'enlarger' && (e.pointerType === 'mouse' || d?.kind === 'tool')) {
      this.session.setToolPointer(this.easelUV());
    }
    if (!d || d.id !== e.pointerId) {
      this.updateCursor(s);
      return;
    }
    if (d.kind === 'frame') {
      const uv = this.easelUV();
      if (uv) {
        this.session.nudgeFraming(uv.u - d.last.u, uv.v - d.last.v);
        d.last = uv;
      }
    } else if (d.kind === 'paper') {
      const p = this.raycaster.ray.intersectPlane(d.plane, this.tmp);
      if (p) this.room.paper.sim.moveGrab(this.room.director.constrainTarget(s, p));
      if (s.stage === 'developing') this.session.agitate(0.5);
    } else if (d.kind === 'rock') {
      const now = new THREE.Vector2(e.clientX, e.clientY);
      const delta = now.clone().sub(d.last);
      d.last = now;
      this.room.rockImpulse(delta.x * 0.012, delta.y * 0.012);
    }
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.el.style.cursor = '';
    if (d.kind === 'tool' && e.pointerType !== 'mouse') this.session.setToolPointer(null);
    if (d.kind === 'paper') {
      const tray = this.room.director.userRelease();
      const s = this.session.state;
      // dropping the exposed sheet into the developer starts development
      if (s.stage === 'enlarger' && tray?.id === 'developer') this.session.develop();
    }
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !this.drag) this.session.setToolPointer(null);
  };

  private updateCursor(s = this.session.state) {
    let cursor = '';
    if (s.stage === 'enlarger' && (s.tool === 'dodge' || s.tool === 'burn')) cursor = 'none';
    else if (s.stage === 'enlarger' && s.tool === 'frame' && !s.locked) cursor = this.easelUV() ? 'grab' : '';
    else if (this.room.director.canUserGrab(s) && this.hitPaper()) cursor = 'grab';
    else if (s.stage === 'developing' && this.hitDeveloperTray()) cursor = 'ew-resize';
    this.el.style.cursor = cursor;
  }

  private capture(e: PointerEvent) {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests may not be capturable */
    }
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('pointerleave', this.onLeave);
  }
}
