import { Rng } from '../core/rng';
import { clamp, lerp, mix3, smoothstep } from '../core/math';
import { fbm3, worley2 } from '../core/noise';
import { CloudBuilder } from './builder';
import { add, catmull, cross, len, lerpV, norm, sub, type V3 } from './geometry';
import { ellipsoid, triArea, triangle, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

const SCALE_RED: V3 = [0.72, 0.04, 0.05];
const SCALE_EDGE: V3 = [0.3, 0.01, 0.02];
const SCALE_SHINE: V3 = [0.95, 0.22, 0.12];
const BELLY: V3 = [0.78, 0.26, 0.1];
const MEMBRANE_DARK: V3 = [0.42, 0.02, 0.04];
const MEMBRANE_LIGHT: V3 = [0.86, 0.13, 0.09];
const BONE: V3 = [0.3, 0.02, 0.03];
const HORN: V3 = [0.86, 0.8, 0.66];

// Spine from tail tip to snout. The dragon rears up, facing +x.
const SPINE: V3[] = [
  [0.95, -1.05, 0.35], [0.6, -1.12, 0.45], [0.2, -1.08, 0.3], [-0.05, -0.92, 0.05],
  [-0.13, -0.62, 0.0], [-0.1, -0.3, 0.0], [-0.02, 0.0, 0.02], [0.08, 0.3, 0.04],
  [0.13, 0.55, 0.06], [0.27, 0.72, 0.08], [0.53, 0.67, 0.1],
];
const RADII = [0.008, 0.03, 0.055, 0.09, 0.15, 0.17, 0.15, 0.08, 0.07, 0.085, 0.035];

const spineAt = (t: number) => catmull(SPINE, t);
function radiusAt(t: number): number {
  const f = clamp(t) * (RADII.length - 1);
  const i = Math.min(Math.floor(f), RADII.length - 2);
  const u = f - i;
  return lerp(RADII[i], RADII[i + 1], u * u * (3 - 2 * u));
}
/** Dorsal direction: up along the tail and head, backward along the torso. */
function dorsalAt(t: number): V3 {
  const torso = smoothstep(0.22, 0.38, t) * (1 - smoothstep(0.8, 0.9, t));
  return norm(lerpV([0, 1, 0.05], [-1, 0.25, 0], torso));
}

function scaleColor(t: number, theta: number, seed: number): V3 {
  const ventral = 1 - smoothstep(-0.75, -0.45, Math.cos(theta));
  const cell = worley2(t * 110 + seed, theta * 5.5, 13);
  let c = mix3(SCALE_RED, SCALE_SHINE, Math.pow(1 - cell.d, 3) * 0.6);
  c = mix3(c, SCALE_EDGE, smoothstep(0.35, 0.55, cell.d));
  c = mix3(c, [c[0] * 0.8, c[1], c[2]], cell.id * 0.4);
  // Ridged belly plates.
  const ridge = 1 - smoothstep(0.0, 0.25, Math.abs(Math.sin(t * 160)));
  const belly = mix3(BELLY, [0.55, 0.2, 0.08], ridge * 0.7);
  return mix3(c, belly, ventral);
}

function cone(b: CloudBuilder, rng: Rng, base: V3, tip: V3, r: number, count: number, from: V3, to: V3, anim = 0): void {
  tube(b, rng, {
    center: (t) => lerpV(base, tip, t),
    radius: (t) => r * (1 - t) + 0.001,
    count,
    color: (_p, _n, t) => mix3(from, to, t),
    size: 0.85,
    anim: () => anim,
  });
}

function limb(b: CloudBuilder, rng: Rng, pts: V3[], r0: number, r1: number, count: number): void {
  tube(b, rng, {
    center: (t) => catmull(pts, t),
    radius: (t, th) => lerp(r0, r1, t) * (1 + 0.15 * Math.sin(t * Math.PI * 2)) * (1 + 0.05 * Math.cos(th * 2)),
    count,
    color: (_p, _n, t, th) => scaleColor(t * 0.4 + 0.3, th, 41),
  });
  // Three claws at the end.
  const end = catmull(pts, 1);
  const dir = norm(sub(end, catmull(pts, 0.92)));
  for (let k = -1; k <= 1; k++) {
    const side = norm(cross(dir, [0, 1, 0.01]));
    const tip = add(end, add(scaleV(dir, 0.07), add(scaleV(side, k * 0.035), [0, -0.03, 0])));
    cone(b, rng, end, tip, 0.014, Math.floor(count * 0.03), [0.2, 0.15, 0.12], [0.9, 0.86, 0.78]);
  }
}

const scaleV = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

function wing(b: CloudBuilder, rng: Rng, side: 1 | -1, budget: number): void {
  const z = (p: V3): V3 => [p[0], p[1], p[2] * side];
  const shoulder = z([-0.1, 0.08, 0.12]);
  const elbow = z([-0.38, 0.45, 0.45]);
  const wrist = z([-0.22, 0.95, 0.82]);
  const fingers = [z([-0.08, 1.28, 1.02]), z([-0.36, 1.0, 1.36]), z([-0.56, 0.48, 1.32]), z([-0.6, 0.0, 0.98])];
  const attach = z([-0.16, -0.45, 0.12]);
  const span = len(sub(fingers[1], shoulder));
  const animOf = (p: V3) => side * (1 + clamp(len(sub(p, shoulder)) / span));

  // Membrane panels with scalloped trailing edges.
  const panels: [V3, V3, V3, boolean][] = [
    [wrist, fingers[0], fingers[1], true],
    [wrist, fingers[1], fingers[2], true],
    [wrist, fingers[2], fingers[3], true],
    [wrist, fingers[3], attach, true],
    [shoulder, wrist, attach, false],
    [shoulder, elbow, wrist, false],
  ];
  const membraneBudget = Math.floor(budget * 0.86);
  const areas = panels.map(([a, bb, c]) => triArea(a, bb, c));
  const total = areas.reduce((x, y) => x + y, 0);
  panels.forEach(([a, bb, c, scallop], i) => {
    const want = Math.floor((membraneBudget * areas[i]) / total);
    let placed = 0;
    while (placed < want) {
      const before = b.length;
      triangle(
        b, rng, a, bb, c, 1,
        (p, uvw) => {
          const s = uvw[2] / Math.max(uvw[1] + uvw[2], 1e-4);
          const nearBone = Math.min(uvw[1] / (uvw[1] + uvw[2] + 1e-4), uvw[2] / (uvw[1] + uvw[2] + 1e-4));
          let col = mix3(MEMBRANE_DARK, MEMBRANE_LIGHT, smoothstep(0.0, 0.45, nearBone) * (0.6 + 0.4 * (1 - uvw[0])));
          const vein = Math.abs(Math.sin(s * 22 + fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 2) * 2));
          col = mix3(col, MEMBRANE_DARK, (1 - smoothstep(0.0, 0.12, vein)) * 0.5 * (1 - uvw[0]));
          return col;
        },
        {
          anim: (p) => animOf(p),
          offset: (_p, uvw) => 0.05 * Math.sin(Math.PI * clamp(uvw[2] / (uvw[1] + uvw[2] + 1e-4))) * (1 - uvw[0]),
        },
      );
      if (scallop) {
        // Reject points beyond the curved trailing edge.
        const i3 = before * 3;
        const p: V3 = [b.pos[i3], b.pos[i3 + 1], b.pos[i3 + 2]];
        const w = barycentricW(p, a, bb, c);
        const s = clamp(w.v / Math.max(w.u + w.v, 1e-4));
        if (w.w < 0.22 * Math.sin(Math.PI * s)) {
          b.length = before;
          continue;
        }
      }
      placed++;
    }
  });

  // Bones: arm and four fingers.
  const boneBudget = budget - membraneBudget;
  const bone = (pts: V3[], r0: number, r1: number, share: number) =>
    tube(b, rng, {
      center: (t) => catmull(pts, t),
      radius: (t) => lerp(r0, r1, t),
      count: Math.floor(boneBudget * share),
      color: (_p, _n, t) => mix3(BONE, [0.5, 0.05, 0.05], t * 0.5),
      anim: (_t, p) => animOf(p),
    });
  bone([shoulder, elbow, wrist], 0.04, 0.026, 0.4);
  fingers.forEach((f) => bone([wrist, lerpV(wrist, f, 0.5), f], 0.02, 0.006, 0.15));
  // Thumb claw at the wrist.
  cone(b, rng, wrist, add(wrist, z([0.08, 0.06, 0.02])), 0.016, Math.floor(boneBudget * 0.04), BONE, HORN, animOf(wrist));
}

