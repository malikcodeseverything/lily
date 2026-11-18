import * as THREE from 'three';
import { damp } from '../core/math';

/**
 * Up to two "touch points" that push particles around. Targets are set by
 * whichever controller is active; values ease toward them so touches fade
 * in and out instead of popping.
 */
export class FingerField {
  readonly targets = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
  constructor(private readonly uniform: THREE.Vector4[]) {}

  set(i: number, p: THREE.Vector3, strength: number): void {
    this.targets[i].set(p.x, p.y, p.z, strength);
  }

  release(i: number): void {
    this.targets[i].w = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < 2; i++) {
      const u = this.uniform[i];
      const t = this.targets[i];
      // Snap position while active so the push tracks the finger exactly.
      if (t.w > 0.01) u.set(t.x, t.y, t.z, u.w);
      u.w = damp(u.w, t.w, t.w > u.w ? 10 : 5, dt);
    }
  }
}
