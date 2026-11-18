import { describe, expect, it } from 'vitest';
import { classify, GestureStabilizer, handFeatures } from '../src/tracking/gestures';
import { makeHand } from './handFixtures';

const label = (pose: Parameters<typeof makeHand>[0], prev: Parameters<typeof classify>[2] = 'none', model: Parameters<typeof classify>[1] = null) =>
  classify(handFeatures(makeHand(pose), 1), model, prev);

describe('classify', () => {
  it('recognizes an open palm', () => {
    expect(label({ index: 'ext', middle: 'ext', ring: 'ext', pinky: 'ext', thumb: 'side' })).toBe('open');
  });

  it('recognizes a fist even though the thumb rests near the index', () => {
    expect(label({ index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'tucked' })).toBe('fist');
  });

  it('recognizes a pinch with the other fingers relaxed or curled', () => {
    expect(label({ index: 'half', middle: 'ext', ring: 'ext', pinky: 'ext', thumb: 'pinch' })).toBe('pinch');
    expect(label({ index: 'half', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'pinch' })).toBe('pinch');
  });

  it('recognizes pointing and the peace sign', () => {
    expect(label({ index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'tucked' })).toBe('point');
    expect(label({ index: 'ext', middle: 'ext', ring: 'curl', pinky: 'curl', thumb: 'tucked' })).toBe('victory');
  });

  it('uses hysteresis so a held pinch survives a slightly wider grip', () => {
    const f = handFeatures(makeHand({ index: 'half', middle: 'ext', ring: 'ext', pinky: 'ext', thumb: 'pinch' }), 1);
    const loose = { ...f, pinch: 0.42 };
    expect(classify(loose, null, 'none')).not.toBe('pinch');
    expect(classify(loose, null, 'pinch')).toBe('pinch');
  });

  it('trusts a confident model label when geometry is ambiguous', () => {
    const f = handFeatures(makeHand({ index: 'half', middle: 'half', ring: 'ext', pinky: 'ext', thumb: 'side' }), 1);
    expect(classify(f, { name: 'Open_Palm', score: 0.92 })).toBe('open');
    expect(classify(f, { name: 'Open_Palm', score: 0.3 })).not.toBe('open');
  });

  it('is scale invariant', () => {
    const pose = { index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'tucked' } as const;
    expect(classify(handFeatures(makeHand(pose, 0.3, 0.6, 0.04), 1), null)).toBe('point');
    expect(classify(handFeatures(makeHand(pose, 0.5, 0.7, 0.25), 1), null)).toBe('point');
  });
});

describe('GestureStabilizer', () => {
  it('waits for a few consistent frames before switching', () => {
    const s = new GestureStabilizer(3);
    expect(s.update('open')).toBe('none');
    expect(s.update('open')).toBe('none');
    expect(s.update('open')).toBe('open');
  });

  it('ignores a one-frame blip', () => {
    const s = new GestureStabilizer(3);
    for (let i = 0; i < 3; i++) s.update('open');
    expect(s.update('fist')).toBe('open');
    expect(s.update('open')).toBe('open');
    expect(s.update('fist')).toBe('open');
  });

  it('switches into pinch faster than other gestures', () => {
    const s = new GestureStabilizer(3);
    s.update('pinch');
    expect(s.update('pinch')).toBe('pinch');
  });
});

describe('classify (extra gestures)', () => {
  it('recognizes the rock sign and keeps it distinct from pointing', () => {
    expect(label({ index: 'ext', middle: 'curl', ring: 'curl', pinky: 'ext', thumb: 'side' })).toBe('rock');
    expect(label({ index: 'ext', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'tucked' })).toBe('point');
  });

  it('only reports thumbs down when the model says so and the fingers are folded', () => {
    const fist = { index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl', thumb: 'side' } as const;
    expect(label(fist, 'none', { name: 'Thumb_Down', score: 0.9 })).toBe('thumbsDown');
    const open = { index: 'ext', middle: 'ext', ring: 'ext', pinky: 'ext', thumb: 'side' } as const;
    expect(label(open, 'none', { name: 'Thumb_Down', score: 0.9 })).not.toBe('thumbsDown');
  });
});
