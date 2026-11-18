import './ui/styles.css';
import * as THREE from 'three';
import { App } from './app';
import { readOptions, QUALITY_POINTS } from './config';
import { HandController } from './interaction/handController';
import { worldToViewport } from './interaction/projection';
import { importFile } from './io/importer';
import { Recorder } from './recording/recorder';
import { Overlay } from './render/overlay';
import { videoToViewport } from './tracking/coords';
import { HandSlots, type TrackedHand } from './tracking/handSlots';
import { HandTracker } from './tracking/handTracker';
import { Hud, type HudSettings } from './ui/hud';

const options = readOptions();
const container = document.getElementById('app')!;
const app = new App(container, options);
const overlay = new Overlay(document.body);
const tracker = new HandTracker();
const slots = new HandSlots();
const hands = new HandController(app.camera, app.transform, app.director, app.fingers, () => tracker.aspect);
const recorder = new Recorder(app.canvas);

// ---- Persisted settings ---------------------------------------------------
const STORE = 'lily.settings.v1';
const saved: Partial<HudSettings> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
})();
const settings: HudSettings = {
  glow: saved.glow ?? options.glow,
  box: saved.box ?? options.showBox,
  skeleton: saved.skeleton ?? false,
  mirror: saved.mirror ?? options.mirror,
  autoRotate: saved.autoRotate ?? true,
  dim: saved.dim ?? 0.88,
  quality: options.quality,
};
const persist = () => {
  try {
    const { quality: _q, ...rest } = settings;
    localStorage.setItem(STORE, JSON.stringify(rest));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
};

function apply<K extends keyof HudSettings>(key: K, value: HudSettings[K]): void {
  settings[key] = value;
  switch (key) {
    case 'glow': app.setGlow(value as boolean); break;
    case 'box': app.setBoxVisible(value as boolean); break;
    case 'skeleton': overlay.showSkeleton = value as boolean; break;
    case 'mirror': app.background.setMirror(value as boolean); break;
    case 'autoRotate': app.transform.autoRotate = value as boolean; break;
    case 'dim': app.background.uniforms.uDim.value = value; break;
    case 'quality': {
      const url = new URL(location.href);
      url.searchParams.set('q', value as string);
      location.href = url.toString();
      return;
    }
  }
  hud.setSetting(key, value);
  persist();
}

// ---- Camera session -------------------------------------------------------
async function startCamera(): Promise<void> {
  hud.setStartBusy(true, 'Starting camera…');
  hud.setStatus('loading', 'Camera');
  try {
    await tracker.start((s) => {
      if (s === 'model') {
        hud.setStartBusy(true, 'Loading hand model…');
        hud.setStatus('loading', 'Loading model');
      }
    });
    app.background.setVideo(tracker.video);
    hud.setCameraOn(true);
    hud.setGuideMode('hands');
    hud.hideStart();
    leaveIntro();
    hud.toast('Show your hands to the camera');
  } catch (err) {
    console.error(err);
    hud.setStartBusy(false);
    hud.setStatus('mouse', 'Mouse');
    hud.setCameraOn(false);
    const msg = err instanceof Error && err.name === 'NotAllowedError' ? 'Camera permission was blocked' : 'Could not start the camera';
    hud.toast(`${msg}. Using mouse controls.`, 3200);
    hud.hideStart();
    leaveIntro();
  }
}

function stopCamera(): void {
  tracker.stop();
  slots.reset();
  hands.reset();
  app.background.setVideo(null);
  hud.setCameraOn(false);
  hud.setGuideMode('mouse');
  hud.setStatus('mouse', 'Mouse');
}

// ---- Recording ------------------------------------------------------------
async function toggleRecord(): Promise<void> {
  if (!Recorder.supported) {
    hud.toast('Recording is not supported in this browser');
    return;
  }
  if (recorder.recording) {
    const name = await recorder.stop();
    hud.setRecording(false);
    hud.toast(`Saved ${name}`, 2600);
  } else {
    recorder.start();
    hud.setRecording(true);
  }
}

// ---- Import ---------------------------------------------------------------
async function importFiles(files: FileList): Promise<void> {
  for (const file of Array.from(files)) {
    hud.toast(`Reading ${file.name}…`, 10_000);
    try {
      const cloud = await importFile(file, app.particles.capacity);
      const index = app.library.addImported(cloud);
      app.director.show(index);
      hud.toast(`Imported ${cloud.name}`);
    } catch (err) {
      console.error(err);
      hud.toast(err instanceof Error ? err.message : 'Import failed', 3600);
    }
  }
}

// ---- HUD ------------------------------------------------------------------
const hud = new Hud(
  document.body,
  {
    onStartCamera: () => void startCamera(),
    onStartMouse: () => {
      hud.hideStart();
      leaveIntro();
      hud.setGuideMode('mouse');
    },
    onToggleCamera: () => (tracker.running ? stopCamera() : void startCamera()),
    onToggleRecord: () => void toggleRecord(),
    onImport: (files) => void importFiles(files),
    onSelectShape: (i) => app.director.show(i),
    onSetting: (k, v) => apply(k, v),
  },
  settings,
  options.debug,
);

// Slide the object right while the welcome copy occupies the left side.
const intro = () => window.innerWidth > 720;
if (intro()) app.transform.targetPosition.x = 1.15;
const leaveIntro = () => {
  if (app.transform.targetPosition.x === 1.15) app.transform.targetPosition.x = 0;
};

const names = () => app.library.entries.map((e) => e.name);
app.library.onChange(() => hud.setShapes(names(), app.director.index));
app.director.onChange((i) => hud.setActive(i));
hud.setShapes(names(), 0);

hands.on((e) => {
  const name = app.library.entries[app.director.index]?.name ?? '';
  if (e === 'next' || e === 'prev') hud.toast(name);
  if (e === 'reset') hud.toast('Reset');
});

// Apply persisted settings.
for (const key of ['glow', 'box', 'skeleton', 'mirror', 'autoRotate', 'dim'] as const) apply(key, settings[key] as never);

// ---- Keyboard -------------------------------------------------------------
let fHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright' || k === ' ') {
    e.preventDefault();
    app.director.next();
  } else if (k === 'arrowleft') app.director.prev();
  else if (/^[1-9]$/.test(k)) {
    const i = parseInt(k, 10) - 1;
    if (i < app.library.length) app.director.show(i);
  } else if (k === 'b') apply('box', !settings.box);
  else if (k === 'g') apply('glow', !settings.glow);
  else if (k === 'h') apply('skeleton', !settings.skeleton);
  else if (k === 'm') apply('mirror', !settings.mirror);
  else if (k === 'r') void toggleRecord();
  else if (k === 'c') tracker.running ? stopCamera() : void startCamera();
  else if (k === '0') app.transform.reset();
  else if (k === 'escape') hud.togglePanel(false);
  else if (k === 'f' && !fHeld) {
    fHeld = true;
    app.director.collapseTarget = 1;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'f' && fHeld) {
    fHeld = false;
    app.director.collapseTarget = 0;
    if (app.director.collapse > 0.35) app.director.next();
  }
});

