import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = /* glsl */ `
uniform sampler2D uVideo;
uniform float uHasVideo;
uniform vec4 uCover;   // uv scale (xy) and offset (zw)
uniform float uMirror;
uniform float uDim;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec3 col;
  if (uHasVideo > 0.5) {
    vec2 s = uv;
    if (uMirror > 0.5) s.x = 1.0 - s.x;
    s = s * uCover.xy + uCover.zw;
    col = texture2D(uVideo, s).rgb;
    // Gentle grade: slightly lower saturation and exposure so the
    // particles carry the frame.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 0.85) * uDim;
  } else {
    vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(p);
    col = mix(vec3(0.045, 0.05, 0.07), vec3(0.008, 0.008, 0.012), smoothstep(0.0, 0.9, r));
    col += 0.012 * vec3(0.3, 0.5, 1.0) * (1.0 - smoothstep(0.0, 0.6, r));
  }
  // Vignette and fine grain.
  vec2 q = uv - 0.5;
  col *= 1.0 - 0.35 * dot(q, q) * 2.0;
  col += (hash(uv * uResolution + fract(uTime) * 100.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Fullscreen webcam (or ambient gradient) drawn behind the particles.
 * Rendering the video inside WebGL keeps everything in one canvas, which
 * makes recording a single captureStream() call.
 */
export class Background {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms: Record<string, THREE.IUniform>;
  private texture: THREE.VideoTexture | null = null;
  private video: HTMLVideoElement | null = null;

  constructor() {
    this.uniforms = {
      uVideo: { value: null },
      uHasVideo: { value: 0 },
      uCover: { value: new THREE.Vector4(1, 1, 0, 0) },
      uMirror: { value: 1 },
      uDim: { value: 0.88 },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.texture?.dispose();
    this.video = video;
    if (video) {
      this.texture = new THREE.VideoTexture(video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this.uniforms.uVideo.value = this.texture;
      this.uniforms.uHasVideo.value = 1;
    } else {
      this.texture = null;
      this.uniforms.uVideo.value = null;
      this.uniforms.uHasVideo.value = 0;
    }
  }

  setMirror(on: boolean): void {
    this.uniforms.uMirror.value = on ? 1 : 0;
  }

  update(width: number, height: number, time: number): void {
    this.uniforms.uTime.value = time;
    (this.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    const v = this.video;
    if (v && v.videoWidth > 0) {
      const c = coverTransform(v.videoWidth, v.videoHeight, width, height);
      (this.uniforms.uCover.value as THREE.Vector4).set(c.scaleX, c.scaleY, c.offsetX, c.offsetY);
    }
  }
}

/**
 * UV transform that makes a video of size (vw, vh) "object-fit: cover" a
 * viewport of size (w, h). screenUv * scale + offset = videoUv.
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
