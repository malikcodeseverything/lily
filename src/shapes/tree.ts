import { Rng } from '../core/rng';
import { clamp, mix3, smoothstep } from '../core/math';
import { fbm3 } from '../core/noise';
import { CloudBuilder } from './builder';
import { add, norm, perpendicular, rotateAxis, scale, type V3 } from './geometry';
import { tube } from './primitives';
import { AnimType, type PointCloud } from './types';

const BARK_DARK: V3 = [0.17, 0.11, 0.07];
const BARK_LIGHT: V3 = [0.42, 0.31, 0.21];
const LEAF_DEEP: V3 = [0.07, 0.24, 0.07];
const LEAF_MID: V3 = [0.2, 0.45, 0.13];
const LEAF_SUN: V3 = [0.55, 0.7, 0.24];

interface Branch {
  start: V3;
  dir: V3;
  length: number;
  radius: number;
  depth: number;
  /** Slight bend so limbs are not ruler-straight. */
  bend: V3;
}

function grow(rng: Rng, root: Branch, maxDepth: number): Branch[] {
  const out: Branch[] = [];
  const stack = [root];
  while (stack.length) {
    const b = stack.pop()!;
    out.push(b);
    if (b.depth >= maxDepth) continue;
    const children = b.depth === 0 ? 4 : rng.int(2, 4);
    for (let i = 0; i < children; i++) {
      // Children sprout along the upper part of the parent.
      const at = b.depth === 0 ? rng.range(0.55, 0.95) : rng.range(0.45, 1.0);
      const start = pointOn(b, at);
      const spread = (b.depth === 0 ? 0.75 : 0.55) + rng.range(-0.15, 0.2);
      const azimuth = (i / children) * Math.PI * 2 + rng.range(-0.5, 0.5) + b.depth;
      const axis = rotateAxis(perpendicular(b.dir), b.dir, azimuth);
      let dir = rotateAxis(b.dir, axis, spread);
      // Phototropism: everything leans a little toward the sky.
      dir = norm(add(dir, [0, 0.35, 0]));
      stack.push({
        start,
        dir,
        length: b.length * rng.range(0.62, 0.78),
        radius: b.radius * rng.range(0.52, 0.66) * (1.05 - at * 0.3),
        depth: b.depth + 1,
        bend: scale(norm([rng.signed(), rng.signed() * 0.3, rng.signed()]), b.length * 0.12),
      });
    }
  }
  return out;
}

function pointOn(b: Branch, t: number): V3 {
  const bow = 4 * t * (1 - t);
  return [
    b.start[0] + b.dir[0] * b.length * t + b.bend[0] * bow,
    b.start[1] + b.dir[1] * b.length * t + b.bend[1] * bow,
    b.start[2] + b.dir[2] * b.length * t + b.bend[2] * bow,
  ];
}

