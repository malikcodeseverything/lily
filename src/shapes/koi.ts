import { Rng } from '../core/rng';
import { clamp, mix3, smoothstep } from '../core/math';
import { fbm3, worley2 } from '../core/noise';
import { CloudBuilder } from './builder';
import type { V3 } from './geometry';
import { ellipsoid, panel, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

const WHITE: V3 = [0.96, 0.95, 0.92];
const HI: V3 = [0.95, 0.32, 0.08];
const SUMI: V3 = [0.06, 0.06, 0.07];

const HEAD = 0.9;
const LEN = 1.6;
/** Body parameter 0 (snout) to 1 (tail base). */
const ax = (x: number) => clamp((HEAD - x) / LEN);

function halfHeight(a: number): number {
  if (a < 0.22) return 0.23 * Math.pow(a / 0.22, 0.42) * (0.8 + 0.2 * (a / 0.22));
  return Math.max(0.035, 0.23 * Math.cos(((a - 0.22) / 0.78) * 1.34));
}

/** Kohaku pattern with a few sumi spots (a "Sanke" variety). */
function skin(x: number, y: number, z: number, dorsal: number): V3 {
  const red = fbm3(x * 2.4 + 3.1, y * 3.2, z * 3.2, 3);
  let c = WHITE;
  if (red > 0.02 && dorsal > -0.35 && x < 0.86) c = mix3(WHITE, HI, smoothstep(0.02, 0.1, red));
  const ink = fbm3(x * 4.2 + 11, y * 5, z * 5, 2);
  if (ink > 0.42 && dorsal > 0.1) c = SUMI;
  return c;
}

export function buildKoi(count: number): PointCloud {
  const rng = new Rng(808);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.04);

  // Body: rounded, slightly compressed sides, glinting scales.
  tube(b, rng, {
    center: (t) => [HEAD - t * LEN, 0.02 * Math.sin(t * Math.PI), 0],
    radius: (t, th) => {
      const h = halfHeight(t);
      const w = h * 0.86;
      return 1 / Math.sqrt((Math.cos(th) / h) ** 2 + (Math.sin(th) / w) ** 2);
    },
    up: [0, 1, 0],
    count: Math.floor(N * 0.52),
    color: (p, n, t, th) => {
      let c = skin(p[0], p[1], p[2], n[1]);
      const sc = worley2(t * 46, th * 7, 4);
      const edge = smoothstep(0.32, 0.5, sc.d);
      const k = (1 - 0.18 * edge) * (1 + 0.25 * Math.pow(1 - sc.d, 6));
      c = [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
      return c;
    },
    anim: (t) => t,
  });

  // Eyes and barbels.
  for (const s of [1, -1]) {
    ellipsoid(b, rng, { center: [0.76, 0.045, s * 0.085], radii: [0.022, 0.022, 0.012], count: Math.floor(N * 0.003), color: () => [0.05, 0.05, 0.06], size: 1.1, anim: 0.08 });
    tube(b, rng, {
      center: (t) => [0.88 - t * 0.04, -0.03 - t * 0.05, s * (0.03 + t * 0.05)],
      radius: () => 0.004,
      count: Math.floor(N * 0.0015),
      color: () => [0.9, 0.85, 0.8],
      size: 0.7,
      anim: () => 0.02,
    });
  }

  // Fins: translucent with radiating rays.
  const fin = (poly: [number, number][], count: number, place: (u: number, v: number) => V3, normal: V3, anim: (u: number, v: number) => number, tint: V3) =>
    panel(b, rng, poly, count, (u, v) => {
      const ray = 0.8 + 0.2 * Math.abs(Math.sin(Math.atan2(v, u) * 22));
      const c = mix3(WHITE, tint, 0.35 * (0.5 + 0.5 * fbm3(u * 6, v * 6, 2, 2)));
      return { p: place(u, v), n: normal, c: [c[0] * ray, c[1] * ray, c[2] * ray], size: 0.9, anim: anim(u, v) };
    });

  // Forked tail fin in the vertical plane.
  fin(
    [[-0.68, 0.02], [-0.86, 0.24], [-1.12, 0.34], [-1.0, 0.04], [-1.0, -0.04], [-1.12, -0.34], [-0.86, -0.24], [-0.68, -0.02]],
    Math.floor(N * 0.14),
    (x, y) => [x, y, 0.015 * Math.sin(y * 9)],
    [0, 0, 1],
    (x) => Math.min(1, ax(x) + 0.1),
    HI,
  );
  // Dorsal fin along the back.
  fin(
    [[0.2, 0], [0.12, 0.13], [-0.1, 0.14], [-0.42, 0.06], [-0.46, 0]],
    Math.floor(N * 0.06),
    (x, h) => [x, halfHeight(ax(x)) * 0.92 + h, 0.01 * Math.sin(x * 30)],
    [0, 0, 1],
    (x) => ax(x),
    HI,
  );
  // Large paddle-like pectoral fins, and small pelvic fins.
  for (const s of [1, -1]) {
    fin(
      [[0, 0], [0.04, 0.2], [-0.12, 0.26], [-0.16, 0.08]],
      Math.floor(N * 0.05),
      (u, v) => [0.5 + u, -0.08 - v * 0.35, s * (0.1 + v * 0.75)],
      [0, 0.9, s * 0.4],
      (_u, v) => 2 + v * 4,
      WHITE,
    );
    fin(
      [[0, 0], [-0.02, 0.1], [-0.12, 0.12], [-0.1, 0]],
      Math.floor(N * 0.015),
      (u, v) => [-0.05 + u, -0.12 - v * 0.5, s * (0.06 + v * 0.5)],
      [0, 0.8, s * 0.5],
      (u) => ax(-0.05 + u),
      WHITE,
    );
  }

  return b.finish({ name: 'Koi', count, animType: AnimType.Swim, pose: [0.95, 0.5, 0.12], seed: 89 });
}
