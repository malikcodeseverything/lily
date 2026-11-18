import { FilesetResolver, GestureRecognizer, type GestureRecognizerResult } from '@mediapipe/tasks-vision';
import type { RawHand } from './handSlots';

const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';

export type TrackerStatus = 'idle' | 'camera' | 'model' | 'ready' | 'error';

/**
 * Webcam + MediaPipe gesture recognizer. The wasm runtime is served from
 * our own origin (copied out of node_modules at install time) and the
 * model from a local copy when present, falling back to Google's CDN.
 */
export class HandTracker {
  readonly video: HTMLVideoElement;
  status: TrackerStatus = 'idle';
  error = '';
  private recognizer: GestureRecognizer | null = null;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;
  private lastResult: RawHand[] = [];
  /** Milliseconds the last inference took, for the debug readout. */
  inferenceMs = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get aspect(): number {
    return this.video.videoWidth / Math.max(this.video.videoHeight, 1) || 16 / 9;
  }

  async start(onStatus?: (s: TrackerStatus) => void): Promise<void> {
    const set = (s: TrackerStatus) => {
      this.status = s;
      onStatus?.(s);
    };
    try {
      set('camera');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not expose a camera API (needs HTTPS or localhost).');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      set('model');
      if (!this.recognizer) this.recognizer = await this.createRecognizer();
      set('ready');
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.stop();
      set('error');
      throw err;
    }
  }

  private async createRecognizer(): Promise<GestureRecognizer> {
    const base = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    const localModel = `${base}mediapipe/gesture_recognizer.task`;
    const modelAssetPath = (await exists(localModel)) ? localModel : REMOTE_MODEL;
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      return await GestureRecognizer.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      return GestureRecognizer.createFromOptions(fileset, options('CPU'));
    }
  }

  /** Run inference if the camera produced a new frame since last call. */
  detect(now: number): RawHand[] {
    const r = this.recognizer;
    const v = this.video;
    if (!r || this.status !== 'ready' || v.readyState < 2) return this.lastResult;
    if (v.currentTime === this.lastVideoTime) return this.lastResult;
    this.lastVideoTime = v.currentTime;
    const t0 = performance.now();
    let res: GestureRecognizerResult;
    try {
      res = r.recognizeForVideo(v, now);
    } catch (err) {
      console.warn('recognize failed', err);
      return this.lastResult;
    }
    this.inferenceMs = performance.now() - t0;
    this.lastResult = res.landmarks.map((landmarks, i) => ({
      landmarks,
      model: res.gestures[i]?.[0] ? { name: res.gestures[i][0].categoryName, score: res.gestures[i][0].score } : null,
      handedness: res.handedness[i]?.[0]?.categoryName ?? '',
    }));
    return this.lastResult;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastResult = [];
    if (this.status !== 'error') this.status = 'idle';
  }

  get running(): boolean {
    return this.status === 'ready';
  }
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    // Dev servers answer unknown paths with index.html, so check the type.
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}
