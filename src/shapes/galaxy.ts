import { Rng } from '../core/rng';
import { mix3, smoothstep } from '../core/math';
import { CloudBuilder } from './builder';
import type { V3 } from './geometry';
import { AnimType, type PointCloud } from './types';

const CORE: V3 = [1.0, 0.86, 0.62];
const ARM: V3 = [0.62, 0.76, 1.0];
const YOUNG: V3 = [0.78, 0.88, 1.0];
const HII: V3 = [1.0, 0.42, 0.68];
const DUST: V3 = [0.1, 0.06, 0.05];

const PITCH = Math.tan((13 * Math.PI) / 180);

/** Angle of a logarithmic spiral arm at radius r. */
const armAngle = (r: number, k: number) => Math.log(Math.max(r, 0.04) / 0.04) / PITCH * 0.32 + k * Math.PI;

export function buildGalaxy(count: number): PointCloud {
  const rng = new Rng(1977);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.02);

  const push = (x: number, y: number, z: number, c: V3, size: number) =>
    b.push(x, y, z, c[0], c[1], c[2], 0, 0, 0, size, 0);

  // Spiral arms: two major arms, stars scattered more widely farther out.
  for (let i = 0; i < Math.floor(N * 0.5); i++) {
    const r = 0.08 + Math.pow(rng.next(), 0.75) * 0.95;
    const k = rng.next() < 0.5 ? 0 : 1;
    const spread = rng.gauss() * (0.12 + 0.22 * r);
    const a = armAngle(r, k) + spread;
    const rr = r + rng.gauss() * 0.025;
    const y = rng.gauss() * 0.018 * (1 - 0.5 * r);
    const bright = 1 - Math.min(1, Math.abs(spread) / 0.45);
    let c = mix3(ARM, YOUNG, bright * 0.6);
    c = mix3(CORE, c, smoothstep(0.08, 0.35, r));
    const k2 = 0.55 + 0.6 * bright * rng.next();
    push(Math.cos(a) * rr, y, Math.sin(a) * rr, [c[0] * k2, c[1] * k2, c[2] * k2], 0.7 + bright * 0.6);
  }

  // Dust lanes hugging the inner edge of each arm.
  for (let i = 0; i < Math.floor(N * 0.07); i++) {
    const r = 0.15 + Math.pow(rng.next(), 0.9) * 0.75;
    const k = rng.next() < 0.5 ? 0 : 1;
    const a = armAngle(r, k) - 0.16 - Math.abs(rng.gauss()) * 0.05;
    const y = rng.gauss() * 0.008 + 0.004;
    push(Math.cos(a) * r, y, Math.sin(a) * r, DUST, 0.9);
  }

  // Pink star-forming knots strung along the arms.
  for (let n = 0; n < 70; n++) {
    const r = 0.25 + rng.next() * 0.7;
    const k = rng.next() < 0.5 ? 0 : 1;
    const a = armAngle(r, k) + rng.gauss() * 0.06;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const size = 0.012 + rng.next() * 0.02;
    for (let i = 0; i < Math.floor((N * 0.05) / 70); i++) {
      push(cx + rng.gauss() * size, rng.gauss() * 0.006, cz + rng.gauss() * size, mix3(HII, [1, 0.8, 0.9], rng.next() * 0.3), 1.1);
    }
  }

  // Smooth disk between the arms.
  for (let i = 0; i < Math.floor(N * 0.18); i++) {
    const r = -Math.log(1 - rng.next() * 0.98) * 0.24;
    if (r > 1.05) {
      i--;
      continue;
    }
    const a = rng.next() * Math.PI * 2;
    const c = mix3(CORE, [0.55, 0.6, 0.75], smoothstep(0.05, 0.5, r));
    const k = 0.35 + 0.35 * rng.next();
    push(Math.cos(a) * r, rng.gauss() * 0.02, Math.sin(a) * r, [c[0] * k, c[1] * k, c[2] * k], 0.75);
  }

  // Bright, slightly flattened central bulge.
  for (let i = 0; i < Math.floor(N * 0.17); i++) {
    const d = rng.inSphere();
    const r = Math.pow(Math.hypot(d[0], d[1], d[2]), 1.8) * 0.17;
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const c = mix3([1.0, 0.95, 0.85], CORE, r / 0.17);
    push((d[0] / l) * r, (d[1] / l) * r * 0.62, (d[2] / l) * r, c, 1.1 - r * 2);
  }

  // Sparse halo stars for depth.
  for (let i = 0; i < Math.floor(N * 0.02); i++) {
    const d = rng.onSphere();
    const r = 0.3 + rng.next() * 0.9;
    const k = 0.4 + rng.next() * 0.5;
    push(d[0] * r, d[1] * r * 0.5, d[2] * r, [k, k, k * 1.05], 0.7);
  }

  return b.finish({ name: 'Galaxy', count, animType: AnimType.Orbit, pose: [0.92, 0, 0.32], seed: 101, glow: 0.9 });
}
