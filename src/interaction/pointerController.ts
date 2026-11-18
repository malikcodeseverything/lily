import * as THREE from 'three';
import type { ObjectTransform } from './objectTransform';
import type { FingerField } from './fingers';
import { viewportToPlane } from './projection';

type DragMode = 'rotate' | 'move' | null;

/**
 * Mouse and touch fallback: drag to rotate, right/shift drag to move,
 * wheel or pinch to scale, hover to disturb the particles.
 */
export class PointerController {
  enabled = true;
  /** When false, hovering does not push particles (hands own the field). */
  hoverTouch = true;
  private mode: DragMode = null;
  private last = new THREE.Vector2();
  private lastTime = 0;
  private velocity = new THREE.Vector2();
  private hover: THREE.Vector2 | null = null;
  private moveStart = new THREE.Vector3();
  private grabStart = new THREE.Vector3();
  private pointers = new Map<number, THREE.Vector2>();
  private pinchStart = 0;
  private scaleStart = 1;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly el: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly transform: ObjectTransform,
    private readonly fingers: FingerField,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => (this.hover = null));
  }

  get dragging(): boolean {
    return this.mode !== null;
  }

  private uv(e: PointerEvent | WheelEvent): THREE.Vector2 {
    const r = this.el.getBoundingClientRect();
    return new THREE.Vector2((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.el.setPointerCapture?.(e.pointerId);
    const p = this.uv(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = a.distanceTo(b);
      this.scaleStart = this.transform.targetScale;
      this.mode = null;
      return;
    }
    this.mode = e.button === 2 || e.shiftKey ? 'move' : 'rotate';
    this.last.copy(p);
    this.lastTime = performance.now();
    this.velocity.set(0, 0);
    this.transform.spin.set(0, 0);
    if (this.mode === 'move') {
      this.moveStart.copy(this.transform.targetPosition);
      viewportToPlane(this.camera, p.x, p.y, this.transform.targetPosition.z, this.grabStart);
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.uv(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && this.pinchStart > 0) {
      const [a, b] = [...this.pointers.values()];
      this.transform.setScale(this.scaleStart * (a.distanceTo(b) / this.pinchStart));
      this.transform.touch();
      return;
    }
    this.hover = p;
    if (!this.mode) return;
    const now = performance.now();
    const dt = Math.max((now - this.lastTime) / 1000, 1e-3);
    const aspect = this.el.clientWidth / this.el.clientHeight;
    if (this.mode === 'rotate') {
      const dx = (p.x - this.last.x) * aspect * 3.4;
      const dy = (p.y - this.last.y) * 3.4;
      this.transform.rotateScreen(dx, dy);
      this.velocity.lerp(new THREE.Vector2(dx / dt, dy / dt), 0.5);
    } else {
      viewportToPlane(this.camera, p.x, p.y, this.transform.targetPosition.z, this.tmp);
      this.transform.targetPosition.copy(this.moveStart).add(this.tmp.sub(this.grabStart));
    }
    this.transform.touch();
    this.last.copy(p);
    this.lastTime = now;
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = 0;
    if (this.mode === 'rotate') {
      // Throw: keep spinning with the release velocity.
      const idleMs = performance.now() - this.lastTime;
      if (idleMs < 80) this.transform.spin.copy(this.velocity).clampLength(0, 9);
    }
    this.mode = null;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.transform.setScale(this.transform.targetScale * Math.exp(-e.deltaY * 0.0015));
    this.transform.touch();
  };

  /** Push the hover point into the finger field. Call once per frame. */
  update(): void {
    if (!this.enabled || !this.hoverTouch) return;
    if (this.hover && !this.mode) {
      viewportToPlane(this.camera, this.hover.x, this.hover.y, this.transform.position.z, this.tmp);
      this.fingers.set(0, this.tmp, 0.55);
    } else {
      this.fingers.release(0);
    }
  }
}
