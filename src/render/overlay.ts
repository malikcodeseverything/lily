import type * as THREE from 'three';
import type { HandActivity } from '../interaction/handController';
import type { TrackedHand } from '../tracking/handSlots';

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const LABELS: Record<string, string> = {
  rotate: 'PINCH · ROTATE',
  move: 'PINCH · MOVE / SCALE',
  charge: 'FIST · CHARGING',
  touch: 'POINT · TOUCH',
};

/**
 * Lightweight 2D layer over the WebGL canvas for things that should stay
 * crisp and stay out of recordings: hand cursors, gesture labels, the box
 * caption.
 */
export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  showSkeleton = false;
  showCursors = true;
  private dpr = 1;
  private w = 1;
  private h = 1;

  constructor(parent: HTMLElement) {
    this.canvas.className = 'overlay';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  draw(
    hands: TrackedHand[],
    activity: HandActivity[],
    box: { corners: THREE.Vector2[] | null; label: string; opacity: number },
  ): void {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (box.corners && box.opacity > 0.02) this.drawBoxLabel(box.corners, box.label, box.opacity);

    for (const hand of hands) {
      const act = activity.find((a) => a.id === hand.id);
      const P = (i: number) => [hand.points[i].x * w, hand.points[i].y * h] as const;

      if (this.showSkeleton) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of CONNECTIONS) {
          const [ax, ay] = P(a);
          const [bx, by] = P(b);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 21; i++) {
          const [x, y] = P(i);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!this.showCursors) continue;

      const [tx, ty] = P(4);
      const [ix, iy] = P(8);
      if (hand.gesture === 'pinch') {
        const mx = (tx + ix) / 2;
        const my = (ty + iy) / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ix, iy);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(mx, my, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(mx, my, 14, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Idle cursors on thumb and index tips.
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.25;
        for (const [x, y] of [[tx, ty], [ix, iy]]) {
          ctx.beginPath();
          ctx.arc(x, y, hand.gesture === 'point' ? 10 : 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Timed gestures draw a progress ring around the palm.
      const [px, py] = P(9);
      if (act && act.progress > 0.01) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = act.role === 'charge' ? '#ff4f7b' : '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 26, -Math.PI / 2, -Math.PI / 2 + act.progress * Math.PI * 2);
        ctx.stroke();
      }

      const label = act ? LABELS[act.role] ?? gestureLabel(hand.gesture) : gestureLabel(hand.gesture);
      if (label) {
        const [wx, wy] = P(0);
        this.tag(label, wx, wy + 22, 0.9);
      }
    }
  }

  private drawBoxLabel(corners: THREE.Vector2[], label: string, opacity: number): void {
    // Top-left-most corner on screen.
    let best = corners[0];
    for (const c of corners) if (c.y + c.x * 0.3 < best.y + best.x * 0.3) best = c;
    this.tag(label, best.x * this.w + 8, best.y * this.h - 12, opacity, 'left');
  }

  private tag(text: string, x: number, y: number, opacity: number, align: CanvasTextAlign = 'center'): void {
    const { ctx } = this;
    ctx.font = '500 10.5px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const m = ctx.measureText(text);
    const pad = 6;
    const bw = m.width + pad * 2;
    const bx = align === 'center' ? x - bw / 2 : x - pad;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = 'rgba(10,10,12,0.55)';
    ctx.beginPath();
    ctx.roundRect(bx, y - 9, bw, 18, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(text, x, y + 0.5);
    ctx.globalAlpha = 1;
  }
}

function gestureLabel(g: string): string {
  switch (g) {
    case 'open': return 'OPEN';
    case 'fist': return 'FIST';
    case 'victory': return 'PEACE · PREVIOUS';
    case 'thumbsUp': return 'THUMBS UP · RESET';
    case 'point': return 'POINT';
    default: return '';
  }
}
