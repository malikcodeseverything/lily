import { describe, expect, it } from 'vitest';
import { CloudBuilder, resampleIndices } from '../src/shapes/builder';
import { BUILTIN_SHAPES } from '../src/shapes/registry';
import { AnimType } from '../src/shapes/types';

describe('resampleIndices', () => {
  it('downsamples without repeats', () => {
    const idx = resampleIndices(1000, 300, 3);
    expect(new Set(idx).size).toBe(300);
    expect(Math.max(...idx)).toBeLessThan(1000);
  });

  it('upsamples keeping every source point', () => {
    const idx = resampleIndices(100, 250, 3);
    expect(idx.length).toBe(250);
    expect(new Set(idx).size).toBe(100);
  });

  it('is deterministic for a given seed', () => {
    expect([...resampleIndices(500, 50, 9)]).toEqual([...resampleIndices(500, 50, 9)]);
  });
});

describe('CloudBuilder', () => {
  it('centers and scales so the largest side matches the extent', () => {
    const b = new CloudBuilder(4);
    b.push(10, 10, 10, 1, 0, 0);
    b.push(14, 11, 10, 0, 1, 0);
    b.push(12, 12, 11, 0, 0, 1);
    const c = b.finish({ name: 't', count: 3, animType: AnimType.None, extent: 2 });
    const [x0, y0, z0, x1, y1, z1] = c.bounds;
    expect(x1 - x0).toBeCloseTo(2, 6);
    expect((x0 + x1) / 2).toBeCloseTo(0, 6);
    expect((y0 + y1) / 2).toBeCloseTo(0, 6);
    expect(z1 - z0).toBeCloseTo(0.5, 6);
  });
});

describe('built-in shapes', () => {
  for (const def of BUILTIN_SHAPES) {
    it(`${def.name} produces exactly the requested number of finite points`, () => {
      const c = def.build(6000);
      expect(c.count).toBe(6000);
      expect(c.positions.length).toBe(18000);
      expect(c.positions.every(Number.isFinite)).toBe(true);
      expect(c.colors.every((v) => v >= 0 && v <= 1.5)).toBe(true);
      const extent = Math.max(c.bounds[3] - c.bounds[0], c.bounds[4] - c.bounds[1], c.bounds[5] - c.bounds[2]);
      // Normalized to fit the view; some objects get a little more room.
      expect(extent).toBeGreaterThan(2.0);
      expect(extent).toBeLessThan(2.45);
    });
  }
});

describe('poseToM3', () => {
  it('matches the rotation three.js builds for an XYZ Euler pose', async () => {
    const THREE = await import('three');
    const { poseToM3 } = await import('../src/shapes/geometry');
    const [x, y, z] = [0.42, 0.2, 0.32];
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')).elements;
    const r = poseToM3(x, y, z);
    // three.js stores column-major; compare row-major entries.
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) expect(r[row * 3 + col]).toBeCloseTo(m[col * 4 + row], 10);
  });
});
