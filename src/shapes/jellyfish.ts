import { Rng } from '../core/rng';
import { mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import { cross, norm, sub, type V3 } from './geometry';
import { tube } from './primitives';
import { AnimType, type PointCloud } from './types';

const BELL_TOP: V3 = [0.42, 0.62, 1.0];
const BELL_RIM: V3 = [1.0, 0.42, 0.86];
const CANAL: V3 = [0.82, 0.96, 1.0];
const GONAD: V3 = [1.0, 0.48, 0.72];
const ARM_A: V3 = [0.98, 0.5, 0.92];
const ARM_B: V3 = [0.56, 0.42, 1.0];
const TENTACLE: V3 = [0.68, 0.92, 1.0];

const R = 0.62;
const H = 0.5;
const LOBES = 16;

/** Bell surface: v = 0 at the apex, 1 at the rim. */
function bell(phi: number, v: number, inner = false): V3 {
  const s = Math.sin((v * Math.PI) / 2);
  const flare = 1 + 0.05 * Math.sin(phi * LOBES) * Math.pow(v, 4) + 0.06 * Math.pow(v, 6);
  const r = R * Math.pow(s, 0.85) * flare * (inner ? 0.9 : 1);
  const y = H * Math.pow(Math.cos((v * Math.PI) / 2), 1.15) - (inner ? 0.04 : 0) - 0.04 * Math.pow(v, 3);
  return [Math.cos(phi) * r, y, Math.sin(phi) * r];
}

export function buildJellyfish(count: number): PointCloud {
  const rng = new Rng(31337);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);

  // Outer and inner bell surfaces. Sampling weight ~ sin(v) for even area.
  const addBell = (budget: number, inner: boolean) => {
    let placed = 0;
    while (placed < budget) {
      const v = rng.next();
      if (rng.next() > Math.max(0.12, Math.sin((v * Math.PI) / 2))) continue;
      const phi = rng.next() * Math.PI * 2;
      const p = bell(phi, v, inner);
      const n = norm(cross(sub(bell(phi + 0.01, v, inner), p), sub(bell(phi, Math.min(v + 0.01, 1), inner), p)));
      let c = mix3(BELL_TOP, BELL_RIM, smoothstep(0.45, 1.0, v));
      const canal = 1 - smoothstep(0.0, 0.12, Math.abs(Math.sin(phi * 4)));
      c = mix3(c, CANAL, canal * 0.6 * smoothstep(0.1, 0.4, v));
      const shimmer = 0.75 + 0.25 * fbm3(p[0] * 6, p[1] * 6, p[2] * 6, 3);
      const dim = inner ? 0.55 : 1;
      b.push(p[0], p[1], p[2], c[0] * shimmer * dim, c[1] * shimmer * dim, c[2] * shimmer * dim,
        inner ? -n[0] : n[0], inner ? -n[1] : n[1], inner ? -n[2] : n[2], inner ? 0.6 : 0.68, v);
      placed++;
    }
  };
  addBell(Math.floor(N * 0.38), false);
  addBell(Math.floor(N * 0.08), true);

  // Rim lights.
  for (let i = 0; i < Math.floor(N * 0.015); i++) {
    const phi = (Math.floor(rng.next() * 32) / 32) * Math.PI * 2;
    const p = bell(phi, 1);
    const j = 0.012;
    b.push(p[0] + rng.signed() * j, p[1] + rng.signed() * j, p[2] + rng.signed() * j, 1, 0.95, 0.75, 0, 0, 0, 1.4, 1);
  }

  // Four clover-shaped gonads glowing through the bell.
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let i = 0; i < Math.floor(N * 0.012); i++) {
      const t = rng.next() * Math.PI * 1.6 - 0.8;
      const rr = 0.13 + 0.025 * rng.gauss();
      const cx = Math.cos(a0) * 0.2;
      const cz = Math.sin(a0) * 0.2;
      const p: V3 = [cx + Math.cos(a0 + t) * rr * 0.6, H * 0.62 + rng.gauss() * 0.015, cz + Math.sin(a0 + t) * rr * 0.6];
      b.push(p[0], p[1], p[2], GONAD[0], GONAD[1], GONAD[2], 0, 1, 0, 1.1, 0.2);
    }
  }

  // Ruffled oral arms hanging from the center.
  const armBudget = Math.floor(N * 0.22);
  for (let k = 0; k < 4; k++) {
    const phi0 = (k / 4) * Math.PI * 2;
    const len = 1.05 + 0.15 * rng.next();
    const center = (t: number): V3 => [Math.cos(phi0 + t * 2.2) * (0.06 + 0.05 * t), H * 0.2 - t * len, Math.sin(phi0 + t * 2.2) * (0.06 + 0.05 * t)];
    for (let i = 0; i < armBudget / 4; i++) {
      const t = Math.pow(rng.next(), 0.9);
      const s = rng.signed();
      const c = center(t);
      const tangent = norm(sub(center(Math.min(t + 0.01, 1)), c));
      const side = norm(cross(tangent, [Math.cos(phi0), 0, Math.sin(phi0)]));
      const out: V3 = [Math.cos(phi0 + t * 2.2), 0, Math.sin(phi0 + t * 2.2)];
      const w = 0.11 * (1 - 0.55 * t);
      const frill = 0.05 * Math.sin(s * 9 + t * 34 + k) * Math.abs(s);
      const p: V3 = [
        c[0] + side[0] * s * w + out[0] * (Math.abs(s) * w * 0.8 + frill),
        c[1] + side[1] * s * w,
        c[2] + side[2] * s * w + out[2] * (Math.abs(s) * w * 0.8 + frill),
      ];
      const col = mix3(ARM_A, ARM_B, smoothstep(0.1, 0.9, t));
      const fade = 1 - 0.45 * t;
      b.push(p[0], p[1], p[2], col[0] * fade, col[1] * fade, col[2] * fade, out[0], 0, out[2], 0.95, 1 + t);
    }
  }

  // Long trailing tentacles from the rim.
  const tentacles = 28;
  const tBudget = Math.floor(N * 0.24);
  for (let k = 0; k < tentacles; k++) {
    const phi = (k / tentacles) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const root = bell(phi, 0.985);
    const len = rng.range(1.3, 1.85);
    const wob = rng.range(0, 6);
    tube(b, rng, {
      center: (t) => [
        root[0] * (1 - 0.25 * t) + 0.05 * Math.sin(t * 7 + wob),
        root[1] - t * len,
        root[2] * (1 - 0.25 * t) + 0.05 * Math.cos(t * 6 + wob),
      ],
      radius: (t) => 0.007 * (1 - 0.6 * t) + 0.002,
      count: Math.floor(tBudget / tentacles),
      color: (_p, _n, t) => {
        const f = 1 - 0.65 * t;
        const c = mix3(TENTACLE, BELL_RIM, 0.3 + 0.3 * Math.sin(t * 20 + k));
        return [c[0] * f, c[1] * f, c[2] * f];
      },
      size: 0.8,
      anim: (t) => 1 + t,
    });
  }

  return b.finish({ name: 'Jellyfish', count, animType: AnimType.Pulse, pose: [0.3, 0, 0.08], seed: 59, glow: 0.9 });
}
