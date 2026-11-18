import { Rng } from '../core/rng';
import { clamp, lerp, mix3, smoothstep } from '../core/math';
import { fbm3, worley2 } from '../core/noise';
import { CloudBuilder } from './builder';
import { alignY, catmull, cross, mulM3, norm, rotateAxis, sub, type V3 } from './geometry';
import { ellipsoid, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

// Stargazer lily palette.
const CRIMSON: V3 = [0.86, 0.06, 0.27];
const PINK: V3 = [0.98, 0.36, 0.57];
const BLUSH: V3 = [1.0, 0.78, 0.86];
const WHITE: V3 = [1.0, 0.96, 0.97];
const SPOT: V3 = [0.46, 0.01, 0.13];
const THROAT: V3 = [0.78, 0.88, 0.42];
const STEM: V3 = [0.2, 0.46, 0.13];
const LEAF_DARK: V3 = [0.09, 0.32, 0.08];
const LEAF_LIGHT: V3 = [0.36, 0.62, 0.2];

interface PetalSpec {
  azimuth: number;
  length: number;
  width: number;
  /** Elevation at the base (radians above horizontal). */
  lift: number;
  /** How far the petal curls back by the tip (radians). */
  recurve: number;
  seed: number;
}

/** Precomputed centerline of a recurved petal in its (radial, up) plane. */
function petalSpine(spec: PetalSpec, steps = 96): { c: [number, number][]; th: number[] } {
  const c: [number, number][] = [[0, 0]];
  const th: number[] = [spec.lift];
  let x = 0;
  let y = 0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const theta = spec.lift - spec.recurve * Math.pow(u, 1.35);
    x += (Math.cos(theta) * spec.length) / steps;
    y += (Math.sin(theta) * spec.length) / steps;
    c.push([x, y]);
    th.push(theta);
  }
  return { c, th };
}

function petalWidth(u: number, w: number): number {
  return w * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85) * (1 - 0.1 * u);
}

/** Position on a petal surface, in the flower's local frame (axis = +Y). */
function petalPoint(spec: PetalSpec, spine: ReturnType<typeof petalSpine>, u: number, v: number): V3 {
  const f = u * (spine.c.length - 1);
  const i = Math.min(Math.floor(f), spine.c.length - 2);
  const a = f - i;
  const cx = lerp(spine.c[i][0], spine.c[i + 1][0], a);
  const cy = lerp(spine.c[i][1], spine.c[i + 1][1], a);
  const theta = lerp(spine.th[i], spine.th[i + 1], a);

  const R: V3 = [Math.cos(spec.azimuth), 0, Math.sin(spec.azimuth)];
  const S: V3 = [-Math.sin(spec.azimuth), 0, Math.cos(spec.azimuth)];
  const N: V3 = [R[0] * -Math.sin(theta), Math.cos(theta), R[2] * -Math.sin(theta)];

  const w = petalWidth(u, spec.width);
  const t = Math.abs(v);
  // Channel along the midrib, ruffled margins, slight twist.
  const channel = 0.32 * w * Math.pow(t, 1.6);
  const ruffle = 0.022 * spec.length * Math.sin(u * 30 + spec.seed * 5 + v * 2) * Math.pow(t, 4) * smoothstep(0.2, 0.7, u);
  const twist = 0.25 * u * u;
  const across = v * w * Math.cos(twist);
  const normalOff = channel + ruffle + v * w * Math.sin(twist);
  return [
    R[0] * cx + S[0] * across + N[0] * normalOff,
    cy + N[1] * normalOff,
    R[2] * cx + S[2] * across + N[2] * normalOff,
  ];
}

