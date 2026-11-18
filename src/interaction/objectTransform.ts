import * as THREE from 'three';
import { clamp } from '../core/math';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

/**
 * Smoothed transform of the active object. Controllers write to the
 * target values; update() eases the visible transform toward them and
 * handles throw inertia and idle auto-rotation.
 */
export class ObjectTransform {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  scale = 1;

  readonly targetPosition = new THREE.Vector3();
  readonly targetQuaternion = new THREE.Quaternion();
  targetScale = 1;

  /** Spin velocity in rad/s around world Y (x) and world X (y). */
  readonly spin = new THREE.Vector2();
  autoRotate = true;
  minScale = 0.25;
  maxScale = 3.5;
  private idle = 0;

  /** Rotate by screen-space deltas in radians (drag right = spin right). */
  rotateScreen(dx: number, dy: number): void {
    tmpQ.setFromAxisAngle(Y, dx);
    this.targetQuaternion.premultiply(tmpQ);
    tmpQ.setFromAxisAngle(X, dy);
    this.targetQuaternion.premultiply(tmpQ);
  }

  /** Rotate around the view axis (two-hand twist). */
  twist(angle: number): void {
    tmpQ.setFromAxisAngle(Z, angle);
    this.targetQuaternion.premultiply(tmpQ);
  }

  setScale(s: number): void {
    this.targetScale = clamp(s, this.minScale, this.maxScale);
  }

  /** Tell the transform someone is holding it this frame. */
  touch(): void {
    this.idle = 0;
  }

  update(dt: number, held: boolean): void {
    if (held) {
      this.idle = 0;
    } else {
      // Coast after a throw, then settle into a slow idle spin.
      if (this.spin.lengthSq() > 1e-6) {
        this.rotateScreen(this.spin.x * dt, this.spin.y * dt);
        this.spin.multiplyScalar(Math.exp(-2.2 * dt));
      }
      this.idle += dt;
      if (this.autoRotate && this.idle > 2.5) {
        const ramp = clamp((this.idle - 2.5) / 2);
        this.rotateScreen(0.22 * ramp * dt, 0);
      }
    }
    const k = 1 - Math.exp(-14 * dt);
    this.position.lerp(this.targetPosition, k);
    this.quaternion.slerp(this.targetQuaternion, k);
    this.scale += (this.targetScale - this.scale) * k;
  }

  applyTo(obj: THREE.Object3D): void {
    obj.position.copy(this.position);
    obj.quaternion.copy(this.quaternion);
    obj.scale.setScalar(this.scale);
  }

  reset(): void {
    this.targetPosition.set(0, 0, 0);
    this.targetQuaternion.identity();
    this.targetScale = 1;
    this.spin.set(0, 0);
  }
}
