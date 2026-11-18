/**
 * How a cloud moves on its own while it is on screen. The vertex shader
 * reads the per-point `anim` value differently for each type.
 */
export const AnimType = {
  /** Static. */
  None: 0,
  /** Butterfly wings. anim = wing side (-1 left, +1 right, 0 body). */
  Flap: 1,
  /** Plants. anim = normalized height above the base (0..1). */
  Sway: 2,
  /** Dragon. 0..1 tail weight, |anim| >= 1 wing (sign = side). */
  Dragon: 3,
  /** Jellyfish. 0..1 bell rim weight, 1..2 tentacle parameter. */
  Pulse: 4,
  /** Aircraft. Gentle roll and bob; anim >= 1 is afterburner (1 + distance along the plume). */
  Jet: 5,
  /** Planets, rings, galaxies. anim = orbital radius (0 = solid-body spin). */
  Orbit: 6,
  /** Fish. anim = 0..1 from head to tail; 2..3 = fin flutter. */
  Swim: 7,
} as const;
export type AnimType = (typeof AnimType)[keyof typeof AnimType];

/** A colored, lit point cloud ready to upload to the GPU. */
export interface PointCloud {
  name: string;
  count: number;
  /** xyz per point, centered and scaled to fit a ~2 unit box. */
  positions: Float32Array;
  /** rgb per point in 0..1. */
  colors: Float32Array;
  /** xyz per point. All zeros means "unlit" (used for imported scans). */
  normals: Float32Array;
  /** Per point size multiplier. Negative = one-sided (hidden when facing away). */
  sizes: Float32Array;
  /** Per point animation parameter, meaning depends on animType. */
  anim: Float32Array;
  animType: AnimType;
  /** Euler angles (radians) applied after animation, for a nicer resting pose. */
  pose: [number, number, number];
  /** Extra emissive strength, 0 = none. */
  glow: number;
  /** Axis-aligned bounds in local (pre-pose) space: [minX,minY,minZ,maxX,maxY,maxZ]. */
  bounds: [number, number, number, number, number, number];
}

export interface ShapeDefinition {
  id: string;
  name: string;
  build: (count: number) => PointCloud;
}
