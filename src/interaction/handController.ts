import * as THREE from 'three';
import type { TrackedHand } from '../tracking/handSlots';
import type { GestureName } from '../tracking/gestures';
import type { FingerField } from './fingers';
import type { MorphDirector } from './morphDirector';
import type { ObjectTransform } from './objectTransform';
import { viewportToPlane } from './projection';

export type HandEvent = 'next' | 'prev' | 'reset' | 'grab' | 'release' | 'charge' | 'cancel';

/** What each tracked hand is doing this frame, for the overlay. */
export interface HandActivity {
  id: number;
  gesture: GestureName;
  role: 'rotate' | 'move' | 'charge' | 'touch' | 'idle';
  /** 0..1 progress for timed gestures (charge, hold-to-trigger). */
  progress: number;
}

const TIMING = {
  /** Fist must be held this long before it starts charging. */
  fistArm: 0.18,
  /** After a fist ends, an open palm within this window fires "next". */
  releaseWindow: 0.7,
  victoryHold: 0.45,
  thumbsHold: 0.8,
  cooldown: 1.0,
};

/**
 * Gesture → action mapping.
 *
 *  - one hand pinching and dragging  → rotate (with throw inertia)
 *  - both hands pinching             → move, scale and twist
 *  - fist, then open                 → collapse into a core, then burst into the next object
 *  - victory (peace sign)            → previous object
 *  - point                           → fingertip pushes particles
 *  - thumbs up                       → reset position / scale
 */
export class HandController {
  activity: HandActivity[] = [];
  held = false;
  private listeners = new Set<(e: HandEvent) => void>();