export function buildTree(count: number): PointCloud {
  const rng = new Rng(777);
  const b = new CloudBuilder(count + 1024);
  const N = Math.round(count * 1.05);
  const baseY = -1.2;

  const trunk: Branch = { start: [0, baseY, 0], dir: norm([0.05, 1, 0.02]), length: 1.05, radius: 0.085, depth: 0, bend: [0.08, 0, 0.04] };
  const branches = grow(rng, trunk, 5);

  // Wood: split the budget by lateral surface area.
  const woodBudget = Math.floor(N * 0.3);
  const areas = branches.map((br) => br.radius * br.length);
  const totalArea = areas.reduce((a, c) => a + c, 0);
  const barkColor = (p: V3, _n: V3, _t: number, th: number): V3 => {
    // Vertical furrows plus mottling.
    const furrow = Math.abs(Math.sin(th * 7 + fbm3(p[0] * 4, p[1] * 2, p[2] * 4, 2) * 3));
    const m = 0.5 + 0.5 * fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 3);
    let c = mix3(BARK_DARK, BARK_LIGHT, m * 0.8);
    c = mix3(c, BARK_DARK, (1 - smoothstep(0.05, 0.35, furrow)) * 0.7);
    return c;
  };
  branches.forEach((br, i) => {
    tube(b, rng, {
      center: (t) => pointOn(br, t),
      radius: (t) => br.radius * (1 - 0.35 * t) * (br.depth === 0 ? 1 + 0.9 * Math.pow(1 - t, 6) : 1),
      count: Math.max(8, Math.floor((woodBudget * areas[i]) / totalArea)),
      color: barkColor,
      up: [0, 0, 1],
    });
  });

  // Root flare.
  for (let i = 0; i < 5; i++) {
    const az = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dir: V3 = [Math.cos(az), -0.35, Math.sin(az)];
    const root: Branch = { start: [0, baseY + 0.12, 0], dir: norm(dir), length: rng.range(0.22, 0.34), radius: 0.04, depth: 1, bend: [0, -0.03, 0] };
    tube(b, rng, {
      center: (t) => pointOn(root, t),
      radius: (t) => root.radius * (1 - 0.8 * t),
      count: Math.floor(N * 0.006),
      color: barkColor,
    });
  }

  // Foliage clumps on every twig. Points sit in a fluffy shell; inner
  // points are darker, sun-facing points lighter.
  const twigs = branches.filter((br) => br.depth >= 3);
  const leafBudget = N - b.length - Math.floor(N * 0.01);
  const per = Math.floor(leafBudget / twigs.length);
  const sun = norm([0.4, 1, 0.5]);
  const tmp: [number, number, number] = [0, 0, 0];
  twigs.forEach((tw, k) => {
    const clumps = tw.depth === 5 ? 2 : 1;
    for (let c = 0; c < clumps; c++) {
      const center = pointOn(tw, c === 0 ? 1 : 0.55);
      const r = (tw.depth === 5 ? 0.13 : 0.16) * rng.range(0.85, 1.25);
      const hueShift = rng.range(-1, 1);
      for (let i = 0; i < per / clumps; i++) {
        rng.onSphere(tmp);
        const lobes = 1 + 0.25 * fbm3(tmp[0] * 2 + k, tmp[1] * 2, tmp[2] * 2, 2);
        const depth = 1 - 0.45 * Math.pow(rng.next(), 1.8);
        const rr = r * lobes * depth;
        const p: V3 = [center[0] + tmp[0] * rr, center[1] + tmp[1] * rr * 0.8, center[2] + tmp[2] * rr];
        const n: V3 = [tmp[0], tmp[1], tmp[2]];
        const lightness = clamp(0.5 + 0.5 * (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]));
        let col = mix3(LEAF_DEEP, LEAF_MID, depth * 0.9);
        col = mix3(col, LEAF_SUN, Math.pow(lightness, 2) * depth * 0.6);
        col = mix3(col, [0.32, 0.5, 0.1], (hueShift * 0.5 + 0.5) * 0.25);
        const j = 0.85 + rng.next() * 0.3;
        b.push(p[0], p[1], p[2], col[0] * j, col[1] * j, col[2] * j, n[0], n[1], n[2], 1.15, 0);
      }
    }
  });

  // A thin disc of moss and grass at the base grounds the tree.
  for (let i = 0; i < Math.floor(N * 0.01); i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next()) * 0.42;
    const c = mix3([0.12, 0.2, 0.06], [0.3, 0.38, 0.12], rng.next());
    b.push(Math.cos(a) * rr, baseY + rng.next() * 0.02, Math.sin(a) * rr, c[0], c[1], c[2], 0, 1, 0, 0.9, 0);
  }

  const cloud = b.finish({ name: 'Tree', count, animType: AnimType.Sway, pose: [0.1, 0.4, 0], seed: 31 });
  const minY = cloud.bounds[1];
  const h = cloud.bounds[4] - minY;
  for (let i = 0; i < count; i++) cloud.anim[i] = clamp((cloud.positions[i * 3 + 1] - minY) / h);
  return cloud;
}
