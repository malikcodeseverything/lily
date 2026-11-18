import { OneEuroFilter } from './oneEuro';
import { classify, GestureStabilizer, handFeatures, type GestureName, type HandFeatures, type ModelGesture, type Point3 } from './gestures';

export interface TrackedHand {
  /** Stable id for the lifetime of this hand in view. */
  id: number;
  /** Smoothed landmarks in viewport space (x, y in 0..1, origin top-left). */
  points: Point3[];
  /** Unsmoothed palm center (middle knuckle) in viewport space, for fast motions like swipes. */
  palmRaw: { x: number; y: number };
  gesture: GestureName;
  features: HandFeatures;
  /** "Left" / "Right" from the subject's point of view. */
  handedness: string;
  /** Seconds this hand has been continuously tracked. */
  age: number;
}

export interface RawHand {
  /** Landmarks in raw video-normalized coordinates. */
  landmarks: Point3[];
  model: ModelGesture | null;
  handedness: string;
}

interface Slot {
  id: number;
  filters: OneEuroFilter[];
  stabilizer: GestureStabilizer;
  lastSeen: number;
  wrist: [number, number];
  hand: TrackedHand | null;
}

let nextId = 1;

/**
 * Keeps hand identities stable across frames (MediaPipe does not), and
 * owns per-hand smoothing and gesture state.
 */
export class HandSlots {
  private slots: Slot[] = [];
  /** How long a slot survives without detections before it is dropped. */
  graceMs = 180;

  /**
   * @param toViewport maps a raw video coordinate to viewport space.
   * @param aspect video width / height, for isotropic distances.
   */
  update(raw: RawHand[], now: number, dt: number, toViewport: (x: number, y: number) => [number, number], aspect: number): TrackedHand[] {
    const used = new Set<Slot>();
    for (const r of raw) {
      const w = r.landmarks[0];
      // Greedy nearest-wrist matching. With one hand in view and one slot,
      // it is the same hand even after a fast move.
      let best: Slot | null = null;
      let bestD = raw.length === 1 && this.slots.length === 1 ? 0.6 : 0.22;
      for (const s of this.slots) {
        if (used.has(s)) continue;
        const d = Math.hypot(s.wrist[0] - w.x, s.wrist[1] - w.y);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (!best) {
        best = {
          id: nextId++,
          filters: Array.from({ length: 63 }, () => new OneEuroFilter()),
          stabilizer: new GestureStabilizer(3),
          lastSeen: now,
          wrist: [w.x, w.y],
          hand: null,
        };
        this.slots.push(best);
      }
      used.add(best);
      const age = best.hand ? best.hand.age + dt : 0;
      best.lastSeen = now;
      best.wrist = [w.x, w.y];

      // Classify on raw coordinates (no smoothing lag), track on smoothed.
      const features = handFeatures(r.landmarks, aspect);
      const label = classify(features, r.model, best.stabilizer.current);
      const gesture = best.stabilizer.update(label);
      const points = r.landmarks.map((p, i) => {
        const fx = best!.filters[i * 3].filter(p.x, dt);
        const fy = best!.filters[i * 3 + 1].filter(p.y, dt);
        const fz = best!.filters[i * 3 + 2].filter(p.z, dt);
        const [vx, vy] = toViewport(fx, fy);
        return { x: vx, y: vy, z: fz };
      });
      const [px, py] = toViewport(r.landmarks[9].x, r.landmarks[9].y);
      best.hand = { id: best.id, points, palmRaw: { x: px, y: py }, gesture, features, handedness: r.handedness, age };
    }
    this.slots = this.slots.filter((s) => used.has(s) || now - s.lastSeen < this.graceMs);
    return this.slots.filter((s) => used.has(s) && s.hand).map((s) => s.hand!);
  }

  reset(): void {
    this.slots = [];
  }
}
