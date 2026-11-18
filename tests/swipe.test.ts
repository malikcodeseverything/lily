import { describe, expect, it } from 'vitest';
import { SwipeDetector } from '../src/tracking/swipe';

/** Feed a straight motion at 60 fps and return the first non-zero result. */
function run(d: SwipeDetector, from: [number, number], to: [number, number], seconds: number, t0 = 0, armed = true): number {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i <= frames; i++) {
    const k = i / frames;
    const r = d.update(t0 + (i / 60), from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, armed);
    if (r !== 0) return r;
  }
  return 0;
}

describe('SwipeDetector', () => {
  it('fires on a quick flick in either direction', () => {
    expect(run(new SwipeDetector(), [0.7, 0.5], [0.3, 0.5], 0.2)).toBe(-1);
    expect(run(new SwipeDetector(), [0.3, 0.5], [0.7, 0.5], 0.2)).toBe(1);
  });

  it('ignores slow drifts and short twitches', () => {
    expect(run(new SwipeDetector(), [0.3, 0.5], [0.7, 0.5], 1.5)).toBe(0);
    expect(run(new SwipeDetector(), [0.5, 0.5], [0.58, 0.5], 0.08)).toBe(0);
  });

  it('ignores mostly vertical motion', () => {
    expect(run(new SwipeDetector(), [0.5, 0.2], [0.62, 0.8], 0.2)).toBe(0);
  });

  it('does nothing unless armed (open palm)', () => {
    expect(run(new SwipeDetector(), [0.7, 0.5], [0.3, 0.5], 0.2, 0, false)).toBe(0);
  });

  it('respects the cooldown', () => {
    const d = new SwipeDetector();
    expect(run(d, [0.7, 0.5], [0.3, 0.5], 0.2, 0)).toBe(-1);
    expect(run(d, [0.3, 0.5], [0.7, 0.5], 0.2, 0.3)).toBe(0);
    expect(run(d, [0.3, 0.5], [0.7, 0.5], 0.2, 1.5)).toBe(1);
  });
});
