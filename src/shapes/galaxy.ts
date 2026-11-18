import { Rng } from '../core/rng';
import { clamp, mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import type { V3 } from './geometry';
import { AnimType, type PointCloud } from './types';

const CORE: V3 = [1.0, 0.84, 0.6];
const INNER: V3 = [0.98, 0.9, 0.78];
const ARM: V3 = [0.56, 0.72, 1.0];
const BLUE_GIANT: V3 = [0.72, 0.86, 1.0];
const RED_GIANT: V3 = [1.0, 0.66, 0.45];
const HII: V3 = [1.0, 0.4, 0.66];
const DUST: V3 = [0.09, 0.055, 0.04];

/** Logarithmic spiral: angle of arm k at radius r. */
const armAngle = (r: number, k: number) => 2.4 * Math.log(Math.max(r, 0.05) / 0.05) + k * Math.PI;

/** Clumpy brightness along an arm, so it reads as star clouds, not a hose. */
const clumps = (r: number, k: number) => 0.55 + 0.45 * clamp(0.5 + fbm3(r * 9 + k * 5, k, 0.3, 3));

export function buildGalaxy(count: number): PointCloud {
  const rng = new Rng(1977);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.02);
  const push = (x: number, y: number, z: number, c: V3, size: number) =>
    b.push(x, y, z, Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2]), 0, 0, 0, size, 0);

  const armPoint = (r: number, k: number, spread: number) => {
    const a = armAngle(r, k) + spread;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  };

  // Arm stars: tight, clumpy ridges.
  for (let i = 0; i < Math.floor(N * 0.38); i++) {
    const r = 0.1 + Math.pow(rng.next(), 0.85) * 0.92;
    const k = rng.next() < 0.5 ? 0 : 1;
    const spread = rng.gauss() * (0.07 + 0.11 * r);
    const [x, z] = armPoint(r + rng.gauss() * 0.012, k, spread);
    const ridge = Math.exp(-((spread / (0.07 + 0.11 * r)) ** 2));
    const bright = clumps(r, k) * (0.45 + 0.55 * ridge);
    let c = mix3(INNER, ARM, smoothstep(0.12, 0.45, r));
    c = [c[0] * bright, c[1] * bright, c[2] * bright];
    push(x, rng.gauss() * 0.012 * (1 - 0.4 * r), z, c, 0.55 + 0.35 * ridge);
  }

  // Bright young blue giants strung along the arm crests, and a few red giants.
  for (let i = 0; i < Math.floor(N * 0.025); i++) {
    const r = 0.2 + rng.next() * 0.8;
    const k = rng.next() < 0.5 ? 0 : 1;
    const [x, z] = armPoint(r, k, rng.gauss() * 0.05);
    const red = rng.next() < 0.18;
    push(x, rng.gauss() * 0.008, z, red ? RED_GIANT : BLUE_GIANT, 1.25 + rng.next() * 0.6);
  }

  // Dust lanes on the inner (trailing) edge of each arm.
  for (let i = 0; i < Math.floor(N * 0.1); i++) {
    const r = 0.14 + Math.pow(rng.next(), 0.8) * 0.8;
    const k = rng.next() < 0.5 ? 0 : 1;
    const [x, z] = armPoint(r, k, -0.13 - (0.03 + 0.05 * r) * Math.abs(rng.gauss()));
    const dens = clumps(r * 1.3, k + 3);
    if (rng.next() > dens) continue;
    push(x, 0.006 + rng.gauss() * 0.005, z, DUST, 0.95);
  }

  // Pink star-forming knots.
  for (let n = 0; n < 90; n++) {
    const r = 0.25 + rng.next() * 0.7;
    const k = rng.next() < 0.5 ? 0 : 1;
    const [cx, cz] = armPoint(r, k, rng.gauss() * 0.04);
    const size = 0.008 + rng.next() * 0.016;
    for (let i = 0; i < Math.floor((N * 0.035) / 90); i++) {
      push(cx + rng.gauss() * size, rng.gauss() * 0.004, cz + rng.gauss() * size, mix3(HII, [1, 0.82, 0.92], rng.next() * 0.35), 0.9);
    }
  }

  // Faint feathery spurs between the arms.
  for (let i = 0; i < Math.floor(N * 0.05); i++) {
    const r = 0.3 + rng.next() * 0.65;
    const k = rng.next() < 0.5 ? 0 : 1;
    const t = rng.next();
    const [x, z] = armPoint(r + t * 0.12, k, 0.25 + t * 0.6 + rng.gauss() * 0.04);
    const f = 0.35 * (1 - t);
    push(x, rng.gauss() * 0.01, z, [ARM[0] * f + 0.05, ARM[1] * f + 0.05, ARM[2] * f + 0.08], 0.55);
  }

  // Smooth exponential disk underneath everything.
  for (let i = 0; i < Math.floor(N * 0.17); i++) {
    const r = -Math.log(1 - rng.next() * 0.985) * 0.22;
    if (r > 1.05) {
      i--;
      continue;
    }
    const a = rng.next() * Math.PI * 2;
    const c = mix3(INNER, [0.5, 0.56, 0.72], smoothstep(0.05, 0.6, r));
    const k = 0.22 + 0.25 * rng.next();
    push(Math.cos(a) * r, rng.gauss() * 0.016, Math.sin(a) * r, [c[0] * k, c[1] * k, c[2] * k], 0.55);
  }

  // Central bulge: dense, warm, slightly flattened.
  for (let i = 0; i < Math.floor(N * 0.2); i++) {
    const d = rng.onSphere();
    const r = 0.16 * Math.pow(rng.next(), 2.2);
    const c = mix3([1, 0.97, 0.9], CORE, smoothstep(0, 0.12, r));
    push(d[0] * r, d[1] * r * 0.6, d[2] * r, c, 0.95 - r * 2);
  }

  // A sprinkling of halo stars and globular clusters.
  for (let i = 0; i < Math.floor(N * 0.012); i++) {
    const d = rng.onSphere();
    const r = 0.35 + rng.next() * 0.8;
    const k = 0.35 + rng.next() * 0.45;
    push(d[0] * r, d[1] * r * 0.55, d[2] * r, [k, k * 0.97, k * 0.92], 0.6);
  }

  return b.finish({ name: 'Galaxy', count, animType: AnimType.Orbit, pose: [1.02, 0, 0.3], seed: 101, glow: 0.8 });
}
