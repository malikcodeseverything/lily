// Optional: download the gesture model so the app works fully offline.
// Without it the app loads the model from Google's CDN at runtime.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'mediapipe', 'gesture_recognizer.task');

const res = await fetch(URL_);
if (!res.ok) {
  console.error(`[fetch-models] ${res.status} ${res.statusText}`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
console.log(`[fetch-models] saved ${dest}`);
