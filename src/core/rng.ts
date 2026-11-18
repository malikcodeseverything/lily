/**
 * Small, fast, seedable PRNG (mulberry32). Procedural shapes use it so
 * every build of an object is identical from run to run.
 */
export class Rng {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  /** Signed float in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Standard normal sample (Box-Muller). */
  gauss(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Uniform point inside the unit sphere. */
  inSphere(out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    for (;;) {
      const x = this.signed();
      const y = this.signed();
      const z = this.signed();
      if (x * x + y * y + z * z <= 1) {
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
      }
    }
  }

  /** Uniform direction on the unit sphere. */
  onSphere(out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const z = this.signed();
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a);
    out[1] = r * Math.sin(a);
    out[2] = z;
    return out;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
