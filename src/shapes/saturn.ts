import { Rng } from '../core/rng';
import { clamp, mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import { norm, poseToM3, type V3 } from './geometry';
import { AnimType, type PointCloud } from './types';

const R = 0.42;
const POSE: [number, number, number] = [0.42, 0.2, 0.32];

/** Ring opacity by radius in planet radii: C ring, B ring, Cassini division, A ring, Encke gap. */
function ringDensity(r: number): number {
  if (r < 1.24 || r > 2.27) return 0;
  if (r < 1.52) return 0.3 + 0.15 * smoothstep(1.24, 1.52, r);
  if (r < 1.95) return 1;
  if (r < 2.025) return 0.03;
  if (Math.abs(r - 2.215) < 0.01) return 0.04;
  return 0.85;
}

/** Many fine ringlets: a few incommensurate radial frequencies. */
function ringlets(r: number): number {
  return (
    0.5 +
    0.22 * Math.sin(r * 173 + 1.3) +
    0.14 * Math.sin(r * 331 + 0.4) +
    0.1 * Math.sin(r * 71 + 2.1) +
    0.06 * fbm3(r * 90, 0.5, 0.5, 2)
  );
}

function ringColor(r: number): V3 {
  if (r < 1.52) return [0.5, 0.46, 0.41];
  if (r < 1.95) return mix3([0.86, 0.77, 0.62], [0.93, 0.85, 0.7], smoothstep(1.55, 1.85, r));
  return [0.8, 0.76, 0.68];
}

/** Soft latitudinal bands: equatorial zone, belts, blue-gray poles. */
function bandColor(lat: number, lon: number): V3 {
  const warp = 0.06 * fbm3(Math.cos(lon) * 2, Math.sin(lon) * 2, lat * 6, 2);
  const l = lat + warp;
  const belts =
    0.5 +
    0.34 * Math.sin(l * 14 + 0.6) +
    0.14 * Math.sin(l * 31 + 1.7) +
    0.08 * Math.sin(l * 55);
  let c = mix3([0.95, 0.88, 0.7], [0.8, 0.66, 0.46], clamp(belts));
  c = mix3(c, [0.98, 0.93, 0.78], 1 - smoothstep(0.0, 0.18, Math.abs(l)));
  c = mix3(c, [0.74, 0.74, 0.68], smoothstep(1.05, 1.35, Math.abs(lat)));
  return c;
}

export function buildSaturn(count: number): PointCloud {
  const rng = new Rng(6060);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.03);

  // Direction toward the light, in object space, for the planet's shadow
  // across the rings (the shader's light is fixed in view space).
  const M = poseToM3(POSE[0], POSE[1], POSE[2]);
  const Lv = norm([0.35, 0.65, 0.68]);
  const sun: V3 = norm([
    M[0] * Lv[0] + M[3] * Lv[1] + M[6] * Lv[2],
    M[1] * Lv[0] + M[4] * Lv[1] + M[7] * Lv[2],
    M[2] * Lv[0] + M[5] * Lv[1] + M[8] * Lv[2],
  ]);

  // Planet: slightly oblate, smooth bands.
  for (let i = 0; i < Math.floor(N * 0.4); i++) {
    const d = rng.onSphere();
    const lat = Math.asin(d[1]);
    const lon = Math.atan2(d[2], d[0]);
    const c = bandColor(lat, lon);
    b.push(d[0] * R, d[1] * R * 0.9, d[2] * R, c[0], c[1], c[2], d[0], d[1] / 0.9, d[2], 0.95, 0);
  }

  // Rings: thin, finely banded, and darkened where the planet blocks the sun.
  let placed = 0;
  const ringBudget = Math.floor(N * 0.57);
  while (placed < ringBudget) {
    const r = Math.sqrt(1.24 * 1.24 + rng.next() * (2.27 * 2.27 - 1.24 * 1.24));
    // Density only carves the major zones and gaps; fine ringlets are drawn
    // with brightness so the rings stay solid instead of grainy.
    if (rng.next() > ringDensity(r)) continue;
    const a = rng.next() * Math.PI * 2;
    const p: V3 = [Math.cos(a) * r * R, rng.gauss() * 0.0015, Math.sin(a) * r * R];
    let c = ringColor(r);
    const k = (0.72 + 0.36 * clamp(ringlets(r))) * (0.97 + 0.03 * rng.next());
    c = [c[0] * k, c[1] * k, c[2] * k];
    // Shadow: behind the planet (relative to the sun) and within its disk.
    const along = p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2];
    if (along < 0) {
      const perp = Math.hypot(p[0] - sun[0] * along, p[1] - sun[1] * along, p[2] - sun[2] * along);
      const shade = 1 - 0.82 * (1 - smoothstep(R * 0.92, R * 1.02, perp));
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    b.push(p[0], p[1], p[2], c[0], c[1], c[2], 0, 1, 0, r < 1.52 ? 0.85 : 1.05, -1);
    placed++;
  }

  // Moons on Keplerian orbits: Titan (large, orange) and two icy moons.
  const moons: { orbit: number; size: number; color: V3; phase: number; incl: number }[] = [
    { orbit: 2.75, size: 0.018, color: [0.86, 0.86, 0.84], phase: 0.7, incl: 0.02 },
    { orbit: 3.2, size: 0.022, color: [0.76, 0.74, 0.7], phase: 2.5, incl: -0.03 },
    { orbit: 3.7, size: 0.042, color: [0.9, 0.68, 0.38], phase: 4.2, incl: 0.04 },
  ];
  for (const m of moons) {
    const cx = Math.cos(m.phase) * m.orbit * R;
    const cz = Math.sin(m.phase) * m.orbit * R;
    const cy = m.incl * m.orbit * R;
    for (let i = 0; i < Math.floor((N * 0.02) / moons.length); i++) {
      const d = rng.onSphere();
      b.push(cx + d[0] * m.size, cy + d[1] * m.size, cz + d[2] * m.size, m.color[0], m.color[1], m.color[2], d[0], d[1], d[2], 0.8, m.orbit * R * 2.2);
    }
  }

  return b.finish({ name: 'Saturn', count, animType: AnimType.Orbit, pose: POSE, seed: 61, extent: 2.3, halo: 0.15 });
}