  private pinchIds: number[] = [];
  private lastPinch = new Map<number, THREE.Vector2>();
  private velocity = new THREE.Vector2();
  private two: { d0: number; s0: number; m0: THREE.Vector3; p0: THREE.Vector3; angle: number } | null = null;
  private fistTime = new Map<number, number>();
  private fistEndedAt = -Infinity;
  private charging = false;
  private holdTimers = new Map<string, number>();
  private cooldownUntil = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly transform: ObjectTransform,
    private readonly director: MorphDirector,
    private readonly fingers: FingerField,
    private readonly getAspect: () => number,
  ) {}

  on(fn: (e: HandEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: HandEvent): void {
    this.listeners.forEach((fn) => fn(e));
  }

  update(hands: TrackedHand[], time: number, dt: number): void {
    const aspect = this.getAspect();
    const activity = new Map<number, HandActivity>();
    for (const h of hands) activity.set(h.id, { id: h.id, gesture: h.gesture, role: 'idle', progress: 0 });

    // --- Pinch: rotate with one hand, move/scale/twist with two.
    const pinching = hands.filter((h) => h.gesture === 'pinch');
    const pinchPoint = (h: TrackedHand) =>
      new THREE.Vector2((h.points[4].x + h.points[8].x) / 2, (h.points[4].y + h.points[8].y) / 2);
    const ids = pinching.map((h) => h.id).sort();
    const changed = ids.join() !== this.pinchIds.join();
    const wasHeld = this.held;
    this.held = pinching.length > 0;

    if (pinching.length >= 2) {
      const a = pinchPoint(pinching[0]);
      const b = pinchPoint(pinching[1]);
      const d = Math.hypot((a.x - b.x) * aspect, a.y - b.y);
      const mid = viewportToPlane(this.camera, (a.x + b.x) / 2, (a.y + b.y) / 2, this.transform.targetPosition.z, new THREE.Vector3());
      const angle = Math.atan2(-(b.y - a.y), (b.x - a.x) * aspect);
      if (changed || !this.two) {
        this.two = { d0: d, s0: this.transform.targetScale, m0: mid.clone(), p0: this.transform.targetPosition.clone(), angle };
      } else {
        this.transform.setScale(this.two.s0 * (d / Math.max(this.two.d0, 1e-3)));
        this.transform.targetPosition.copy(this.two.p0).add(mid.sub(this.two.m0));
        let da = angle - this.two.angle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.transform.twist(da);
        this.two.angle = angle;
      }
      for (const h of pinching) activity.get(h.id)!.role = 'move';
      this.transform.spin.set(0, 0);
    } else {
      this.two = null;
    }

    if (pinching.length === 1) {
      const h = pinching[0];
      const p = pinchPoint(h);
      const last = this.lastPinch.get(h.id);
      if (last && !changed) {
        const dx = (p.x - last.x) * aspect * 3.4;
        const dy = (p.y - last.y) * 3.4;
        this.transform.rotateScreen(dx, dy);
        if (dt > 0) this.velocity.lerp(new THREE.Vector2(dx / dt, dy / dt), 0.35);
      } else {
        this.velocity.set(0, 0);
      }
      this.transform.spin.set(0, 0);
      activity.get(h.id)!.role = 'rotate';
    } else if (wasHeld && pinching.length === 0 && this.pinchIds.length === 1) {
      // Released a one-hand rotate: throw it.
      this.transform.spin.copy(this.velocity).clampLength(0, 8);
      this.velocity.set(0, 0);
    }
    this.lastPinch.clear();
    for (const h of pinching) this.lastPinch.set(h.id, pinchPoint(h));
    if (!wasHeld && this.held) this.emit('grab');
    if (wasHeld && !this.held) this.emit('release');
    this.pinchIds = ids;
    if (this.held) this.transform.touch();

    // --- Fist → open: charge, then burst into the next object.
    let anyFist = false;
    for (const h of hands) {
      if (h.gesture === 'fist') {
        const start = this.fistTime.get(h.id) ?? time;
        this.fistTime.set(h.id, start);
        if (time - start > TIMING.fistArm) {
          anyFist = true;
          const act = activity.get(h.id)!;
          act.role = 'charge';
          act.progress = this.director.collapse;
        }
      } else {
        this.fistTime.delete(h.id);
      }
    }
    if (anyFist && time >= this.cooldownUntil) {
      if (!this.charging) this.emit('charge');
      this.charging = true;
      this.director.collapseTarget = 1;
      this.fistEndedAt = time;
    } else if (this.charging) {
      const opened = hands.some((h) => h.gesture === 'open');
      if (opened && time - this.fistEndedAt < TIMING.releaseWindow) {
        this.charging = false;
        this.director.collapseTarget = 0;
        this.director.next();
        this.cooldownUntil = time + TIMING.cooldown;
        this.emit('next');
      } else if (time - this.fistEndedAt >= TIMING.releaseWindow) {
        this.charging = false;
        this.director.collapseTarget = 0;
        this.emit('cancel');
      }
    }

    // --- Timed holds: victory = previous, thumbs up = reset.
    const holds: [GestureName, number, () => void][] = [
      ['victory', TIMING.victoryHold, () => { this.director.prev(); this.emit('prev'); }],
      ['thumbsUp', TIMING.thumbsHold, () => { this.transform.reset(); this.emit('reset'); }],
    ];
    for (const [g, need, fire] of holds) {
      const h = hands.find((x) => x.gesture === g);
      const key = g;
      if (h && time >= this.cooldownUntil) {
        const start = this.holdTimers.get(key) ?? time;
        this.holdTimers.set(key, start);
        const act = activity.get(h.id)!;
        act.progress = Math.min(1, (time - start) / need);
        if (time - start >= need) {
          fire();
          this.cooldownUntil = time + TIMING.cooldown;
          this.holdTimers.delete(key);
        }
      } else {
        this.holdTimers.delete(key);
      }
    }

    // --- Pointing fingertips disturb the particles.
    let slot = 0;
    for (const h of hands) {
      if (slot > 1) break;
      if (h.gesture === 'point' || h.gesture === 'open') {
        const tip = h.points[8];
        viewportToPlane(this.camera, tip.x, tip.y, this.transform.position.z, this.tmp);
        this.fingers.set(slot, this.tmp, h.gesture === 'point' ? 1 : 0.45);
        if (h.gesture === 'point') activity.get(h.id)!.role = 'touch';
        slot++;
      }
    }
    for (; slot < 2; slot++) this.fingers.release(slot);

    this.activity = [...activity.values()];
  }

  /** Forget all per-hand state, e.g. when the camera is switched off. */
  reset(): void {
    this.pinchIds = [];
    this.lastPinch.clear();
    this.two = null;
    this.fistTime.clear();
    this.holdTimers.clear();
    if (this.charging) this.director.collapseTarget = 0;
    this.charging = false;
    this.held = false;
    this.activity = [];
    this.fingers.release(0);
    this.fingers.release(1);
  }
}
