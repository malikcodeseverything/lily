import { clamp, damp } from '../core/math';
import type { ParticleCloud, Slot } from '../render/particles';
import type { ShapeLibrary } from '../shapes/library';

/**
 * Sequences shape changes. The particle cloud has two slots; the director
 * writes the next shape into whichever slot is not on screen and animates
 * uMorph toward it. Requests that arrive mid-morph are queued (latest wins).
 */
export class MorphDirector {
  /** Index of the shape currently shown (or being morphed to). */
  index = 0;
  /** 0 = slot A visible, 1 = slot B visible. */
  morph = 0;
  private target = 0;
  duration = 2.4;
  collapse = 0;
  collapseTarget = 0;
  private queued: number | null = null;
  private loading = false;
  private listeners = new Set<(index: number) => void>();

  constructor(
    private readonly particles: ParticleCloud,
    private readonly library: ShapeLibrary,
  ) {}

  onChange(fn: (index: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Show the first shape immediately, bursting out of a collapsed core. */
  async init(index: number): Promise<void> {
    const cloud = await this.library.load(index);
    this.particles.load('A', cloud);
    this.particles.load('B', cloud);
    this.index = index;
    this.morph = 0;
    this.target = 0;
    this.collapse = 1;
    this.collapseTarget = 0;
    this.emit();
  }

  get busy(): boolean {
    return this.loading || Math.abs(this.morph - this.target) > 1e-3;
  }

  /** 0..1 progress of the current transition (0 when idle). */
  get progress(): number {
    return this.target === 1 ? this.morph : 1 - this.morph;
  }

  next(): void {
    this.show((this.pendingOrCurrent() + 1) % this.library.length);
  }

  prev(): void {
    this.show((this.pendingOrCurrent() - 1 + this.library.length) % this.library.length);
  }

  show(index: number): void {
    if (index === this.index && !this.busy) return;
    if (this.busy) {
      this.queued = index;
      return;
    }
    void this.start(index);
  }

  private pendingOrCurrent(): number {
    return this.queued ?? this.index;
  }

  private async start(index: number): Promise<void> {
    this.loading = true;
    try {
      const cloud = await this.library.load(index);
      const free: Slot = this.target === 0 ? 'B' : 'A';
      this.particles.load(free, cloud);
      this.target = this.target === 0 ? 1 : 0;
      this.index = index;
      this.emit();
    } catch (err) {
      console.error('Could not load shape', err);
    } finally {
      this.loading = false;
    }
  }

  update(dt: number): void {
    const step = dt / this.duration;
    if (this.morph < this.target) this.morph = Math.min(this.target, this.morph + step);
    else if (this.morph > this.target) this.morph = Math.max(this.target, this.morph - step);

    if (!this.busy && this.queued !== null) {
      const q = this.queued;
      this.queued = null;
      if (q !== this.index) void this.start(q);
    }

    // Collapse charges slowly and releases fast, like a spring letting go.
    const rate = this.collapseTarget > this.collapse ? 2.2 : 3.2;
    this.collapse = clamp(damp(this.collapse, this.collapseTarget, rate, dt));
    if (this.collapse < 1e-3 && this.collapseTarget === 0) this.collapse = 0;

    const u = this.particles.uniforms;
    u.uMorph.value = this.morph;
    u.uCollapse.value = this.collapse;
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn(this.index));
  }
}
