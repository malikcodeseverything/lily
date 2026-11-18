import { describe, expect, it } from 'vitest';
import { coverTransform } from '../src/render/background';
import { videoToViewport } from '../src/tracking/coords';
import { OneEuroFilter } from '../src/tracking/oneEuro';

describe('OneEuroFilter', () => {
  it('passes the first sample through and converges on a constant', () => {
    const f = new OneEuroFilter();
    expect(f.filter(5, 1 / 60)).toBe(5);
    let v = 0;
    for (let i = 0; i < 240; i++) v = f.filter(10, 1 / 60);
    expect(v).toBeCloseTo(10, 3);
  });

  it('reduces jitter on a noisy, stationary signal', () => {
    const f = new OneEuroFilter();
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + noise();
      raw.push(x);
      out.push(f.filter(x, 1 / 60));
    }
    const spread = (a: number[]) => Math.max(...a.slice(60)) - Math.min(...a.slice(60));
    expect(spread(out)).toBeLessThan(spread(raw) * 0.5);
  });
});

describe('videoToViewport', () => {
  it('is the inverse of the background cover mapping', () => {
    const [vw, vh, w, h] = [1280, 720, 900, 1000];
    const c = coverTransform(vw, vh, w, h);
    for (const [sx, sy] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]]) {
      const videoX = sx * c.scaleX + c.offsetX;
      const videoY = sy * c.scaleY + c.offsetY;
      const [x, y] = videoToViewport(videoX, videoY, vw, vh, w, h, false);
      expect(x).toBeCloseTo(sx, 6);
      expect(y).toBeCloseTo(sy, 6);
    }
  });

  it('mirrors horizontally like a selfie camera', () => {
    const [x] = videoToViewport(0.2, 0.5, 1280, 720, 1280, 720, true);
    expect(x).toBeCloseTo(0.8, 6);
  });

  it('crops the sides of a wide video on a tall screen', () => {
    const c = coverTransform(1280, 720, 400, 800);
    expect(c.scaleY).toBe(1);
    expect(c.scaleX).toBeLessThan(1);
    expect(c.offsetX).toBeCloseTo((1 - c.scaleX) / 2, 6);
  });
});
