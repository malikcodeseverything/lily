/**
 * Tiny vector helpers for the generators. Plain tuples keep the procedural
 * code short and avoid allocating three.js objects in hot loops.
 */
export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerpV = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** a + b*s */
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Rotate v around a unit axis by angle (Rodrigues). */
export function rotateAxis(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v) * (1 - c);
  const cr = cross(axis, v);
  return [v[0] * c + cr[0] * s + axis[0] * d, v[1] * c + cr[1] * s + axis[1] * d, v[2] * c + cr[2] * s + axis[2] * d];
}

/** Any unit vector perpendicular to n. */
export function perpendicular(n: V3): V3 {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, a));
}

/** 3x3 rotation as row-major array, built from Euler XYZ. */
export type M3 = number[];
export function eulerToM3(x: number, y: number, z: number): M3 {
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
export const mulM3 = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Rotation matrix that maps +Y onto direction d. */
export function alignY(d: V3): M3 {
  const y = norm(d);
  const x = perpendicular(y);
  const z = cross(x, y);
  // Columns are x, y, z.
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** Centripetal-ish Catmull-Rom through control points, t in [0,1]. */
export function catmull(points: V3[], t: number): V3 {
  const n = points.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = points[Math.max(i - 1, 0)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(i + 2, n)];
  const u2 = u * u;
  const u3 = u2 * u;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      0.5 *
      (2 * p1[k] +
        (-p0[k] + p2[k]) * u +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
  }
  return out;
}

/** Closed Catmull-Rom outline sampled into a polygon. */
export function closedCatmull2D(points: [number, number][], samplesPer = 24): [number, number][] {
  const out: [number, number][] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPer; s++) {
      const u = s / samplesPer;
      const u2 = u * u;
      const u3 = u2 * u;
      const c = (k: 0 | 1) =>
        0.5 *
        (2 * p1[k] +
          (-p0[k] + p2[k]) * u +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
      out.push([c(0), c(1)]);
    }
  }
  return out;
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the polygon boundary. */
export function distToPolygon(x: number, y: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1];
    const bx = poly[i][0], by = poly[i][1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + dx * t - x, py = ay + dy * t - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
