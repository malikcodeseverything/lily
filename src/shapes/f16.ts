import { Rng } from '../core/rng';
import { clamp, lerp, mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import { norm, type V3 } from './geometry';
import { panel, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

// USAF two-tone air superiority gray, lighter underneath.
const TOP: V3 = [0.4, 0.43, 0.46];
const BELLY: V3 = [0.6, 0.63, 0.66];
const RADOME: V3 = [0.33, 0.35, 0.36];
const METAL: V3 = [0.2, 0.2, 0.22];
const MISSILE: V3 = [0.86, 0.87, 0.86];

/*
 * Local frame: nose toward +x, up +y, right wing toward +z.
 * Fuselage half-height (ry) and half-width (rz) by station x.
 */
const STATIONS: [number, number, number][] = [
  // x,     ry,    rz
  [1.0, 0.004, 0.004],
  [0.92, 0.03, 0.03],
  [0.78, 0.052, 0.054],
  [0.62, 0.07, 0.07],
  [0.42, 0.082, 0.084],
  [0.2, 0.088, 0.1],
  [-0.05, 0.088, 0.104],
  [-0.4, 0.084, 0.098],
  [-0.68, 0.074, 0.084],
  [-0.86, 0.064, 0.066],
  [-0.94, 0.058, 0.058],
];

function station(x: number): { ry: number; rz: number } {
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const [x0, ry0, rz0] = STATIONS[i];
    const [x1, ry1, rz1] = STATIONS[i + 1];
    if (x <= x0 && x >= x1) {
      let t = (x0 - x) / (x0 - x1);
      if (i === 0) t = Math.sqrt(t); // rounded nose cone
      return { ry: lerp(ry0, ry1, t), rz: lerp(rz0, rz1, t) };
    }
  }
  return { ry: STATIONS[STATIONS.length - 1][1], rz: STATIONS[STATIONS.length - 1][2] };
}

const ellipseR = (ry: number, rz: number, th: number) => 1 / Math.sqrt((Math.cos(th) / ry) ** 2 + (Math.sin(th) / rz) ** 2);

/** Panel lines: a faint grid of darker seams. */
function seams(a: number, b: number, k = 1): number {
  const l1 = Math.abs(((a * 9) % 1 + 1) % 1 - 0.5);
  const l2 = Math.abs(((b * 7 * k) % 1 + 1) % 1 - 0.5);
  return l1 > 0.47 || l2 > 0.475 ? 0.82 : 1;
}

function paint(base: V3, x: number, y: number, z: number, seam: number): V3 {
  const n = 0.95 + 0.05 * fbm3(x * 5, y * 5, z * 5, 3);
  return [base[0] * n * seam, base[1] * n * seam, base[2] * n * seam];
}

/** Two faces of a thin flat panel, each one-sided like real skin. */
function wingPanel(
  b: CloudBuilder,
  rng: Rng,
  poly: [number, number][],
  count: number,
  place: (x: number, s: number, face: 1 | -1) => V3,
  normal: V3,
  colors: [V3, V3],
): void {
  for (const face of [1, -1] as const) {
    panel(b, rng, poly, Math.floor(count * (face === 1 ? 0.55 : 0.45)), (x, s) => {
      const p = place(x, s, face);
      const c = paint(face === 1 ? colors[0] : colors[1], x, s, face, seams(x, s, 1.3));
      return { p, n: [normal[0] * face, normal[1] * face, normal[2] * face], c, size: -1 };
    });
  }
}

function missile(b: CloudBuilder, rng: Rng, x0: number, x1: number, y: number, z: number, r: number, count: number): void {
  const len = x0 - x1;
  tube(b, rng, {
    center: (t) => [x0 - t * len, y, z],
    radius: (t) => r * (t < 0.08 ? Math.sqrt(t / 0.08) : 1),
    up: [0, 1, 0],
    count: Math.floor(count * 0.8),
    color: (_p, _n, t) => (t < 0.05 ? [0.25, 0.22, 0.18] : t > 0.12 && t < 0.15 ? [0.75, 0.62, 0.2] : MISSILE),
    size: 0.85,
  });
  // Cruciform fins front and back.
  for (const at of [0.18, 0.92]) {
    const fx = x0 - at * len;
    const span = at > 0.5 ? r * 2.6 : r * 1.8;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const dy = Math.cos(a), dz = Math.sin(a);
      panel(b, rng, [[0, 0], [len * 0.1, 0], [len * 0.05, 1]], Math.floor(count * 0.05), (u, v) => ({
        p: [fx + u - len * 0.05, y + dy * (r + v * span), z + dz * (r + v * span)],
        n: [0, -dz, dy],
        c: MISSILE,
        size: 0.8,
      }));
    }
  }
}

