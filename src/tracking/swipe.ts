/**
 * Detects a quick horizontal flick of an open hand. Positions are in
 * viewport units (0..1 across the screen), so the thresholds are
 * independent of resolution.
 */
export interface SwipeOptions {
  /** Look-back window in seconds. */
  window: number;
  /** Minimum horizontal travel across the window (fraction of screen width). */
  distance: number;
  /** Minimum average speed (screen widths per second). */
  speed: number;
  /** Horizontal travel must dominate vertical travel by this ratio. */
  straightness: number;
  /** Ignore further swipes for this long after one fires. */
  cooldown: number;
}

const DEFAULTS: SwipeOptions = { window: 0.28, distance: 0.2, speed: 1.0, straightness: 1.8, cooldown: 0.9 };

export class SwipeDetector {
  private samples: { t: number; x: number; y: number }[] = [];
  private quietUntil = 0;
  readonly opts: SwipeOptions;

  constructor(opts: Partial<SwipeOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Feed one sample. `armed` should be true only while the hand is in a
   * pose that may swipe (open palm). Returns -1 for a leftward swipe,
   * +1 for rightward, 0 otherwise.
   */
  update(t: number, x: number, y: number, armed: boolean): -1 | 0 | 1 {
    if (!armed) {
      this.samples = [];
      return 0;
    }
    this.samples.push({ t, x, y });
    while (this.samples.length && t - this.samples[0].t > this.opts.window) this.samples.shift();
    if (t < this.quietUntil || this.samples.length < 3) return 0;
    const first = this.samples[0];
    const dt = t - first.t;
    if (dt < 0.06) return 0;
    const dx = x - first.x;
    const dy = y - first.y;
    if (Math.abs(dx) < this.opts.distance) return 0;
    if (Math.abs(dx) / dt < this.opts.speed) return 0;
    if (Math.abs(dx) < Math.abs(dy) * this.opts.straightness) return 0;
    this.quietUntil = t + this.opts.cooldown;
    this.samples = [];
    return dx > 0 ? 1 : -1;
  }

  /** Suppress swipes for a while (e.g. right after a burst). */
  quiet(until: number): void {
    this.quietUntil = Math.max(this.quietUntil, until);
  }

  reset(): void {
    this.samples = [];
  }
}
