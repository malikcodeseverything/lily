import { Rng } from '../core/rng';
import { clamp, lerp, mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import { closedCatmull2D, distToPolygon, norm, pointInPolygon, type V3 } from './geometry';
import { ellipsoid, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

// Kohaku-style koi: pearly white with deep orange-red patches and a few
// small black (sumi) marks.
const PEARL: V3 = [0.97, 0.96, 0.93];
const BELLY: V3 = [0.93, 0.94, 0.95];
const HI: V3 = [0.94, 0.27, 0.06];
const SUMI: V3 = [0.05, 0.05, 0.06];
const FIN: V3 = [0.95, 0.93, 0.9];

const HEAD = 0.92;
const LEN = 1.62;
/** Body parameter: 0 at the snout, 1 at the base of the tail. */
const ax = (x: number) => clamp((HEAD - x) / LEN);

// Half-height of the body along its length (smoothly interpolated).
const PROFILE_A = [0, 0.03, 0.08, 0.15, 0.26, 0.38, 0.52, 0.68, 0.84, 1.0];
const PROFILE_H = [0.02, 0.1, 0.16, 0.205, 0.238, 0.245, 0.225, 0.17, 0.105, 0.058];
function halfHeight(a: number): number {
  for (let i = 0; i < PROFILE_A.length - 1; i++) {
    if (a <= PROFILE_A[i + 1]) {
      const t = (a - PROFILE_A[i]) / (PROFILE_A[i + 1] - PROFILE_A[i]);
      return lerp(PROFILE_H[i], PROFILE_H[i + 1], t * t * (3 - 2 * t));
    }
  }
  return PROFILE_H[PROFILE_H.length - 1];
}
const halfWidth = (a: number) => halfHeight(a) * (0.8 + 0.08 * (1 - smoothstep(0.1, 0.3, a)));

/** Body surface point for parameter a and angle th (0 = top). */
function bodyPoint(a: number, th: number): V3 {
  const h = halfHeight(a);
  const w = halfWidth(a);
  const belly = Math.cos(th) < 0 ? 0.9 : 1; // slightly flatter belly
  const y = Math.cos(th) * h * belly + 0.02 * Math.sin(Math.PI * a);
  return [HEAD - a * LEN, y, Math.sin(th) * w];
}

/** Red patches with crisp edges, kept off the snout and belly. */
function pattern(x: number, y: number, z: number, a: number, top: number): V3 {
  let c = mix3(BELLY, PEARL, smoothstep(-0.6, 0.0, top));
  // Low-frequency noise gives bold, clean-edged patches.
  const n = fbm3(x * 1.5 + 4.3, y * 1.7, z * 1.7, 2) + 0.16 * Math.cos(a * 8.5) + 0.04;
  const hiMask = smoothstep(0.0, 0.025, n) * smoothstep(-0.45, -0.1, top) * smoothstep(0.06, 0.1, a) * (1 - smoothstep(0.9, 0.97, a));
  c = mix3(c, HI, hiMask);
  const ink = fbm3(x * 4.2 + 9, y * 4.5, z * 4.5, 2);
  if (ink > 0.47 && top > 0.3 && a > 0.22 && a < 0.78) c = SUMI;
  return c;
}

/**
 * Overlapping scales in staggered rows. Returns a brightness multiplier:
 * a darker crescent at each scale's trailing edge and a soft highlight
 * near its front.
 */
function scales(s: number, arc: number, top: number): number {
  const u = s / 0.034;
  const row = Math.floor(u);
  const v = arc / 0.03 + (row % 2) * 0.5;
  const fu = u - row;
  const fv = v - Math.floor(v) - 0.5;
  const d = Math.hypot(fu - 0.1, fv * 1.15);
  const edge = smoothstep(0.5, 0.6, d) * (1 - smoothstep(0.62, 0.7, d));
  const sheen = Math.pow(1 - clamp(d / 0.5), 3) * 0.12;
  const weight = smoothstep(-0.5, 0.2, top);
  return 1 - edge * 0.16 * weight + sheen * weight;
}

interface FinOptions {
  outline: [number, number][];
  /** Point the rays radiate from, in outline space. */
  root: [number, number];
  count: number;
  place: (u: number, v: number) => V3;
  normal: V3;
  anim: (u: number, v: number) => number;
  /** Fraction of the fin (from the root) tinted orange. */
  baseTint?: number;
}

/** A translucent-looking fin: soft feathered edge, bright rays, pale membrane. */
function fin(b: CloudBuilder, rng: Rng, o: FinOptions): void {
  const poly = closedCatmull2D(o.outline, 10);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of poly) {
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const reach = Math.max(maxU - minU, maxV - minV);
  let placed = 0;
  let guard = 0;
  while (placed < o.count && guard++ < o.count * 40) {
    const u = rng.range(minU, maxU);
    const v = rng.range(minV, maxV);
    if (!pointInPolygon(u, v, poly)) continue;
    const edge = distToPolygon(u, v, poly);
    // Thin out toward the rim for a gauzy edge.
    if (rng.next() > 0.35 + 0.65 * smoothstep(0, 0.035, edge)) continue;
    const du = u - o.root[0];
    const dv = v - o.root[1];
    const r = Math.hypot(du, dv) / reach;
    const ang = Math.atan2(dv, du);
    const ray = Math.pow(Math.abs(Math.cos(ang * 26)), 10);
    let c = mix3(FIN, [0.82, 0.86, 0.9], 0.35);
    c = mix3(c, [1, 1, 1], ray * 0.55);
    if (o.baseTint) c = mix3(c, HI, (1 - smoothstep(o.baseTint * 0.6, o.baseTint, r)) * 0.85);
    const k = 0.78 + 0.22 * (1 - r);
    const p = o.place(u, v);
    b.push(p[0], p[1], p[2], c[0] * k, c[1] * k, c[2] * k, o.normal[0], o.normal[1], o.normal[2], 0.62 + 0.25 * smoothstep(0, 0.03, edge), o.anim(u, v));
    placed++;
  }
}

export function buildKoi(count: number): PointCloud {
  const rng = new Rng(808);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);

  // Body with scales; area-weighted sampling over (a, th).
  const bodyBudget = Math.floor(N * 0.52);
  let placed = 0;
  while (placed < bodyBudget) {
    const a = rng.next();
    const th = rng.next() * Math.PI * 2;
    const h = halfHeight(a);
    if (rng.next() * 0.25 > h) continue;
    const p = bodyPoint(a, th);
    const pa = bodyPoint(Math.min(1, a + 0.004), th);
    const pt = bodyPoint(a, th + 0.01);
    const n = norm(crossV([pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]], [pt[0] - p[0], pt[1] - p[1], pt[2] - p[2]]));
    const top = Math.cos(th);
    let c = pattern(p[0], p[1], p[2], a, top);
    const k = scales(a * LEN, th * (h + halfWidth(a)) * 0.5, top) * (0.97 + 0.03 * rng.next());
    // Gill plate: a faint crescent behind the eye.
    const gill = Math.abs(a - (0.19 + 0.025 * Math.cos(th * 2))) < 0.006 && top > -0.6 ? 0.82 : 1;
    c = [c[0] * k * gill, c[1] * k * gill, c[2] * k * gill];
    b.push(p[0], p[1], p[2], c[0], c[1], c[2], -n[0], -n[1], -n[2], 0.85, a);
    placed++;
  }

  // Eyes: gold iris with a black pupil, slightly domed.
  for (const s of [1, -1]) {
    const e = bodyPoint(0.085, (Math.PI / 2) * s - 0.55 * s);
    ellipsoid(b, rng, {
      center: [e[0], e[1], e[2] + s * 0.004],
      radii: [0.03, 0.03, 0.012],
      count: Math.floor(N * 0.004),
      color: (_p, _n, l) => {
        const r = Math.hypot(l[0], l[1]);
        return r < 0.55 ? [0.03, 0.03, 0.04] : r < 0.85 ? [0.88, 0.66, 0.24] : [0.75, 0.72, 0.68];
      },
      size: 0.8,
      anim: 0.085,
    });
  }
  // Lips at the snout and two pairs of barbels.
  for (let i = 0; i < Math.floor(N * 0.004); i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 0.028 + 0.006 * rng.next();
    b.push(HEAD + 0.005, -0.045 + Math.sin(a) * r * 0.6, Math.cos(a) * r, 0.92, 0.72, 0.66, 1, 0, 0, 0.8, 0);
  }
  for (const s of [1, -1]) {
    for (const [len, dy] of [[0.07, 0], [0.04, 0.015]] as const) {
      tube(b, rng, {
        center: (t) => [HEAD - 0.01 - t * len * 0.4, -0.06 - dy - t * len * 0.6, s * (0.02 + t * len * 0.7)],
        radius: (t) => 0.005 * (1 - 0.6 * t),
        count: Math.floor(N * 0.0012),
        color: () => [0.93, 0.85, 0.8],
        size: 0.6,
        anim: () => 0.02,
      });
    }
  }

  // Tail: two flowing lobes with rays fanning from the peduncle.
  fin(b, rng, {
    outline: [
      [-0.68, 0.055], [-0.8, 0.15], [-0.98, 0.27], [-1.16, 0.35], [-1.17, 0.27], [-1.08, 0.13], [-1.02, 0.0],
      [-1.08, -0.13], [-1.17, -0.27], [-1.16, -0.35], [-0.98, -0.27], [-0.8, -0.15], [-0.68, -0.055],
    ],
    root: [-0.68, 0],
    count: Math.floor(N * 0.16),
    place: (x, y) => [x, y, 0.035 * Math.sin(y * 9 + x * 5)],
    normal: [0, 0, 1],
    anim: () => 1,
    baseTint: 0.25,
  });

  // Dorsal fin: tall at the front, sloping back.
  fin(b, rng, {
    outline: [[0.34, 0], [0.3, 0.07], [0.2, 0.14], [0.02, 0.13], [-0.2, 0.09], [-0.36, 0.05], [-0.44, 0]],
    root: [0.34, 0],
    count: Math.floor(N * 0.07),
    place: (x, h) => [x, halfHeight(ax(x)) * 0.97 + 0.02 * Math.sin(Math.PI * ax(x)) + h, 0.012 * Math.sin(x * 25)],
    normal: [0, 0, 1],
    anim: (x) => ax(x),
    baseTint: 0.35,
  });

  // Pectoral fins: big rounded fans, the koi's signature.
  for (const s of [1, -1]) {
    const root = bodyPoint(0.21, Math.PI * 0.72 * s);
    fin(b, rng, {
      outline: [[0, 0], [0.07, 0.06], [0.19, 0.12], [0.3, 0.11], [0.35, 0.02], [0.31, -0.07], [0.19, -0.09], [0.06, -0.05]],
      root: [0, 0],
      count: Math.floor(N * 0.065),
      place: (u, v) => {
        const curl = 0.04 * u * u * 6;
        return [root[0] - v * 0.6 - u * 0.35, root[1] - u * 0.45 - curl, root[2] + s * (u * 0.75 + v * 0.1)];
      },
      normal: [0, 0.85, s * 0.5],
      anim: (u) => 2 + clamp(u / 0.35),
    });
    // Pelvic fins under the belly.
    const pel = bodyPoint(0.5, Math.PI * 0.8 * s);
    fin(b, rng, {
      outline: [[0, 0], [0.05, 0.04], [0.14, 0.05], [0.17, 0.0], [0.12, -0.04], [0.04, -0.03]],
      root: [0, 0],
      count: Math.floor(N * 0.018),
      place: (u, v) => [pel[0] - u * 0.6 - v * 0.4, pel[1] - u * 0.5, pel[2] + s * u * 0.45],
      normal: [0, 0.8, s * 0.6],
      anim: () => 0.5,
    });
  }
  // Small anal fin.
  fin(b, rng, {
    outline: [[0, 0], [-0.04, -0.07], [-0.14, -0.08], [-0.17, 0]],
    root: [0, 0],
    count: Math.floor(N * 0.015),
    place: (u, v) => [-0.42 + u, -halfHeight(ax(-0.42 + u)) * 0.9 + v, 0],
    normal: [0, 0, 1],
    anim: (u) => ax(-0.42 + u),
  });

  return b.finish({ name: 'Koi', count, animType: AnimType.Swim, pose: [1.05, 0.55, 0.1], seed: 89, halo: 0.5 });
}

function crossV(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
