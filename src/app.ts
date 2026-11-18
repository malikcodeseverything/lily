import * as THREE from 'three';
import { QUALITY_POINTS, type AppOptions } from './config';
import { clamp, smoothstep } from './core/math';
import { FingerField } from './interaction/fingers';
import { MorphDirector } from './interaction/morphDirector';
import { ObjectTransform } from './interaction/objectTransform';
import { PointerController } from './interaction/pointerController';
import { Background } from './render/background';
import { BoundsBox } from './render/boundsBox';
import { ParticleCloud } from './render/particles';
import { ShapeLibrary } from './shapes/library';

export interface FrameHook {
  (dt: number, time: number): void;
}

/**
 * Owns the renderer, scene graph and per-frame update order. Input sources
 * (pointer, hands) and UI attach through hooks so this stays small.
 */
export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly particles: ParticleCloud;
  readonly box = new BoundsBox();
  readonly background = new Background();
  readonly transform = new ObjectTransform();
  readonly library: ShapeLibrary;
  readonly director: MorphDirector;
  readonly fingers: FingerField;
  readonly pointer: PointerController;
  readonly canvas: HTMLCanvasElement;

  /** Extra per-frame work (hand tracking, HUD). Runs before rendering. */
  readonly hooks: FrameHook[] = [];
  /** True while any controller is holding the object this frame. */
  held = false;
  /** Box opacity boost while the object is being manipulated. */
  private grabGlow = 0;
  private boxOpacity = 1;
  private last = performance.now();
  private elapsed = 0;
  private frameTimes: number[] = [];
  fps = 60;

  constructor(
    private readonly container: HTMLElement,
    readonly options: AppOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage';
    container.appendChild(this.canvas);

    this.camera.position.set(0, 0, 6);
    this.camera.lookAt(0, 0, 0);

    const capacity = QUALITY_POINTS[options.quality];
    this.particles = new ParticleCloud(capacity);
    this.particles.uniforms.uPointSize.value = 0.0155 * Math.sqrt(QUALITY_POINTS.medium / capacity);
    this.particles.setHaloEnabled(options.glow);
    this.root.add(this.particles.group, this.box.group);
    this.scene.add(this.root);
    this.box.setOpacity(options.showBox ? 1 : 0);
    this.boxOpacity = options.showBox ? 1 : 0;
    this.background.setMirror(options.mirror);

    this.library = new ShapeLibrary(capacity);
    this.director = new MorphDirector(this.particles, this.library);
    this.fingers = new FingerField(this.particles.uniforms.uFingers.value as THREE.Vector4[]);
    this.pointer = new PointerController(this.canvas, this.camera, this.transform, this.fingers);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async start(): Promise<void> {
    const startIndex = Math.max(0, this.library.entries.findIndex((e) => e.id === this.options.startShape));
    await this.director.init(startIndex);
    void this.library.prewarm();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setBoxVisible(on: boolean): void {
    this.boxOpacity = on ? 1 : 0;
  }

  get boxVisible(): boolean {
    return this.boxOpacity > 0;
  }

  setGlow(on: boolean): void {
    this.particles.setHaloEnabled(on);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the object comfortably framed on tall phone screens too.
    this.camera.fov = w / h < 0.8 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.particles.uniforms.uViewportHeight.value = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.box.setPixelRatio(this.renderer.getPixelRatio());
  }

  private frame(): void {
    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 1 / 20);
    this.last = now;
    this.elapsed += dt;
    this.trackFps(dt);

    this.held = this.pointer.dragging;
    for (const hook of this.hooks) hook(dt, this.elapsed);
    this.pointer.update();

    this.transform.update(dt, this.held);
    this.transform.applyTo(this.root);
    this.director.update(dt);
    this.fingers.update(dt);

    const u = this.particles.uniforms;
    u.uTime.value = this.elapsed;
    u.uObjectScale.value = this.transform.scale;
    this.updateBox(dt);

    const size = this.renderer.getSize(new THREE.Vector2());
    this.background.update(size.x, size.y, this.elapsed);

    this.renderer.clear();
    this.renderer.render(this.background.scene, this.background.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private updateBox(dt: number): void {
    const { A, B } = this.particles.slots;
    const m = smoothstep(0.15, 0.85, this.director.morph);
    const min = new THREE.Vector3(
      A.bounds[0] + (B.bounds[0] - A.bounds[0]) * m,
      A.bounds[1] + (B.bounds[1] - A.bounds[1]) * m,
      A.bounds[2] + (B.bounds[2] - A.bounds[2]) * m,
    );
    const max = new THREE.Vector3(
      A.bounds[3] + (B.bounds[3] - A.bounds[3]) * m,
      A.bounds[4] + (B.bounds[4] - A.bounds[4]) * m,
      A.bounds[5] + (B.bounds[5] - A.bounds[5]) * m,
    );
    // Shrink with the collapse so the box hugs the glowing core.
    const c = smoothstep(0, 1, this.director.collapse);
    const core = new THREE.Vector3(0.3, 0.3, 0.3);
    min.lerp(core.clone().negate(), c);
    max.lerp(core, c);
    this.box.setBounds(min, max);

    this.grabGlow += ((this.held ? 1 : 0) - this.grabGlow) * (1 - Math.exp(-8 * dt));
    const target = this.boxOpacity * (0.75 + 0.25 * this.grabGlow);
    const cur = this.box.getOpacity();
    this.box.setOpacity(cur + (target - cur) * (1 - Math.exp(-10 * dt)));
  }

  private trackFps(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1 / avg : 60;
  }
}