export function buildF16(count: number): PointCloud {
  const rng = new Rng(1616);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.04);

  // Fuselage: elliptical sections, darker on top.
  tube(b, rng, {
    center: (t) => [1.0 - t * 1.94, -0.004 * (1 - t), 0],
    radius: (t, th) => {
      const s = station(1.0 - t * 1.94);
      return ellipseR(s.ry, s.rz, th);
    },
    up: [0, 1, 0],
    count: Math.floor(N * 0.25),
    color: (p, n, t) => {
      const upness = smoothstep(-0.35, 0.35, n[1]);
      let c = mix3(BELLY, TOP, upness);
      if (t < 0.075) c = RADOME;
      return paint(c, p[0], p[1], p[2], seams(p[0], Math.atan2(n[2], n[1]) * 0.6));
    },
  });
  // Pitot boom.
  tube(b, rng, { center: (t) => [1.0 + t * 0.09, 0, 0], radius: () => 0.004, count: Math.floor(N * 0.002), color: () => METAL, size: 0.7 });

  // Chin intake: rounded-rectangle duct under the forward fuselage.
  const sup = (th: number, a: number, c: number) => Math.pow(Math.abs(Math.cos(th) / a) ** 4 + Math.abs(Math.sin(th) / c) ** 4, -0.25);
  tube(b, rng, {
    center: (t) => [0.44 - t * 0.5, -0.108 + 0.035 * t, 0],
    radius: (t, th) => sup(th, 0.046 - 0.01 * t, 0.07 - 0.012 * t),
    up: [0, 1, 0],
    count: Math.floor(N * 0.05),
    color: (p, n) => paint(mix3(BELLY, TOP, smoothstep(0.3, 0.9, n[1]) * 0.4), p[0], p[1], p[2], 1),
  });
  // Intake mouth: dark interior with a lighter lip.
  for (let i = 0; i < Math.floor(N * 0.012); i++) {
    const th = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next());
    const r = sup(th, 0.046, 0.07) * rr;
    const lip = rr > 0.9;
    const c: V3 = lip ? [0.5, 0.52, 0.55] : [0.04, 0.04, 0.05];
    b.push(0.44 - (lip ? 0 : 0.01), -0.108 + Math.cos(th) * r, Math.sin(th) * r, c[0], c[1], c[2], 1, 0, 0, 1, 0);
  }

  // Wings with leading-edge root extensions, both sides.
  const WING: [number, number][] = [
    [0.62, 0.07], [0.32, 0.11], [0.12, 0.16], [-0.44, 0.64], [-0.6, 0.64], [-0.62, 0.1], [-0.66, 0.085],
  ];
  const STAB: [number, number][] = [[-0.66, 0.07], [-0.8, 0.34], [-0.93, 0.36], [-0.97, 0.08]];
  const wingBudget = Math.floor(N * 0.3);
  const stabBudget = Math.floor(N * 0.06);
  for (const side of [1, -1] as const) {
    wingPanel(
      b, rng, WING, wingBudget / 2,
      (x, s, face) => {
        const chordPos = clamp((x + 0.62) / 0.9);
        const h = 0.012 * (1 - clamp((s - 0.1) / 0.6) * 0.6) * Math.sin(Math.PI * clamp(chordPos * 0.9 + 0.05));
        return [x, -0.012 + face * h, side * s];
      },
      [0, 1, 0],
      [TOP, BELLY],
    );
    wingPanel(
      b, rng, STAB, stabBudget / 2,
      (x, s, face) => [x, -0.03 - 0.06 * (s - 0.07) + face * 0.005, side * s],
      [0, 1, 0],
      [TOP, BELLY],
    );
    // Ventral fins, canted outward.
    panel(b, rng, [[-0.5, 0], [-0.64, 0.12], [-0.74, 0.12], [-0.7, 0]], Math.floor(N * 0.006), (x, d) => ({
      p: [x, -0.075 - d * 0.9, side * (0.05 + d * 0.45)],
      n: [0, 0.45, side * 0.9],
      c: paint(BELLY, x, d, side, 1),
    }));
    // Missiles: AIM-9 on the wingtip rail, AIM-120 under the wing.
    missile(b, rng, -0.02, -0.6, -0.012, side * 0.66, 0.013, Math.floor(N * 0.035));
    tube(b, rng, { center: (t) => [-0.18 - t * 0.2, -0.03 - t * 0.0, side * 0.42], radius: () => 0.01, count: Math.floor(N * 0.004), color: () => BELLY });
    missile(b, rng, 0.02, -0.46, -0.055, side * 0.42, 0.015, Math.floor(N * 0.03));
  }

  // Single vertical tail with a rudder seam.
  const FIN: [number, number][] = [[-0.42, 0.07], [-0.83, 0.52], [-0.95, 0.52], [-0.97, 0.07]];
  for (const face of [1, -1] as const) {
    panel(b, rng, FIN, Math.floor(N * 0.035), (x, y) => {
      let c = paint(mix3(TOP, BELLY, 0.2), x, y, face, seams(x, y * 1.4));
      if (x < -0.84 && y < 0.46 && Math.abs(x + 0.84) < 0.006) c = [0.25, 0.26, 0.28];
      if (y > 0.49) c = [0.2, 0.2, 0.22];
      return { p: [x, y, face * 0.007 * (1 - (y - 0.07) / 0.5)], n: [0, 0, face], c, size: -1 };
    });
  }

  // Bubble canopy: gold-tinted glass with a bright reflection streak.
  for (let i = 0; i < Math.floor(N * 0.05); i++) {
    const d = rng.onSphere();
    if (d[1] < 0.08) {
      i--;
      continue;
    }
    const p: V3 = [0.55 + d[0] * 0.21, 0.058 + d[1] * 0.078, d[2] * 0.062];
    const n = norm([d[0] / 0.21, d[1] / 0.078, d[2] / 0.062]);
    let c: V3 = mix3([0.08, 0.075, 0.05], [0.36, 0.3, 0.13], smoothstep(0.3, 0.95, n[1]));
    const streak = Math.exp(-(((d[0] - 0.2) * 3) ** 2)) * smoothstep(0.6, 0.95, n[1]);
    c = mix3(c, [0.95, 0.9, 0.7], streak * 0.8);
    if (Math.abs(d[0] - 0.05) < 0.03 && d[1] > 0.2) c = [0.22, 0.23, 0.25]; // canopy bow frame
    b.push(p[0], p[1], p[2], c[0], c[1], c[2], n[0], n[1], n[2], 1, 0);
  }

  // Nozzle with turkey-feather petals.
  tube(b, rng, {
    center: (t) => [-0.9 - t * 0.12, 0, 0],
    radius: (t, th) => (0.06 - 0.012 * t) * (1 + 0.025 * Math.cos(th * 15)),
    up: [0, 1, 0],
    count: Math.floor(N * 0.03),
    color: (_p, _n, t, th) => {
      const petal = 0.85 + 0.15 * Math.cos(th * 15);
      const heat = mix3(METAL, [0.38, 0.3, 0.32], t);
      return [heat[0] * petal, heat[1] * petal, heat[2] * petal];
    },
  });

  // Afterburner plume: blue-white core, orange shell, shock diamonds.
  for (let i = 0; i < Math.floor(N * 0.07); i++) {
    const d = Math.pow(rng.next(), 1.3);
    const len = 0.27;
    const radius = 0.046 * (1 - d * 0.75) * Math.sqrt(rng.next());
    const a = rng.next() * Math.PI * 2;
    const x = -1.02 - d * len;
    const diamond = 0.88 + 0.12 * Math.cos(d * 34);
    const core = 1 - radius / 0.046;
    let c = mix3([1.0, 0.5, 0.12], [0.7, 0.82, 1.0], core * (1 - d) * 0.9);
    c = mix3(c, [0.6, 0.12, 0.05], smoothstep(0.55, 1, d));
    const k = diamond * (1 - 0.45 * d);
    b.push(x, Math.cos(a) * radius, Math.sin(a) * radius, c[0] * k, c[1] * k, c[2] * k, 0, 0, 0, 1.15, 1 + d);
  }

  return b.finish({ name: 'F-16', count, animType: AnimType.Jet, pose: [0.55, -0.72, 0.16], seed: 77, glow: 0.12 });
}
