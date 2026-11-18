import type { Background } from '../render/background';
import { coverTransform } from '../render/background';

const TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Records the clean render (webcam + particles, no UI) to a video file.
 * The webcam lives in a <video> element under the WebGL canvas, so each
 * frame is composited onto an offscreen 2D canvas right after rendering.
 * Uses MP4 where the browser can encode it, WebM otherwise.
 */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private readonly composite = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly gl: HTMLCanvasElement,
    private readonly background: Background,
  ) {
    this.ctx = this.composite.getContext('2d')!;
  }

  static get supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get elapsed(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(): void {
    if (this.recording) return;
    this.composite.width = this.gl.width;
    this.composite.height = this.gl.height;
    this.capture(true);
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const stream = this.composite.captureStream(60);
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();
  }

  /** Draw the current frame. Call right after the WebGL render. */
  capture(force = false): void {
    if (!force && !this.recording) return;
    const { ctx } = this;
    const w = this.composite.width;
    const h = this.composite.height;
    ctx.clearRect(0, 0, w, h);
    const video = this.background.getVideo();
    if (video && video.videoWidth > 0) {
      const c = coverTransform(video.videoWidth, video.videoHeight, w, h);
      ctx.save();
      if (this.background.isMirrored()) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        video,
        c.offsetX * video.videoWidth, c.offsetY * video.videoHeight,
        c.scaleX * video.videoWidth, c.scaleY * video.videoHeight,
        0, 0, w, h,
      );
      ctx.restore();
      const dim = this.background.getDim();
      if (dim < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - dim})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.drawImage(this.gl, 0, 0, w, h);
  }

  /** Stop and download. Resolves with the file name. */
  stop(): Promise<string> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve('');
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm';
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(this.chunks, { type });
        const name = `lily-${timestamp()}.${ext}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        rec.stream.getTracks().forEach((t) => t.stop());
        this.recorder = null;
        resolve(name);
      };
      rec.stop();
    });
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