// ---- Per-frame glue -------------------------------------------------------
let tracked: TrackedHand[] = [];
const corners: THREE.Vector3[] = [];
let statusTimer = 0;

const resizeOverlay = () => overlay.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 2));
window.addEventListener('resize', resizeOverlay);
resizeOverlay();

// Debug hook: inject synthetic hands (viewport-space landmarks) for testing.
type FakeHands = { landmarks: { x: number; y: number; z: number }[]; model?: { name: string; score: number } }[];
const fake = () => (options.debug ? (window as unknown as { __fakeHands?: FakeHands }).__fakeHands : undefined);

app.hooks.push((dt, time) => {
  const now = performance.now();
  const injected = fake();
  if (injected) {
    const raw = injected.map((f) => ({ landmarks: f.landmarks, model: f.model ?? null, handedness: 'Right' }));
    tracked = slots.update(raw, now, dt, (x, y) => [x, y], window.innerWidth / window.innerHeight);
    hands.update(tracked, time, dt);
    app.held = app.held || hands.held;
    app.pointer.hoverTouch = tracked.length === 0;
  } else if (tracker.running) {
    const raw = tracker.detect(now);
    const v = tracker.video;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    tracked = slots.update(raw, now, dt, (x, y) => videoToViewport(x, y, v.videoWidth, v.videoHeight, vw, vh, settings.mirror), tracker.aspect);
    hands.update(tracked, time, dt);
    app.held = app.held || hands.held;
    app.pointer.hoverTouch = tracked.length === 0;
  } else {
    tracked = [];
    app.pointer.hoverTouch = true;
  }

  // Box caption follows the gizmo's top-left corner on screen.
  const entry = app.library.entries[app.director.index];
  app.box.cornersWorld(corners);
  const screen = corners.map((c) => worldToViewport(app.camera, c, new THREE.Vector2()));
  const pts = `${Math.round(app.particles.capacity / 1000)}k pts`;
  overlay.draw(tracked, hands.activity, {
    corners: screen,
    label: `/${(entry?.name ?? '').toLowerCase()}  ${pts}`,
    opacity: app.box.getOpacity() * (settings.box ? 1 : 0),
  });

  hud.setProgress(app.director.index, app.director.busy ? app.director.progress : 1);

  statusTimer -= dt;
  if (statusTimer <= 0) {
    statusTimer = 0.25;
    if (recorder.recording) {
      const s = Math.floor(recorder.elapsed);
      hud.setStatus('recording', `REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    } else if (tracker.running) {
      hud.setStatus('hands', tracked.length ? `${tracked.length} hand${tracked.length > 1 ? 's' : ''}` : 'No hands');
    } else if (tracker.status !== 'camera' && tracker.status !== 'model') {
      hud.setStatus('mouse', 'Mouse');
    }
    if (options.debug) {
      hud.debug(
        [
          `fps ${app.fps.toFixed(0)}`,
          `points ${QUALITY_POINTS[options.quality].toLocaleString()}`,
          `inference ${tracker.inferenceMs.toFixed(1)} ms`,
          ...tracked.map((t) => `hand ${t.id} ${t.gesture} pinch ${t.features.pinch.toFixed(2)} ext ${t.features.extension.map((x) => x.toFixed(2)).join(' ')}`),
        ].join('\n'),
      );
    }
  }
});

void app.start();
if (options.debug) Object.assign(window as object, { app, hands, tracker, hud });
