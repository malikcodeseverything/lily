/**
 * Hand pose classification from the 21 MediaPipe landmarks, blended with
 * the model's own canned gesture scores. Geometry handles pinch (which the
 * model has no class for) and acts as a tie breaker everywhere else.
 */
export type GestureName = 'none' | 'open' | 'fist' | 'pinch' | 'point' | 'victory' | 'thumbsUp';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelGesture {
  name: string;
  score: number;
}

export interface HandFeatures {
  /** Thumb tip to index tip, divided by hand size. */
  pinch: number;
  /** Tip-to-wrist / knuckle-to-wrist for index, middle, ring, pinky. */
  extension: [number, number, number, number];
  /** Wrist to middle knuckle, in aspect-corrected normalized units. */
  handSize: number;
}

const FINGERS: [number, number][] = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];

function dist(a: Point3, b: Point3, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * aspect;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function handFeatures(lm: Point3[], aspect: number): HandFeatures {
  const wrist = lm[0];
  const handSize = Math.max(dist(wrist, lm[9], aspect), 1e-4);
  const extension = FINGERS.map(([mcp, tip]) => dist(lm[tip], wrist, aspect) / Math.max(dist(lm[mcp], wrist, aspect), 1e-4)) as HandFeatures['extension'];
  return { pinch: dist(lm[4], lm[8], aspect) / handSize, extension, handSize };
}

export const THRESHOLDS = {
  extended: 1.55,
  extendedHold: 1.42,
  curled: 1.28,
  /** The index curls less than the others when pinching, so a fist needs it tighter. */
  indexCurled: 1.12,
  pinchEnter: 0.34,
  pinchExit: 0.5,
  model: 0.6,
};

/**
 * Classify one frame. `prev` adds hysteresis so poses near a threshold
 * do not flicker between labels.
 */
export function classify(f: HandFeatures, model: ModelGesture | null, prev: GestureName = 'none'): GestureName {
  const T = THRESHOLDS;
  const ext = prev === 'open' ? T.extendedHold : T.extended;
  const extended = f.extension.map((r) => r > ext);
  const curled = f.extension.map((r, i) => r < (i === 0 ? T.indexCurled : T.curled));
  const curledCount = curled.filter(Boolean).length;
  const extendedCount = extended.filter(Boolean).length;
  const m = model && model.score >= T.model ? model.name : 'None';

  // Fist first: a closed hand often has the thumb resting near the index
  // tip, which would otherwise read as a pinch.
  if (curledCount === 4 || (m === 'Closed_Fist' && curledCount >= 3)) return 'fist';

  const pinchLimit = prev === 'pinch' ? T.pinchExit : T.pinchEnter;
  if (f.pinch < pinchLimit && f.extension[0] > 1.0) return 'pinch';

  if (m === 'Thumb_Up' && curledCount >= 3) return 'thumbsUp';
  if ((extendedCount === 4 && f.pinch > 0.55) || m === 'Open_Palm') return 'open';
  if ((extended[0] && extended[1] && curled[2] && curled[3]) || m === 'Victory') return 'victory';
  if ((extended[0] && curled[1] && curled[2]) || m === 'Pointing_Up') return 'point';
  return 'none';
}

/**
 * Debounces the per-frame label: a new gesture must be seen for a few
 * consecutive frames before it replaces the current one. Pinch gets a
 * faster path because grabbing needs to feel immediate.
 */
export class GestureStabilizer {
  current: GestureName = 'none';
  private candidate: GestureName = 'none';
  private frames = 0;

  constructor(private readonly minFrames = 3) {}

  update(next: GestureName): GestureName {
    if (next === this.current) {
      this.candidate = next;
      this.frames = 0;
      return this.current;
    }
    if (next === this.candidate) this.frames++;
    else {
      this.candidate = next;
      this.frames = 1;
    }
    const needed = next === 'pinch' || this.current === 'pinch' ? 2 : this.minFrames;
    if (this.frames >= needed) {
      this.current = next;
      this.frames = 0;
    }
    return this.current;
  }

  reset(): void {
    this.current = 'none';
    this.candidate = 'none';
    this.frames = 0;
  }
}
