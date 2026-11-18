import type { RawCloud } from './rawCloud';

/**
 * The compact ".splat" format popularized by web splat viewers: 32 bytes
 * per splat = position (3 x f32), scale (3 x f32), rgba (4 x u8),
 * rotation (4 x u8).
 */
export function parseSplat(buf: ArrayBuffer): RawCloud {
  const ROW = 32;
  if (buf.byteLength % ROW !== 0) throw new Error('Not a .splat file (size is not a multiple of 32 bytes).');
  const n = buf.byteLength / ROW;
  const f = new Float32Array(buf);
  const u = new Uint8Array(buf);
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const opacity = new Float32Array(n);
  const sizes = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = f[i * 8];
    positions[i * 3 + 1] = f[i * 8 + 1];
    positions[i * 3 + 2] = f[i * 8 + 2];
    sizes[i] = Math.cbrt(Math.abs(f[i * 8 + 3] * f[i * 8 + 4] * f[i * 8 + 5])) || 1e-3;
    colors[i * 3] = u[i * ROW + 24] / 255;
    colors[i * 3 + 1] = u[i * ROW + 25] / 255;
    colors[i * 3 + 2] = u[i * ROW + 26] / 255;
    opacity[i] = u[i * ROW + 27] / 255;
  }
  return { count: n, positions, colors, opacity, sizes };
}
