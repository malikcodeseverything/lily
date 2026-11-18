import type { Point3 } from '../src/tracking/gestures';

type FingerPose = 'ext' | 'curl' | 'half';

/**
 * Builds a plausible 21-point MediaPipe hand in normalized image space.
 * Palm faces the camera, fingers point up (negative y).
 */
export function makeHand(
  pose: { index: FingerPose; middle: FingerPose; ring: FingerPose; pinky: FingerPose; thumb: 'side' | 'pinch' | 'tucked' },
  cx = 0.5,
  cy = 0.75,
  s = 0.1,
): Point3[] {
  const P = (x: number, y: number): Point3 => ({ x: cx + x * s, y: cy + y * s, z: 0 });
  const pts: Point3[] = new Array(21);
  pts[0] = P(0, 0);
  const mcps: [number, number][] = [[-0.35, -1.0], [-0.1, -1.05], [0.15, -1.0], [0.38, -0.9]];
  const poses = [pose.index, pose.middle, pose.ring, pose.pinky];
  mcps.forEach(([mx, my], f) => {
    const base = 5 + f * 4;
    pts[base] = P(mx, my);
    const p = poses[f];
    if (p === 'ext') {
      pts[base + 1] = P(mx, my - 0.4);
      pts[base + 2] = P(mx, my - 0.65);
      pts[base + 3] = P(mx, my - 0.9);
    } else if (p === 'curl') {
      pts[base + 1] = P(mx, my - 0.3);
      pts[base + 2] = P(mx, my - 0.1);
      pts[base + 3] = P(mx, my + 0.15);
    } else {
      pts[base + 1] = P(mx - 0.05, my - 0.3);
      pts[base + 2] = P(mx - 0.1, my - 0.42);
      pts[base + 3] = P(mx - 0.12, my - 0.45);
    }
  });
  pts[1] = P(-0.3, -0.2);
  pts[2] = P(-0.55, -0.4);
  pts[3] = P(-0.7, -0.6);
  if (pose.thumb === 'side') pts[4] = P(-0.85, -0.8);
  else if (pose.thumb === 'tucked') pts[4] = P(-0.1, -0.7);
  else pts[4] = { ...pts[8], x: pts[8].x - 0.01 * s };
  return pts;
}
