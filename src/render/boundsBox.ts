import * as THREE from 'three';

// Corners of a unit cube in [-0.5, 0.5]^3 and the 12 edges joining them.
const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
].map((c) => c.map((v) => v * 0.5));
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const dotVert = /* glsl */ `
uniform float uSize;
uniform float uPixelRatio;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio;
}
`;
const dotFrag = /* glsl */ `
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.7, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vec3(1.0), a * uOpacity);
}
`;

/**
 * The wireframe "gizmo" around the active object: thin edges with round
 * handles on the corners. It is drawn on top of everything, like a
 * viewport overlay in a 3D tool.
 */
export class BoundsBox {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly dots: THREE.Points;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly dotUniforms: Record<string, THREE.IUniform>;
  readonly center = new THREE.Vector3();
  readonly size = new THREE.Vector3(1, 1, 1);
  private opacity = 0.6;

  constructor() {
    const linePos: number[] = [];
    for (const [a, b] of EDGES) linePos.push(...CORNERS[a], ...CORNERS[b]);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false });
    this.lines = new THREE.LineSegments(lg, this.lineMat);

    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(CORNERS.flat(), 3));
    this.dotUniforms = { uSize: { value: 7 }, uPixelRatio: { value: 1 }, uOpacity: { value: 0.95 } };
    this.dots = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({ uniforms: this.dotUniforms, vertexShader: dotVert, fragmentShader: dotFrag, transparent: true, depthTest: false }),
    );
    this.lines.renderOrder = 10;
    this.dots.renderOrder = 11;
    this.lines.frustumCulled = false;
    this.dots.frustumCulled = false;
    this.group.add(this.lines, this.dots);
  }

  /** Set the box from min/max bounds in the parent's local space. */
  setBounds(min: THREE.Vector3, max: THREE.Vector3, padding = 0.06): void {
    this.center.addVectors(min, max).multiplyScalar(0.5);
    this.size.subVectors(max, min).addScalar(padding * 2);
    this.group.position.copy(this.center);
    this.group.scale.copy(this.size).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  }

  setOpacity(o: number): void {
    this.opacity = o;
    this.lineMat.opacity = 0.55 * o;
    this.dotUniforms.uOpacity.value = 0.95 * o;
    this.group.visible = o > 0.01;
  }

  getOpacity(): number {
    return this.opacity;
  }

  setPixelRatio(pr: number): void {
    this.dotUniforms.uPixelRatio.value = pr;
  }

  /** World-space positions of the 8 corners, for 2D labels. */
  cornersWorld(out: THREE.Vector3[] = []): THREE.Vector3[] {
    this.group.updateWorldMatrix(true, false);
    for (let i = 0; i < 8; i++) {
      out[i] = (out[i] ?? new THREE.Vector3()).fromArray(CORNERS[i]).applyMatrix4(this.group.matrixWorld);
    }
    return out;
  }
}
