import * as THREE from 'three';
import type { PointCloud } from '../shapes/types';
import noise from './shaders/noise.glsl?raw';
import vert from './shaders/particles.vert.glsl?raw';
import frag from './shaders/particles.frag.glsl?raw';

export type Slot = 'A' | 'B';

export interface SlotInfo {
  cloud: PointCloud | null;
  /** Bounds after the resting pose is applied: [minX,minY,minZ,maxX,maxY,maxZ]. */
  bounds: [number, number, number, number, number, number];
}

const SLOT_ATTR = {
  A: { pos: 'position', col: 'colA', nrm: 'nrmA', meta: 'metaA' },
  B: { pos: 'posB', col: 'colB', nrm: 'nrmB', meta: 'metaB' },
} as const;

function poseMatrix(pose: [number, number, number]): THREE.Matrix3 {
  const m4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose[0], pose[1], pose[2], 'XYZ'));
  return new THREE.Matrix3().setFromMatrix4(m4);
}

/**
 * GPU particle cloud with two shape slots. All animation (morphing,
 * dissolving, collapsing, finger interaction) happens in the vertex shader,
 * so the CPU only touches buffers when a new shape is loaded into a slot.
 */
export class ParticleCloud {
  readonly capacity: number;
  readonly group = new THREE.Group();
  readonly geometry = new THREE.BufferGeometry();
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly main: THREE.Points;
  private readonly halo: THREE.Points;
  readonly slots: Record<Slot, SlotInfo> = {
    A: { cloud: null, bounds: [-1, -1, -1, 1, 1, 1] },
    B: { cloud: null, bounds: [-1, -1, -1, 1, 1, 1] },
  };

  constructor(capacity: number) {
    this.capacity = capacity;
    const g = this.geometry;
    const dyn = (size: number) => {
      const a = new THREE.BufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    for (const slot of ['A', 'B'] as const) {
      const n = SLOT_ATTR[slot];
      g.setAttribute(n.pos, dyn(3));
      g.setAttribute(n.col, dyn(3));
      g.setAttribute(n.nrm, dyn(3));
      g.setAttribute(n.meta, dyn(2));
    }
    const rnd = new Float32Array(capacity * 4);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 4));
    // Points move far from their rest positions; skip culling entirely.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);

    this.uniforms = {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uScatter: { value: 1 },
      uCollapse: { value: 0 },
      uAnimA: { value: 0 },
      uAnimB: { value: 0 },
      uPoseA: { value: new THREE.Matrix3() },
      uPoseB: { value: new THREE.Matrix3() },
      uGlowA: { value: 0 },
      uGlowB: { value: 0 },
      uPointSize: { value: 0.016 },
      uObjectScale: { value: 1 },
      uViewportHeight: { value: 800 },
      uFingers: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uFingerRadius: { value: 0.35 },
      uLightDir: { value: new THREE.Vector3(0.35, 0.65, 0.68).normalize() },
      uHalo: { value: 0 },
      uHaloSize: { value: 4.5 },
      uHaloFraction: { value: 0.12 },
      uHaloStrength: { value: 0.22 },
      uOpacity: { value: 1 },
    };

    const vertexShader = vert.replace('#include <noise>', noise);
    const mainMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: frag,
      depthWrite: true,
      depthTest: true,
    });
    // The halo pass shares buffers and most uniforms but flips uHalo.
    const haloUniforms = { ...this.uniforms, uHalo: { value: 1 } };
    const haloMat = new THREE.ShaderMaterial({
      uniforms: haloUniforms,
      vertexShader,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.main = new THREE.Points(g, mainMat);
    this.halo = new THREE.Points(g, haloMat);
    this.main.frustumCulled = false;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 2;
    this.group.add(this.main, this.halo);
  }

  /** Copy a cloud into one of the two slots. */
  load(slot: Slot, cloud: PointCloud): void {
    if (cloud.count !== this.capacity) {
      throw new Error(`Cloud "${cloud.name}" has ${cloud.count} points, expected ${this.capacity}`);
    }
    const n = SLOT_ATTR[slot];
    const g = this.geometry;
    const set = (name: string, data: Float32Array) => {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      (attr.array as Float32Array).set(data);
      attr.clearUpdateRanges();
      attr.needsUpdate = true;
    };
    set(n.pos, cloud.positions);
    set(n.col, cloud.colors);
    set(n.nrm, cloud.normals);
    const meta = new Float32Array(this.capacity * 2);
    for (let i = 0; i < this.capacity; i++) {
      meta[i * 2] = cloud.sizes[i];
      meta[i * 2 + 1] = cloud.anim[i];
    }
    set(n.meta, meta);

    const pose = poseMatrix(cloud.pose);
    this.uniforms[`uPose${slot}`].value = pose;
    this.uniforms[`uAnim${slot}`].value = cloud.animType;
    this.uniforms[`uGlow${slot}`].value = cloud.glow;
    this.slots[slot] = { cloud, bounds: posedBounds(cloud, pose) };
  }

  setHaloEnabled(on: boolean): void {
    this.halo.visible = on;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.main.material as THREE.Material).dispose();
    (this.halo.material as THREE.Material).dispose();
  }
}

/** Bounds of the cloud after its resting pose rotation. */
function posedBounds(cloud: PointCloud, pose: THREE.Matrix3): SlotInfo['bounds'] {
  const e = pose.elements; // column-major
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const p = cloud.positions;
  // A strided sample is plenty for a bounding box.
  const step = Math.max(1, Math.floor(cloud.count / 40000));
  for (let i = 0; i < cloud.count; i += step) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const rx = e[0] * x + e[3] * y + e[6] * z;
    const ry = e[1] * x + e[4] * y + e[7] * z;
    const rz = e[2] * x + e[5] * y + e[8] * z;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}