function petalColor(u: number, v: number, seed: number): V3 {
  const t = Math.abs(v);
  let c = mix3(CRIMSON, PINK, smoothstep(0.12, 0.62, t));
  c = mix3(c, BLUSH, smoothstep(0.58, 0.84, t));
  c = mix3(c, WHITE, smoothstep(0.8, 0.98, t));
  // Paler, pinker tips.
  c = mix3(c, mix3(PINK, WHITE, 0.4), smoothstep(0.82, 1.0, u) * 0.5);
  // Green-gold nectary at the throat.
  c = mix3(c, THROAT, (1 - smoothstep(0.02, 0.2, u)) * (1 - smoothstep(0.3, 0.7, t)));
  // Deep crimson midrib.
  c = mix3(c, CRIMSON, (1 - smoothstep(0.0, 0.07, t)) * smoothstep(0.15, 0.3, u) * 0.6);
  // Freckles.
  const cell = worley2(u * 30 + seed * 13, v * 7 + seed * 3, 5);
  const spotZone = smoothstep(0.1, 0.2, u) * (1 - smoothstep(0.62, 0.8, u)) * (1 - smoothstep(0.45, 0.68, t));
  if (cell.id < 0.55 && cell.d < 0.18 + cell.id * 0.12) c = mix3(c, SPOT, spotZone * 0.95);
  const n = 0.92 + 0.08 * fbm3(u * 6, v * 3, seed, 3);
  return [c[0] * n, c[1] * n, c[2] * n];
}

function addFlower(
  b: CloudBuilder,
  rng: Rng,
  origin: V3,
  dir: V3,
  roll: number,
  scale: number,
  budget: number,
  seed: number,
): void {
  const M = alignY(dir);
  const axis = norm(dir);
  const place = (p: V3): V3 => {
    const r = rotateAxis(mulM3(M, [p[0] * scale, p[1] * scale, p[2] * scale]), axis, roll);
    return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
  };
  const placeN = (n: V3): V3 => rotateAxis(mulM3(M, n), axis, roll);

  const petals: PetalSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const inner = i % 2 === 0;
    petals.push({
      azimuth: (i / 6) * Math.PI * 2 + rng.range(-0.08, 0.08),
      length: (inner ? 1.0 : 0.95) * rng.range(0.96, 1.04),
      width: inner ? 0.27 : 0.21,
      lift: (inner ? 1.02 : 0.92) + rng.range(-0.06, 0.06),
      recurve: (inner ? 1.85 : 2.05) + rng.range(-0.15, 0.15),
      seed: seed * 7 + i,
    });
  }

  const petalBudget = Math.floor(budget * 0.86);
  for (const spec of petals) {
    const spine = petalSpine(spec);
    const count = Math.floor((petalBudget / 6) * (spec.width / 0.24));
    let placed = 0;
    while (placed < count) {
      const u = rng.next();
      if (rng.next() * spec.width > petalWidth(u, spec.width)) continue;
      const v = rng.signed();
      const p = petalPoint(spec, spine, u, v);
      const du = 0.004;
      const dv = 0.01;
      const pu = petalPoint(spec, spine, clamp(u + du), v);
      const pv = petalPoint(spec, spine, u, clamp(v + dv, -1, 1));
      const n = norm(cross(sub(pu, p), sub(pv, p)));
      const c = petalColor(u, v, spec.seed);
      const wp = place(p);
      const wn = placeN(n);
      b.push(wp[0], wp[1], wp[2], c[0], c[1], c[2], wn[0], wn[1], wn[2], 1, 0);
      placed++;
    }
  }

  // Stamens: six pale filaments ending in rust-orange anthers.
  const stamenBudget = Math.floor(budget * 0.1);
  for (let i = 0; i < 6; i++) {
    const az = (i / 6) * Math.PI * 2 + 0.5 + rng.range(-0.2, 0.2);
    const reach = rng.range(0.42, 0.52);
    const rise = rng.range(0.5, 0.62);
    const curve = (t: number): V3 => {
      const r = reach * t;
      const y = rise * Math.sin(t * 1.35) / Math.sin(1.35);
      return [Math.cos(az) * r, y, Math.sin(az) * r];
    };
    tube(b, rng, {
      center: (t) => place(curve(t)),
      radius: () => 0.009 * scale,
      count: Math.floor(stamenBudget * 0.07),
      color: (_p, _n, t) => mix3([0.92, 0.95, 0.8], [0.95, 0.75, 0.8], t),
      size: 0.75,
    });
    const tip = curve(1);
    const tangent = norm(sub(curve(1), curve(0.95)));
    const across = norm(cross(tangent, [0, 1, 0]));
    const antherRot = alignY(across);
    ellipsoid(b, rng, {
      center: place(tip),
      radii: [0.022 * scale, 0.07 * scale, 0.022 * scale],
      rot: mulM3Rot(M, antherRot),
      count: Math.floor(stamenBudget * 0.1),
      color: (_p, _n, l) => {
        const g = 0.8 + 0.2 * Math.abs(l[1]);
        return [0.62 * g, 0.2 * g, 0.06 * g];
      },
      size: 1.05,
    });
  }

  // Pistil with a three-lobed stigma.
  const pAz = rng.range(0, Math.PI * 2);
  const pistil = (t: number): V3 => [Math.cos(pAz) * 0.32 * t * t, 0.72 * t, Math.sin(pAz) * 0.32 * t * t];
  tube(b, rng, {
    center: (t) => place(pistil(t)),
    radius: (t) => (0.013 - 0.004 * t) * scale,
    count: Math.floor(budget * 0.025),
    color: () => [0.58, 0.78, 0.38],
    size: 0.8,
  });
  ellipsoid(b, rng, {
    center: place(pistil(1)),
    radii: [0.04 * scale, 0.03 * scale, 0.04 * scale],
    count: Math.floor(budget * 0.012),
    color: (_p, n) => mix3([0.55, 0.12, 0.28], [0.75, 0.3, 0.42], Math.abs(n[1])),
  });
}

