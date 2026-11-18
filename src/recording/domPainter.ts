/**
 * Paints a subtree of simple DOM (rounded boxes, text, inline SVG icons)
 * onto a 2D canvas so "full" recordings include the interface without a
 * screen-share prompt. It is deliberately small: it understands exactly
 * the CSS this app's HUD uses (solid/rgba backgrounds, borders, radii,
 * opacity, text with transforms) rather than trying to be a browser.
 */
export class DomPainter {
  private icons = new Map<string, HTMLImageElement>();

  paint(ctx: CanvasRenderingContext2D, roots: Element[], scale: number): void {
    ctx.save();
    ctx.scale(scale, scale);
    for (const root of roots) this.walk(ctx, root, 1);
    ctx.restore();
  }

  private walk(ctx: CanvasRenderingContext2D, el: Element, parentOpacity: number): void {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (el instanceof HTMLElement && el.hidden) return;
    const opacity = parentOpacity * parseFloat(style.opacity || '1');
    if (opacity < 0.01) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && !el.childElementCount) return;

    if (el instanceof SVGSVGElement) {
      this.drawSvg(ctx, el, rect, style.color, opacity);
      return;
    }

    ctx.globalAlpha = opacity;
    this.drawBox(ctx, rect, style);

    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) this.drawText(ctx, node as Text, style, opacity);
      else if (node.nodeType === Node.ELEMENT_NODE) this.walk(ctx, node as Element, opacity);
    }
    ctx.globalAlpha = 1;
  }

  private drawBox(ctx: CanvasRenderingContext2D, r: DOMRect, s: CSSStyleDeclaration): void {
    const bg = s.backgroundColor;
    const bw = parseFloat(s.borderTopWidth) || 0;
    const hasBg = !isTransparent(bg);
    const hasBorder = bw > 0 && !isTransparent(s.borderTopColor) && s.borderTopStyle !== 'none';
    if (!hasBg && !hasBorder) return;
    const radius = Math.min(parseFloat(s.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
    ctx.beginPath();
    ctx.roundRect(r.left, r.top, r.width, r.height, radius);
    if (hasBg) {
      ctx.fillStyle = bg;
      ctx.fill();
    }
    if (hasBorder) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = s.borderTopColor;
      ctx.beginPath();
      ctx.roundRect(r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw, Math.max(0, radius - bw / 2));
      ctx.stroke();
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, node: Text, s: CSSStyleDeclaration, opacity: number): void {
    const raw = node.data;
    if (!raw.trim()) return;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = s.color;
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
    const upper = s.textTransform === 'uppercase';
    const ascent = ctx.measureText('Hg').fontBoundingBoxAscent || parseFloat(s.fontSize) * 0.8;

    // Draw word by word at the positions the browser laid them out, which
    // handles wrapping and alignment for free.
    const range = document.createRange();
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const r = rects[0];
      const text = upper ? m[0].toUpperCase() : m[0];
      ctx.fillText(text, r.left, r.top + (r.height - (ascent + (ctx.measureText('Hg').fontBoundingBoxDescent || 0))) / 2 + ascent);
    }
  }

  private drawSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, r: DOMRect, color: string, opacity: number): void {
    const markup = svg.outerHTML.replace(/currentColor/g, color);
    let img = this.icons.get(markup);
    if (!img) {
      img = new Image();
      const withNs = markup.includes('xmlns') ? markup : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
      this.icons.set(markup, img);
    }
    if (img.complete && img.naturalWidth) {
      ctx.globalAlpha = opacity;
      ctx.drawImage(img, r.left, r.top, r.width, r.height);
      ctx.globalAlpha = 1;
    }
  }
}

function isTransparent(color: string): boolean {
  if (!color || color === 'transparent') return true;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length === 4 && parseFloat(parts[3]) === 0;
}
