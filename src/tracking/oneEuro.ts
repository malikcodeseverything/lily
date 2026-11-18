/**
 * One Euro filter (Casiez, Roussel, Vogel 2012). Smooths jittery signals
 * heavily when they move slowly and lightly when they move fast, which is
 * exactly what hand landmarks need: steady when holding, snappy when
 * gesturing.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;

  constructor(
    public minCutoff = 1.2,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    this.dx = this.dx + aD * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.x = this.x + a * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