/** Multiply two row-major 3x3 matrices. */
function mulM3Rot(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

function addBud(b: CloudBuilder, rng: Rng, base: V3, dir: V3, length: number, budget: number): void {
  const M = alignY(dir);
  // Teardrop: fat lower third, pointed tip, six faint seams.
  const radius = (t: number, th: number) =>
    length * 0.17 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.9) * (1 + 0.06 * Math.cos(th * 6));
  tube(b, rng, {
    center: (t) => {
      const p = mulM3(M, [0, t * length, 0]);
      return [base[0] + p[0], base[1] + p[1], base[2] + p[2]];
    },
    radius,
    count: budget,
    color: (_p, _n, t, th) => {
      let c = mix3([0.42, 0.66, 0.26], [0.92, 0.42, 0.6], smoothstep(0.25, 0.85, t));
      c = mix3(c, [0.7, 0.85, 0.5], (1 - Math.abs(Math.cos(th * 3))) * 0.25);
      return c;
    },
  });
}

function addLeaf(b: CloudBuilder, rng: Rng, base: V3, dir: V3, length: number, width: number, budget: number): void {
  const d = norm(dir);
  const side = norm(cross(d, [0, 1, 0.001]));
  const nrm = norm(cross(side, d));
  const droop = rng.range(0.15, 0.35);
  const at = (u: number, v: number): V3 => {
    const w = width * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 1.1);
    const along = u * length;
    const sag = -droop * u * u * length;
    const fold = 0.25 * Math.abs(v) * w;
    return [
      base[0] + d[0] * along + side[0] * v * w + nrm[0] * (sag + fold),
      base[1] + d[1] * along + side[1] * v * w + nrm[1] * (sag + fold),
      base[2] + d[2] * along + side[2] * v * w + nrm[2] * (sag + fold),
    ];
  };
  for (let i = 0; i < budget; i++) {
    const u = rng.next();
    if (rng.next() > Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 1.1)) {
      i--;
      continue;
    }
    const v = rng.signed();
    const p = at(u, v);
    const n = norm(cross(sub(at(Math.min(u + 0.01, 1), v), p), sub(at(u, Math.min(v + 0.02, 1)), p)));
    const vein = 1 - smoothstep(0.0, 0.08, Math.abs(v));
    let c = mix3(LEAF_DARK, LEAF_LIGHT, 0.35 + 0.35 * fbm3(u * 8, v * 2, base[1] * 9, 3));
    c = mix3(c, [0.55, 0.75, 0.35], vein * 0.6);
    b.push(p[0], p[1], p[2], c[0], c[1], c[2], n[0], n[1], n[2], 1, 0);
  }
}

