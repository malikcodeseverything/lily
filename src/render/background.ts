import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Ambient backdrop used when the camera is off.
const frag = /* glsl */ `
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float r = length(p);
  vec3 col = mix(vec3(0.045, 0.05, 0.07), vec3(0.008, 0.008, 0.012), smoothstep(0.0, 0.9, r));
  col += 0.012 * vec3(0.3, 0.5, 1.0) * (1.0 - smoothstep(0.0, 0.6, r));
  vec2 q = uv - 0.5;
  col *= 1.0 - 0.35 * dot(q, q) * 2.0;
  col += (hash(uv * uResolution + fract(uTime) * 100.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * What sits behind the particles.
 *
 * The webcam is a real <video> element under a transparent WebGL canvas,
 * scaled with CSS object-fit: cover. Letting the browser draw the video
 * keeps its aspect ratio correct everywhere (uploading camera frames as a
 * WebGL texture can come out stretched in some browsers, notably Safari),
 * and it is cheaper than a per-frame texture upload. With no camera, an
 * ambient gradient is drawn in WebGL instead.
 */
export class Background {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly layer: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private mirror = true;
  private dim = 0.88;

  constructor(container: HTMLElement) {
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.layer = document.createElement('div');
    this.layer.className = 'camera-layer';
    container.prepend(this.layer);
  }

  /** True when the WebGL gradient should be drawn (no camera). */
  get ambient(): boolean {
    return !this.video;
  }

  getVideo(): HTMLVideoElement | null {
    return this.video;
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video?.remove();
    this.video = video;
    if (video) {
      video.className = 'camera';
      this.layer.prepend(video);
      void video.play().catch(() => undefined);
    }
    this.layer.classList.toggle('on', !!video);
    this.applyStyle();
  }

  setMirror(on: boolean): void {
    this.mirror = on;
    this.applyStyle();
  }

  setDim(dim: number): void {
    this.dim = dim;
    this.applyStyle();
  }

  getDim(): number {
    return this.dim;
  }

  isMirrored(): boolean {
    return this.mirror;
  }

  private applyStyle(): void {
    if (!this.video) return;
    this.video.style.transform = this.mirror ? 'scaleX(-1)' : 'none';
    // A light grade so the particles carry the frame.
    this.video.style.filter = `saturate(0.85) brightness(${this.dim})`;
  }

  update(width: number, height: number, time: number): void {
    this.uniforms.uTime.value = time;
    (this.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }
}

/**
 * UV transform equivalent to CSS object-fit: cover for a video of size
 * (vw, vh) in a viewport of size (w, h): screenUv * scale + offset = videoUv.
 */
export function coverTransform(vw: number, vh: number, w: number, h: number) {
  const videoAspect = vw / vh;
  const viewAspect = w / h;
  let scaleX = 1;
  let scaleY = 1;
  if (viewAspect > videoAspect) scaleY = videoAspect / viewAspect;
  else scaleX = viewAspect / videoAspect;
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 };
}
