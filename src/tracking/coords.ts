import { coverTransform } from '../render/background';

/**
 * Map a normalized video coordinate (as MediaPipe reports it, origin
 * top-left of the raw camera frame) to viewport coordinates, matching how
 * the background shader draws the video: optionally mirrored, then
 * cropped to cover the viewport.
 */
export function videoToViewport(
  x: number,
  y: number,
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  mirror: boolean,
): [number, number] {
  const c = coverTransform(videoW, videoH, viewW, viewH);
  // Background: videoUv = screenUv * scale + offset, with screen x mirrored
  // first. Invert that here.
  const sx = (x - c.offsetX) / c.scaleX;
  const sy = (y - c.offsetY) / c.scaleY;
  return [mirror ? 1 - sx : sx, sy];
}
