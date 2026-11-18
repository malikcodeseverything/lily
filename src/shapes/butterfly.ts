import { Rng } from '../core/rng';
import { mix3, smoothstep } from '../core/math';
import { fbm3, worley2 } from '../core/noise';
import { CloudBuilder } from './builder';
import { catmull, closedCatmull2D, distToPolygon, pointInPolygon, type V3 } from './geometry';
import { ellipsoid, tube } from './primitives';
import { AnimType, type PointCloud } from './types';

// Blue morpho palette.
const DEEP: V3 = [0.01, 0.13, 0.72];
const ELECTRIC: V3 = [0.06, 0.55, 1.0];
const CYAN: V3 = [0.5, 0.92, 1.0];
const MARGIN: V3 = [0.02, 0.02, 0.04];
const VEIN: V3 = [0.01, 0.07, 0.32];
const UNDER_DARK: V3 = [0.3, 0.19, 0.1];
const UNDER_LIGHT: V3 = [0.62, 0.46, 0.27];

// Right-side wing outlines (x outward, y toward the head), body at x = 0.
const FOREWING: [number, number][] = [
  [0.04, 0.12], [0.24, 0.4], [0.52, 0.64], [0.84, 0.8], [1.02, 0.76], [1.02, 0.52],
  [0.92, 0.26], [0.72, 0.07], [0.42, -0.02], [0.12, 0.0],
];
const HINDWING: [number, number][] = [
  [0.05, -0.02], [0.36, 0.03], [0.66, -0.05], [0.84, -0.28], [0.82, -0.56], [0.64, -0.78],
  [0.43, -0.87], [0.24, -0.76], [0.12, -0.5], [0.05, -0.22],
];

interface Wing {
  poly: [number, number][];
  minX: number; maxX: number; minY: number; maxY: number;
  fore: boolean;
  /** Eyespot centers on the underside. */
  eyes: [number, number, number][];
}

function makeWing(points: [number, number][], fore: boolean, eyes: [number, number, number][]): Wing {
  const poly = closedCatmull2D(points, 20);
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { poly, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), fore, eyes };
}

function topColor(w: Wing, x: number, y: number, edge: number, rng: Rng): V3 {
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  // Iridescent body of the wing: shifts between deep and electric blue.
  const n = fbm3(x * 3.2, y * 3.2, w.fore ? 1 : 7, 4);
  let c = mix3(DEEP, ELECTRIC, smoothstep(-0.35, 0.45, n) * smoothstep(0.08, 0.45, r));
  c = mix3(c, CYAN, Math.pow(smoothstep(0.2, 0.75, n), 2) * 0.55);
  // Radiating veins.
  const vein = Math.abs(Math.sin(theta * 8.5 + r * 1.8 + (w.fore ? 0.3 : 1.4)));
  c = mix3(c, VEIN, (1 - smoothstep(0.04, 0.12, vein)) * smoothstep(0.12, 0.3, r) * 0.75);
  // Dark root.
  c = mix3(c, [0.03, 0.06, 0.16], 1 - smoothstep(0.06, 0.2, r));
  // Black margin, much wider at the forewing apex, with white spots.
  const apex = w.fore ? smoothstep(0.85, 1.35, x * 0.75 + y * 0.75) : 0;
  const marginW = (w.fore ? 0.055 : 0.07) + 0.2 * apex + (w.fore ? 0.08 * smoothstep(0.35, 0.75, y) * smoothstep(0.3, 0.9, x) : 0);
  const inMargin = 1 - smoothstep(marginW * 0.75, marginW, edge);
  let m = MARGIN;
  const band = Math.abs(edge - marginW * 0.5) < marginW * 0.3;
  if (band) {
    const s = worley2(x * 15, y * 15, w.fore ? 3 : 9);
    if (s.id < 0.45 && s.d < 0.22) m = [0.92, 0.94, 0.98];
  }
  c = mix3(c, m, inMargin);
  const k = 0.88 + rng.next() * 0.24;
  return [c[0] * k, c[1] * k, c[2] * k];
}

function underColor(w: Wing, x: number, y: number, edge: number): V3 {
  const n = fbm3(x * 5, y * 5, w.fore ? 3 : 9, 3);
  let c = mix3(UNDER_DARK, UNDER_LIGHT, 0.5 + 0.5 * n);
  // Wavy dark bands parallel to the margin.
  c = mix3(c, UNDER_DARK, (1 - smoothstep(0.0, 0.25, Math.abs(Math.sin(edge * 40)))) * 0.5);
  for (const [ex, ey, er] of w.eyes) {
    const d = Math.hypot(x - ex, y - ey) / er;
    if (d < 1) {
      if (d < 0.22) c = [0.95, 0.93, 0.86];
      else if (d < 0.55) c = [0.08, 0.05, 0.04];
      else if (d < 0.85) c = [0.93, 0.68, 0.18];
      else c = [0.12, 0.07, 0.04];
    }
  }
  return c;
}

