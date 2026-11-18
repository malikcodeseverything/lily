import type { AnimType, PointCloud } from './types';

/**
 * Growable struct-of-arrays buffer used by the procedural generators.
 * Generators push points freely, then `finish` normalizes the result and
 * resamples it to the exact point budget the renderer expects.
 */
export class CloudBuilder {
  private cap: number;
  length = 0;
  pos: Float32Array;
  col: Float32Array;
  nrm: Float32Array;
  size: Float32Array;
  anim: Float32Array;

  constructor(initial = 1 << 16) {
    this.cap = initial;
    this.pos = new Float32Array(initial * 3);
    this.col = new Float32Array(initial * 3);
    this.nrm = new Float32Array(initial * 3);
    this.size = new Float32Array(initial);
    this.anim = new Float32Array(initial);
  }

  private grow(): void {
    const cap = this.cap * 2;
    const re = (a: Float32Array, s: number) => {
      const b = new Float32Array(cap * s);
      b.set(a);
      return b;
    };
    this.pos = re(this.pos, 3);
    this.col = re(this.col, 3);
    this.nrm = re(this.nrm, 3);
    this.size = re(this.size, 1);
    this.anim = re(this.anim, 1);
    this.cap = cap;
  }

  push(
    x: number, y: number, z: number,
    r: number, g: number, b: number,
    nx = 0, ny = 0, nz = 0,
    size = 1,
    anim = 0,
  ): void {
    if (this.length >= this.cap) this.grow();
    const i = this.length++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-6) {
      this.nrm[i3] = nx / l;
      this.nrm[i3 + 1] = ny / l;
      this.nrm[i3 + 2] = nz / l;
    }
    this.size[i] = size;
    this.anim[i] = anim;
  }

  finish(opts: {
    name: string;
    count: number;
    animType: AnimType;
    pose?: [number, number, number];
    glow?: number;
    halo?: number;
    /** Largest extent after normalization. */
    extent?: number;
    seed?: number;
  }): PointCloud {
    const { pos } = this;
    const n = this.length;
    if (n === 0) throw new Error(`${opts.name}: generator produced no points`);

    // Center on the bounding box and scale so the largest side == extent.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const scale = (opts.extent ?? 2.2) / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);

    const index = resampleIndices(n, opts.count, opts.seed ?? 7);
    const out: PointCloud = {
      name: opts.name,
      count: opts.count,
      positions: new Float32Array(opts.count * 3),
      colors: new Float32Array(opts.count * 3),
      normals: new Float32Array(opts.count * 3),
      sizes: new Float32Array(opts.count),
      anim: new Float32Array(opts.count),
      animType: opts.animType,
      pose: opts.pose ?? [0, 0, 0],
      glow: opts.glow ?? 0,
      halo: opts.halo ?? 1,
      bounds: [
        (minX - cx) * scale, (minY - cy) * scale, (minZ - cz) * scale,
        (maxX - cx) * scale, (maxY - cy) * scale, (maxZ - cz) * scale,
      ],
    };
    for (let o = 0; o < opts.count; o++) {
      const i = index[o];
      out.positions[o * 3] = (pos[i * 3] - cx) * scale;
      out.positions[o * 3 + 1] = (pos[i * 3 + 1] - cy) * scale;
      out.positions[o * 3 + 2] = (pos[i * 3 + 2] - cz) * scale;
      for (let k = 0; k < 3; k++) {
        out.colors[o * 3 + k] = this.col[i * 3 + k];
        out.normals[o * 3 + k] = this.nrm[i * 3 + k];
      }
      out.sizes[o] = this.size[i];
      out.anim[o] = this.anim[i];
    }
    return out;
  }
}

/**
 * Pick exactly `target` indices out of `source` points.
 * Downsampling picks a random subset without repeats; upsampling keeps
 * every point and fills the remainder with random repeats. The output is
 * shuffled so that any prefix is a fair sample of the whole shape, which
 * also makes morph pairings between two shapes look uniformly random.
 */
export function resampleIndices(source: number, target: number, seed = 7): Uint32Array {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const out = new Uint32Array(target);
  if (source >= target) {
    const all = new Uint32Array(source);
    for (let i = 0; i < source; i++) all[i] = i;
    for (let i = 0; i < target; i++) {
      const j = i + Math.floor(rand() * (source - i));
      const t = all[i];
      all[i] = all[j];
      all[j] = t;
      out[i] = all[i];
    }
    return out;
  }
  for (let i = 0; i < target; i++) out[i] = i < source ? i : Math.floor(rand() * source);
  for (let i = target - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
