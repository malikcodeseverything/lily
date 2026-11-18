import { describe, expect, it } from 'vitest';
import { parsePly } from '../src/io/ply';
import { rawToCloud } from '../src/io/rawCloud';
import { parseSplat } from '../src/io/splat';

const enc = (s: string) => new TextEncoder().encode(s);

describe('parsePly', () => {
  it('reads an ASCII point cloud with colors', () => {
    const text = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
`;
    const raw = parsePly(enc(text).buffer as ArrayBuffer);
    expect(raw.count).toBe(3);
    expect(raw.isSplat).toBe(false);
    expect([...raw.positions.slice(3, 6)]).toEqual([1, 0, 0]);
    expect(raw.colors[0]).toBeCloseTo(1);
    expect(raw.colors[4]).toBeCloseTo(1);
  });

  it('decodes a binary 3D Gaussian Splatting PLY', () => {
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2'];
    const header = `ply\nformat binary_little_endian 1.0\nelement vertex 2\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
    const h = enc(header);
    const body = new Float32Array([
      1, 2, 3, 0, 0, 0, 10, -2, -2, -2,
      4, 5, 6, 1.7724, -1.7724, 0, -10, -1, -1, -1,
    ]);
    const buf = new Uint8Array(h.length + body.byteLength);
    buf.set(h, 0);
    buf.set(new Uint8Array(body.buffer), h.length);
    const raw = parsePly(buf.buffer);
    expect(raw.isSplat).toBe(true);
    expect([...raw.positions.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(raw.colors[0]).toBeCloseTo(0.5, 3);
    expect(raw.colors[3]).toBeCloseTo(1, 2);
    expect(raw.colors[4]).toBeCloseTo(0, 2);
    expect(raw.opacity![0]).toBeGreaterThan(0.99);
    expect(raw.opacity![1]).toBeLessThan(0.01);
    expect(raw.sizes![0]).toBeCloseTo(Math.exp(-2), 4);
  });

  it('rejects files that are not PLY', () => {
    expect(() => parsePly(enc('hello').buffer as ArrayBuffer)).toThrow(/PLY/);
  });
});

describe('parseSplat', () => {
  it('reads 32-byte rows', () => {
    const buf = new ArrayBuffer(64);
    const f = new Float32Array(buf);
    const u = new Uint8Array(buf);
    f.set([1, 2, 3, 0.1, 0.1, 0.1], 0);
    u.set([255, 128, 0, 200], 24);
    f.set([4, 5, 6, 0.2, 0.2, 0.2], 8);
    u.set([0, 0, 255, 50], 56);
    const raw = parseSplat(buf);
    expect(raw.count).toBe(2);
    expect([...raw.positions.slice(3, 6)]).toEqual([4, 5, 6]);
    expect(raw.colors[0]).toBeCloseTo(1);
    expect(raw.opacity![1]).toBeCloseTo(50 / 255);
  });
});

describe('rawToCloud', () => {
  it('drops faint splats and crops far outliers before resampling', () => {
    const n = 2000;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3).fill(0.5);
    const opacity = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = Math.sin(i) * 0.5;
      positions[i * 3 + 1] = Math.cos(i * 1.3) * 0.5;
      positions[i * 3 + 2] = Math.sin(i * 0.7) * 0.5;
    }
    // A floater a hundred units away and an invisible splat.
    positions.set([100, 100, 100], 0);
    opacity[1] = 0.01;
    const cloud = rawToCloud({ count: n, positions, colors, opacity }, 'scan', 500);
    expect(cloud.count).toBe(500);
    const extent = Math.max(cloud.bounds[3] - cloud.bounds[0], cloud.bounds[4] - cloud.bounds[1]);
    expect(extent).toBeCloseTo(2.2, 1);
    expect(cloud.positions.every((v) => Math.abs(v) <= 1.2)).toBe(true);
  });
});