function barycentricW(p: V3, a: V3, b: V3, c: V3): { u: number; v: number; w: number } {
  const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(p, a);
  const d00 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
  const d01 = v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2];
  const d11 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
  const d20 = v2[0] * v0[0] + v2[1] * v0[1] + v2[2] * v0[2];
  const d21 = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2];
  const den = d00 * d11 - d01 * d01 || 1;
  const u = (d11 * d20 - d01 * d21) / den;
  const v = (d00 * d21 - d01 * d20) / den;
  return { u, v, w: 1 - u - v };
}

export function buildDragon(count: number): PointCloud {
  const rng = new Rng(9001);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);

  // Body.
  tube(b, rng, {
    center: spineAt,
    radius: (t, th) => radiusAt(t) * (1 + 0.12 * Math.cos(2 * th)) * (1 + 0.03 * fbm3(t * 30, th, 0, 2)),
    up: dorsalAt,
    count: Math.floor(N * 0.27),
    color: (_p, _n, t, th) => scaleColor(t, th, 0),
    anim: (t) => (t < 0.38 ? 0.999 * (1 - t / 0.38) : 0),
  });

  // Dorsal spines from tail to the back of the head.
  for (let t = 0.04; t < 0.86; t += 0.022) {
    const base = spineAt(t);
    const up = dorsalAt(t);
    const tangent = norm(sub(spineAt(t + 0.01), spineAt(t - 0.01)));
    const r = radiusAt(t);
    const h = 0.03 + r * 0.55;
    const root = add(base, scaleV(up, r * 0.95));
    const tip = add(root, add(scaleV(up, h), scaleV(tangent, -h * 0.6)));
    cone(b, rng, root, tip, h * 0.35, Math.floor(N * 0.0011 + h * N * 0.004), [0.45, 0.02, 0.03], [0.12, 0.02, 0.02], t < 0.38 ? 1 - t / 0.38 : 0);
  }

  // Head: horns, jaw, teeth and glowing eyes.
  const headBase = spineAt(0.9);
  for (const s of [1, -1]) {
    const hp: V3[] = [
      add(headBase, [-0.03, 0.05, 0.05 * s]),
      add(headBase, [-0.14, 0.17, 0.08 * s]),
      add(headBase, [-0.3, 0.24, 0.12 * s]),
      add(headBase, [-0.4, 0.2, 0.14 * s]),
    ];
    tube(b, rng, {
      center: (t) => catmull(hp, t),
      radius: (t) => 0.028 * (1 - t) + 0.003,
      count: Math.floor(N * 0.006),
      color: (_p, _n, t) => mix3([0.3, 0.22, 0.18], HORN, smoothstep(0.1, 0.8, t)),
    });
    ellipsoid(b, rng, {
      center: add(headBase, [0.08, 0.035, 0.068 * s]),
      radii: [0.022, 0.014, 0.012],
      count: Math.floor(N * 0.0025),
      color: () => [1.0, 0.82, 0.18],
      size: 1.3,
    });
  }
  const jaw: V3[] = [add(headBase, [0.0, -0.05, 0]), add(headBase, [0.14, -0.1, 0]), add(headBase, [0.25, -0.13, 0.01])];
  tube(b, rng, {
    center: (t) => catmull(jaw, t),
    radius: (t) => 0.045 * (1 - 0.55 * t),
    up: [0, 1, 0],
    count: Math.floor(N * 0.012),
    color: (_p, _n, t, th) => scaleColor(0.6 + t * 0.1, th, 3),
  });
  for (let i = 0; i < 14; i++) {
    const t = 0.25 + (i % 7) * 0.1;
    const s = i < 7 ? 1 : -1;
    const top = add(catmull(SPINE.slice(8), 0.35 + t * 0.6), [0, -0.035, 0.03 * s]);
    cone(b, rng, top, add(top, [0, -0.035, 0]), 0.008, Math.floor(N * 0.0004), [1, 0.97, 0.9], [1, 1, 1]);
  }

  // Legs: powerful hind legs, smaller raised forelegs.
  for (const s of [1, -1]) {
    limb(b, rng, [[-0.12, -0.62, 0.11 * s], [0.12, -0.82, 0.2 * s], [-0.04, -1.04, 0.22 * s], [0.14, -1.12, 0.24 * s]], 0.1, 0.035, Math.floor(N * 0.045));
    limb(b, rng, [[-0.02, -0.06, 0.11 * s], [0.14, -0.2, 0.17 * s], [0.25, -0.04, 0.17 * s], [0.31, 0.06, 0.15 * s]], 0.055, 0.022, Math.floor(N * 0.022));
  }

  // Wings.
  const used = b.length;
  const wingBudget = Math.floor((N - used) / 2);
  wing(b, rng, 1, wingBudget);
  wing(b, rng, -1, wingBudget);

  return b.finish({ name: 'Dragon', count, animType: AnimType.Dragon, pose: [0.12, -1.15, 0], seed: 47, glow: 0.15 });
}
