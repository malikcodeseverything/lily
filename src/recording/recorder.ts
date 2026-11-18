const TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Records the WebGL canvas (webcam + particles, no UI) to a video file.
 * Uses MP4 where the browser can encode it, WebM otherwise.
 */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

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
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const stream = this.canvas.captureStream(60);
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();
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
