import { Rng } from '../core/rng';
import { mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import type { V3 } from './geometry';
import { AnimType, type PointCloud } from './types';

const R = 0.42;

/** Relative ring density by radius (in planet radii): C, B, Cassini, A, Encke. */
function ringDensity(r: number): number {
  if (r < 1.24 || r > 2.27) return 0;
  if (r < 1.53) return 0.22; // C ring, faint
  if (r < 1.95) return 1.0; // B ring, brightest
  if (r < 2.03) return 0.04; // Cassini division
  if (Math.abs(r - 2.21) < 0.012) return 0.05; // Encke gap
  return 0.62; // A ring
}

function ringColor(r: number, streak: number): V3 {
  let c: V3 = r < 1.53 ? [0.46, 0.42, 0.37] : r < 1.95 ? [0.9, 0.82, 0.64] : [0.74, 0.69, 0.6];
  const k = 0.82 + 0.3 * streak;
  c = [c[0] * k, c[1] * k, c[2] * k];
  return c;
}

export function buildSaturn(count: number): PointCloud {
  const rng = new Rng(6060);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.03);

  // Banded, slightly oblate planet.
  for (let i = 0; i < Math.floor(N * 0.42); i++) {
    const d = rng.onSphere();
    const lat = Math.asin(d[1]);
    const lon = Math.atan2(d[2], d[0]);
    const warp = 0.25 * fbm3(lat * 4, Math.cos(lon) * 1.5, Math.sin(lon) * 1.5, 3);
    const band = 0.5 + 0.5 * Math.sin(lat * 19 + warp * 6);
    const fine = 0.5 + 0.5 * Math.sin(lat * 61 + warp * 14);
    let c = mix3([0.93, 0.85, 0.66], [0.74, 0.58, 0.37], band * 0.85);
    c = mix3(c, [0.62, 0.47, 0.3], fine * 0.25);
    c = mix3(c, [0.55, 0.6, 0.62], smoothstep(1.05, 1.35, Math.abs(lat)));
    const p: V3 = [d[0] * R, d[1] * R * 0.9, d[2] * R];
    b.push(p[0], p[1], p[2], c[0], c[1], c[2], d[0], d[1] / 0.9, d[2], 1, 0);
  }

  // Rings: rejection-sampled by the density profile, area-weighted.
  let placed = 0;
  const ringBudget = Math.floor(N * 0.52);
  while (placed < ringBudget) {
    const r = Math.sqrt(1.24 * 1.24 + rng.next() * (2.27 * 2.27 - 1.24 * 1.24));
    if (rng.next() > ringDensity(r)) continue;
    const a = rng.next() * Math.PI * 2;
    const streak = 0.5 + 0.5 * fbm3(r * 40, 0, 0, 3);
    const c = ringColor(r, streak);
    const y = rng.gauss() * 0.0035;
    b.push(Math.cos(a) * r * R, y, Math.sin(a) * r * R, c[0], c[1], c[2], 0, 1, 0, 0.8, r * R * 2.2);
    placed++;
  }

  // A few moons on Keplerian orbits.
  const moons: { orbit: number; size: number; color: V3; phase: number; incl: number }[] = [
    { orbit: 2.7, size: 0.024, color: [0.8, 0.8, 0.78], phase: 0.6, incl: 0.02 },
    { orbit: 3.15, size: 0.03, color: [0.7, 0.68, 0.64], phase: 2.4, incl: -0.03 },
    { orbit: 3.65, size: 0.05, color: [0.88, 0.66, 0.36], phase: 4.1, incl: 0.05 },
  ];
  const moonBudget = Math.floor(N * 0.03);
  for (const m of moons) {
    const cx = Math.cos(m.phase) * m.orbit * R;
    const cz = Math.sin(m.phase) * m.orbit * R;
    const cy = m.incl * m.orbit * R;
    for (let i = 0; i < moonBudget / moons.length; i++) {
      const d = rng.onSphere();
      const k = 0.85 + 0.15 * rng.next();
      b.push(cx + d[0] * m.size, cy + d[1] * m.size, cz + d[2] * m.size, m.color[0] * k, m.color[1] * k, m.color[2] * k, d[0], d[1], d[2], 1, m.orbit * R * 2.2);
    }
  }

  return b.finish({ name: 'Saturn', count, animType: AnimType.Orbit, pose: [0.42, 0.2, 0.32], seed: 61, extent: 2.3 });
}
