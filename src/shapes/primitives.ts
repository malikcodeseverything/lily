import type { Rng } from '../core/rng';
import type { CloudBuilder } from './builder';
import { cross, len, norm, sub, type M3, mulM3, type V3 } from './geometry';

export type ColorFn = (p: V3, n: V3, t: number, theta: number) => V3;

export interface TubeOptions {
  /** Centerline as a function of t in [0,1]. */
  center: (t: number) => V3;
  /** Radius at t and angle theta (theta = 0 is the `up` side). */
  radius: (t: number, theta: number) => number;
  count: number;
  color: ColorFn;
  /** Reference "up" used to orient the cross section (may vary along t). */
  up?: V3 | ((t: number) => V3);
  size?: number | ((t: number) => number);
  anim?: (t: number, p: V3) => number;
  /** Max radius, used for area-weighted rejection sampling. */
  maxRadius?: number;
}

/**
 * Scatter points over the surface of a generalized tube. Points are
 * distributed roughly proportionally to surface area so thick parts are
 * not starved and thin parts are not oversampled.
 */
export function tube(b: CloudBuilder, rng: Rng, o: TubeOptions): void {
  const upAt = typeof o.up === 'function' ? o.up : () => (o.up as V3 | undefined) ?? ([0, 0, 1] as V3);
  const maxR = o.maxRadius ?? estimateMaxRadius(o);
  let placed = 0;
  let guard = 0;
  while (placed < o.count && guard++ < o.count * 40) {
    const t = rng.next();
    const theta = rng.next() * Math.PI * 2;
    const r = o.radius(t, theta);
    // Accept with probability proportional to local circumference * speed.
    const p0 = o.center(Math.max(t - 0.002, 0));
    const p1 = o.center(Math.min(t + 0.002, 1));
    const tangent = sub(p1, p0);
    const speed = len(tangent);
    if (rng.next() * maxR > r) continue;
    // Speed weighting: tubes are parameterized unevenly, compensate.
    if (rng.next() > Math.min(1, speed / (0.004 * 2.2) / 1.2 + 0.15)) continue;

    const tn = norm(tangent);
    const up = upAt(t);
    let side = cross(tn, up);
    if (len(side) < 1e-4) side = cross(tn, [1, 0, 0]);
    side = norm(side);
    const upv = norm(cross(side, tn));
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const n: V3 = [upv[0] * c + side[0] * s, upv[1] * c + side[1] * s, upv[2] * c + side[2] * s];
    const center = o.center(t);
    const p: V3 = [center[0] + n[0] * r, center[1] + n[1] * r, center[2] + n[2] * r];
    const col = o.color(p, n, t, theta);
    const size = typeof o.size === 'function' ? o.size(t) : (o.size ?? 1);
    b.push(p[0], p[1], p[2], col[0], col[1], col[2], n[0], n[1], n[2], size, o.anim ? o.anim(t, p) : 0);
    placed++;
  }
}

function estimateMaxRadius(o: TubeOptions): number {
  let m = 0;
  for (let i = 0; i <= 64; i++) {
    for (let j = 0; j < 8; j++) m = Math.max(m, o.radius(i / 64, (j / 8) * Math.PI * 2));
  }
  return m || 1;
}

/** Points on an ellipsoid surface with optional shell thickness jitter. */
export function ellipsoid(
  b: CloudBuilder,
  rng: Rng,
  o: {
    center: V3;
    radii: V3;
    rot?: M3;
    count: number;
    color: (p: V3, n: V3, local: V3) => V3;
    size?: number;
    anim?: number | ((p: V3) => number);
    /** 0 = surface only, 1 = fill volume. */
    fill?: number;
  },
): void {
  const tmp: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < o.count; i++) {
    rng.onSphere(tmp);
    const depth = o.fill ? 1 - o.fill * Math.pow(rng.next(), 2) : 1;
    const local: V3 = [tmp[0] * o.radii[0] * depth, tmp[1] * o.radii[1] * depth, tmp[2] * o.radii[2] * depth];
    let n: V3 = norm([tmp[0] / o.radii[0], tmp[1] / o.radii[1], tmp[2] / o.radii[2]]);
    let p = local;
    if (o.rot) {
      p = mulM3(o.rot, p);
      n = mulM3(o.rot, n);
    }
    p = [p[0] + o.center[0], p[1] + o.center[1], p[2] + o.center[2]];
    const col = o.color(p, n, [tmp[0] * depth, tmp[1] * depth, tmp[2] * depth]);
    const anim = typeof o.anim === 'function' ? o.anim(p) : (o.anim ?? 0);
    b.push(p[0], p[1], p[2], col[0], col[1], col[2], n[0], n[1], n[2], o.size ?? 1, anim);
  }
}

/**
 * Uniformly sample a triangle. Used for wing membranes and leaf blades
 * built as fans of triangles.
 */
export function triangle(
  b: CloudBuilder,
  rng: Rng,
  a: V3,
  bb: V3,
  c: V3,
  count: number,
  color: (p: V3, uvw: V3) => V3,
  opts: { size?: number; anim?: (p: V3, uvw: V3) => number; offset?: (p: V3, uvw: V3) => number } = {},
): void {
  const n = norm(cross(sub(bb, a), sub(c, a)));
  for (let i = 0; i < count; i++) {
    let u = rng.next();
    let v = rng.next();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    const uvw: V3 = [w, u, v];
    let p: V3 = [
      a[0] * w + bb[0] * u + c[0] * v,
      a[1] * w + bb[1] * u + c[1] * v,
      a[2] * w + bb[2] * u + c[2] * v,
    ];
    if (opts.offset) {
      const off = opts.offset(p, uvw);
      p = [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off];
    }
    const col = color(p, uvw);
    b.push(p[0], p[1], p[2], col[0], col[1], col[2], n[0], n[1], n[2], opts.size ?? 1, opts.anim ? opts.anim(p, uvw) : 0);
  }
}

/** Area of a triangle, for splitting a point budget across a fan. */
export function triArea(a: V3, b: V3, c: V3): number {
  return len(cross(sub(b, a), sub(c, a))) / 2;
}

/**
 * Scatter points inside a straight-edged 2D polygon and map each sample to
 * 3D with a callback. Used for flat panels such as wings and fins.
 */
export function panel(
  b: CloudBuilder,
  rng: Rng,
  poly: [number, number][],
  count: number,
  map: (u: number, v: number) => { p: V3; n: V3; c: V3; size?: number; anim?: number } | null,
): void {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of poly) {
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 30) {
    const u = rng.range(minU, maxU);
    const v = rng.range(minV, maxV);
    if (!inPoly(u, v, poly)) continue;
    const s = map(u, v);
    if (!s) continue;
    b.push(s.p[0], s.p[1], s.p[2], s.c[0], s.c[1], s.c[2], s.n[0], s.n[1], s.n[2], s.size ?? 1, s.anim ?? 0);
    placed++;
  }
}

function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
