import { CloudBuilder } from '../shapes/builder';
import { AnimType, type PointCloud } from '../shapes/types';

/** Intermediate format every importer produces. */
export interface RawCloud {
  count: number;
  positions: Float32Array;
  /** rgb 0..1 */
  colors: Float32Array;
  normals?: Float32Array;
  /** Relative point sizes, optional. */
  sizes?: Float32Array;
  /** Per point opacity 0..1, optional (used to drop faint splats). */
  opacity?: Float32Array;
}

/**
 * Turn an imported scan into a renderable cloud: drop near-invisible
 * splats, crop outlier "floaters" with a percentile box, then center,
 * scale and resample to the renderer's point budget.
 */
export function rawToCloud(raw: RawCloud, name: string, capacity: number, pose: [number, number, number] = [0, 0, 0]): PointCloud {
  const keep = new Uint8Array(raw.count).fill(1);
  if (raw.opacity) for (let i = 0; i < raw.count; i++) if (raw.opacity[i] < 0.15) keep[i] = 0;

  // Robust bounds: 1st to 99th percentile per axis, expanded a little.
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const sample: number[] = [];
    const step = Math.max(1, Math.floor(raw.count / 50000));
    for (let i = 0; i < raw.count; i += step) if (keep[i]) sample.push(raw.positions[i * 3 + axis]);
    sample.sort((a, b) => a - b);
    const a = sample[Math.floor(sample.length * 0.01)] ?? 0;
    const b = sample[Math.floor(sample.length * 0.99)] ?? 0;
    const pad = (b - a) * 0.08;
    lo[axis] = a - pad;
    hi[axis] = b + pad;
  }

  // Size stats so imported sizes land around 1.
  let sizeMean = 1;
  if (raw.sizes) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < raw.count; i += 7) {
      s += raw.sizes[i];
      n++;
    }
    sizeMean = s / Math.max(n, 1) || 1;
  }

  const b = new CloudBuilder(Math.min(raw.count, 1 << 22));
  for (let i = 0; i < raw.count; i++) {
    if (!keep[i]) continue;
    const x = raw.positions[i * 3];
    const y = raw.positions[i * 3 + 1];
    const z = raw.positions[i * 3 + 2];
    if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
    const nx = raw.normals ? raw.normals[i * 3] : 0;
    const ny = raw.normals ? raw.normals[i * 3 + 1] : 0;
    const nz = raw.normals ? raw.normals[i * 3 + 2] : 0;
    const size = raw.sizes ? Math.min(2.5, Math.max(0.6, raw.sizes[i] / sizeMean)) : 1;
    b.push(x, y, z, raw.colors[i * 3], raw.colors[i * 3 + 1], raw.colors[i * 3 + 2], nx, ny, nz, size, 0);
  }
  if (b.length === 0) throw new Error('No visible points in this file.');
  return b.finish({ name, count: capacity, animType: AnimType.None, pose, seed: 101 });
}