export function buildLily(count: number): PointCloud {
  const rng = new Rng(20261118);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);

  // Three open blooms, two buds, on a short arching stem.
  const crown: V3 = [0, -0.05, 0];
  const flowers: { at: V3; dir: V3; roll: number; scale: number }[] = [
    { at: [0.08, 0.3, 0.2], dir: [0.25, 1, 0.75], roll: 0.2, scale: 0.7 },
    { at: [-0.4, 0.12, -0.04], dir: [-0.85, 0.8, 0.4], roll: 1.1, scale: 0.6 },
    { at: [0.42, 0.02, -0.12], dir: [0.95, 0.6, 0.2], roll: 2.3, scale: 0.56 },
  ];

  const stemPts: V3[] = [[0.07, -1.0, 0.04], [0.03, -0.68, 0.02], [0.0, -0.36, 0.0], crown];
  tube(b, rng, {
    center: (t) => catmull(stemPts, t),
    radius: (t) => 0.026 - 0.008 * t,
    count: Math.floor(N * 0.035),
    color: (p) => mix3(STEM, [0.32, 0.58, 0.22], 0.5 + 0.5 * fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 2)),
  });

  const flowerShare = [0.25, 0.21, 0.19];
  flowers.forEach((f, i) => {
    const d = norm(f.dir);
    const neckBase: V3 = [f.at[0] - d[0] * 0.06, f.at[1] - d[1] * 0.06, f.at[2] - d[2] * 0.06];
    const mid: V3 = [(crown[0] + neckBase[0]) * 0.45, crown[1] + (neckBase[1] - crown[1]) * 0.7 + 0.04, (crown[2] + neckBase[2]) * 0.45];
    tube(b, rng, {
      center: (t) => catmull([crown, mid, neckBase], t),
      radius: (t) => 0.012 + 0.01 * t * t,
      count: Math.floor(N * 0.012),
      color: () => STEM,
    });
    addFlower(b, rng, f.at, f.dir, f.roll, f.scale, Math.floor(N * flowerShare[i]), i + 1);
  });

  const buds: { at: V3; dir: V3; len: number }[] = [
    { at: [0.22, 0.12, -0.3], dir: [0.35, 1, -0.35], len: 0.5 },
    { at: [-0.18, 0.22, -0.28], dir: [-0.3, 1, -0.2], len: 0.42 },
  ];
  for (const bud of buds) {
    tube(b, rng, {
      center: (t) => catmull([crown, [(crown[0] + bud.at[0]) / 2, (crown[1] + bud.at[1]) / 2, (crown[2] + bud.at[2]) / 2], bud.at], t),
      radius: () => 0.011,
      count: Math.floor(N * 0.006),
      color: () => STEM,
    });
    addBud(b, rng, bud.at, bud.dir, bud.len, Math.floor(N * 0.035));
  }

  // Lanceolate leaves spiralling down the stem.
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.13;
    const at = catmull(stemPts, t);
    const az = i * 2.4 + 0.3;
    const dir: V3 = [Math.cos(az), 0.9 + 0.2 * Math.sin(i), Math.sin(az)];
    addLeaf(b, rng, at, dir, 0.4 + 0.08 * Math.sin(i * 1.7), 0.06, Math.floor(N * 0.018));
  }

  const cloud = b.finish({ name: 'Lily', count, animType: AnimType.Sway, pose: [0.12, -0.35, 0], seed: 11 });
  // Sway weight grows with height so the base stays planted.
  const minY = cloud.bounds[1];
  const h = cloud.bounds[4] - minY;
  for (let i = 0; i < count; i++) cloud.anim[i] = clamp((cloud.positions[i * 3 + 1] - minY) / h);
  return cloud;
}