function addWing(b: CloudBuilder, rng: Rng, w: Wing, side: 1 | -1, budget: number): void {
  const zBase = w.fore ? 0.012 : 0;
  const topBudget = Math.floor(budget * 0.6);
  let placed = 0;
  while (placed < budget) {
    const x = rng.range(w.minX, w.maxX);
    const y = rng.range(w.minY, w.maxY);
    if (!pointInPolygon(x, y, w.poly)) continue;
    const edge = distToPolygon(x, y, w.poly);
    // Slight camber so the wing is not perfectly flat.
    const camber = 0.04 * Math.sin(Math.PI * Math.min(1, x)) * (1 - Math.abs(y));
    const top = placed < topBudget;
    const z = zBase + camber + (top ? 0.006 : -0.006);
    const c = top ? topColor(w, x, y, edge, rng) : underColor(w, x, y, edge);
    // Negative size = one-sided, so each face only shows from its own side.
    b.push(side * x, y, z, c[0], c[1], c[2], 0, 0, top ? 1 : -1, top ? -1 : -0.95, side);
    placed++;
  }
}

export function buildButterfly(count: number): PointCloud {
  const rng = new Rng(4242);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);

  const fore = makeWing(FOREWING, true, [[0.62, 0.45, 0.075], [0.78, 0.6, 0.055]]);
  const hind = makeWing(HINDWING, false, [[0.42, -0.42, 0.09], [0.58, -0.62, 0.07], [0.62, -0.25, 0.06]]);
  const wingBudget = Math.floor(N * 0.86);
  // Split by approximate area: forewings are a little larger.
  for (const side of [1, -1] as const) {
    addWing(b, rng, fore, side, Math.floor(wingBudget * 0.27));
    addWing(b, rng, hind, side, Math.floor(wingBudget * 0.23));
  }

  const furry = (base: V3) => (): V3 => {
    const k = 0.7 + rng.next() * 0.5;
    return [base[0] * k, base[1] * k, base[2] * k];
  };
  // Thorax, head, eyes.
  ellipsoid(b, rng, { center: [0, 0.1, 0.01], radii: [0.07, 0.16, 0.07], count: Math.floor(N * 0.035), color: furry([0.1, 0.12, 0.2]), fill: 0.25 });
  ellipsoid(b, rng, { center: [0, 0.29, 0.02], radii: [0.055, 0.05, 0.055], count: Math.floor(N * 0.012), color: furry([0.12, 0.1, 0.12]) });
  for (const s of [1, -1]) {
    ellipsoid(b, rng, { center: [s * 0.04, 0.31, 0.04], radii: [0.025, 0.028, 0.025], count: Math.floor(N * 0.004), color: () => [0.35, 0.22, 0.12] });
  }
  // Abdomen with faint segment rings.
  tube(b, rng, {
    center: (t) => [0, -0.05 - t * 0.55, 0.01 + 0.03 * Math.sin(t * 2)],
    radius: (t) => 0.052 * (1 - 0.7 * t * t) + 0.01,
    count: Math.floor(N * 0.035),
    color: (_p, _n, t) => {
      const ring = 0.75 + 0.25 * smoothstep(0.3, 0.7, Math.abs(Math.sin(t * 40)));
      return [0.16 * ring, 0.13 * ring, 0.12 * ring];
    },
  });
  // Antennae with clubbed tips.
  for (const s of [1, -1]) {
    const pts: V3[] = [[s * 0.02, 0.32, 0.03], [s * 0.1, 0.5, 0.06], [s * 0.2, 0.66, 0.06], [s * 0.27, 0.78, 0.04]];
    tube(b, rng, {
      center: (t) => catmull(pts, t),
      radius: () => 0.006,
      count: Math.floor(N * 0.004),
      color: () => [0.1, 0.08, 0.06],
      size: 0.7,
    });
    ellipsoid(b, rng, { center: pts[3], radii: [0.016, 0.03, 0.016], count: Math.floor(N * 0.0015), color: () => [0.15, 0.1, 0.06] });
  }
  // Legs tucked under the thorax.
  for (const s of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const y0 = 0.18 - k * 0.07;
      const pts: V3[] = [[s * 0.03, y0, -0.03], [s * 0.1, y0 - 0.02, -0.08], [s * 0.15, y0 - 0.1 - k * 0.04, -0.12]];
      tube(b, rng, { center: (t) => catmull(pts, t), radius: () => 0.005, count: Math.floor(N * 0.0015), color: () => [0.08, 0.07, 0.07], size: 0.7 });
    }
  }

  return b.finish({ name: 'Butterfly', count, animType: AnimType.Flap, pose: [-0.75, 0.3, 0.2], seed: 23 });
}
