import { ICONS } from './icons';
import { STYLES, type Quality } from '../config';

export interface HudSettings {
  glow: boolean;
  box: boolean;
  skeleton: boolean;
  mirror: boolean;
  autoRotate: boolean;
  dim: number;
  quality: Quality;
}

export interface HudCallbacks {
  onStartCamera(): void;
  onStartMouse(): void;
  onToggleCamera(): void;
  /** Start in the given mode, or stop if already recording (mode omitted). */
  onToggleRecord(mode?: 'clean' | 'full'): void;
  onImport(files: FileList): void;
  onSelectShape(index: number): void;
  onSetting<K extends keyof HudSettings>(key: K, value: HudSettings[K]): void;
  onStyle(index: number): void;
}

export type StatusMode = 'mouse' | 'loading' | 'hands' | 'recording';

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** All DOM chrome around the stage. Pure view: state lives in main.ts. */
export class Hud {
  readonly root: HTMLElement;
  private start: HTMLElement;
  private carousel: HTMLElement;
  private status: HTMLElement;
  private statusLabel: HTMLElement;
  private panel: HTMLElement;
  private recMenu!: HTMLElement;
  private isRecording = false;
  private guide: HTMLElement;
  private toastEl: HTMLElement;
  private drop: HTMLElement;
  private debugEl: HTMLElement | null = null;
  private fileInput: HTMLInputElement;
  private toastTimer = 0;
  private chips: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly cb: HudCallbacks,
    private settings: HudSettings,
    debug: boolean,
  ) {
    this.root = h(`<div class="hud"></div>`);
    parent.appendChild(this.root);

    this.root.appendChild(
      h(`<div class="brand"><span class="word">lily<i>.</i></span><span class="tag mono">hand-tracked point clouds</span></div>`),
    );

    const top = h(`<div class="topbar">
      <div class="status glass mono" data-mode="mouse"><span class="dot"></span><span class="label">Mouse</span></div>
      <button class="icon-btn glass" data-act="camera" aria-pressed="false" title="Camera (C)">${ICONS.camera}</button>
      <button class="icon-btn glass rec" data-act="record" aria-pressed="false" aria-haspopup="menu" title="Record">${ICONS.record}</button>
      <button class="icon-btn glass" data-act="import" title="Import .ply / .splat / .glb">${ICONS.upload}</button>
      <button class="icon-btn glass" data-act="settings" aria-pressed="false" title="Settings">${ICONS.sliders}</button>
    </div>`);
    this.root.appendChild(top);
    this.status = top.querySelector('.status')!;
    this.statusLabel = top.querySelector('.status .label')!;
    top.querySelector('[data-act="camera"]')!.addEventListener('click', () => cb.onToggleCamera());
    top.querySelector('[data-act="record"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isRecording) cb.onToggleRecord();
      else this.toggleRecMenu();
    });
    top.querySelector('[data-act="import"]')!.addEventListener('click', () => this.fileInput.click());
    top.querySelector('[data-act="settings"]')!.addEventListener('click', () => this.togglePanel());

    this.fileInput = h(`<input type="file" accept=".ply,.splat,.glb,.gltf" hidden />`) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) cb.onImport(this.fileInput.files);
      this.fileInput.value = '';
    });
    this.root.appendChild(this.fileInput);

    this.recMenu = h(`<div class="rec-menu glass" role="menu" hidden>
      <button role="menuitem" data-mode="clean"><b>Clean</b><span>Camera and particles only. Best for reels.</span><kbd>R</kbd></button>
      <button role="menuitem" data-mode="full"><b>Full screen</b><span>Everything you see, interface included.</span><kbd>⇧R</kbd></button>
    </div>`);
    this.recMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.toggleRecMenu(false);
        cb.onToggleRecord(b.dataset.mode as 'clean' | 'full');
      }),
    );
    this.root.appendChild(this.recMenu);
    window.addEventListener('click', (e) => {
      if (!this.recMenu.hidden && !this.recMenu.contains(e.target as Node)) this.toggleRecMenu(false);
    });

    this.panel = this.buildPanel();
    this.root.appendChild(this.panel);

    this.guide = h(`<section class="guide glass" data-mode="mouse" data-collapsed="false">
      <header class="mono"><span>Gestures</span><span class="hint">Hide</span></header>
      <ul>
        <li data-for="hands"><b>Pinch + drag</b><span>Turn the object</span></li>
        <li data-for="hands"><b>Two pinches</b><span>Move, scale and twist</span></li>
        <li data-for="hands"><b>Fist → open</b><span>Collapse it, then burst into the next one</span></li>
        <li data-for="hands"><b>Point</b><span>Brush the particles aside</span></li>
        <li data-for="hands"><b>Peace sign</b><span>Previous object</span></li>
        <li data-for="hands"><b>Thumbs up</b><span>Reset position and size</span></li>
        <li data-for="hands"><b>Swipe</b><span>Flick an open hand sideways to change object</span></li>
        <li data-for="hands"><b>Two palms</b><span>Pull your open hands apart to stretch it</span></li>
        <li data-for="hands"><b>Rock sign</b><span>Change render style</span></li>
        <li data-for="hands"><b>Thumbs down</b><span>Pause or resume the motion</span></li>
        <li data-for="mouse"><b>Drag</b><span>Turn the object (release to throw)</span></li>
        <li data-for="mouse"><b>Shift / right drag</b><span>Move it</span></li>
        <li data-for="mouse"><b>Scroll</b><span>Scale</span></li>
        <li data-for="mouse"><b>Hold F</b><span>Collapse, release to burst into the next</span></li>
        <li data-for="mouse"><b>← →  1-9</b><span>Switch objects</span></li>
        <li data-for="mouse"><b>Hold X</b><span>Stretch the object apart</span></li>
        <li data-for="mouse"><b>S · P</b><span>Render style · pause motion</span></li>
      </ul>
    </section>`);
    this.guide.querySelector('header')!.addEventListener('click', () => {
      const c = this.guide.dataset.collapsed === 'true';
      this.guide.dataset.collapsed = String(!c);
      this.guide.querySelector('.hint')!.textContent = c ? 'Hide' : 'Show';
    });
    this.root.appendChild(this.guide);

    this.carousel = h(`<nav class="carousel glass" aria-label="Objects"></nav>`);
    this.root.appendChild(this.carousel);

    this.toastEl = h(`<div class="toast glass mono" role="status" aria-live="polite"></div>`);
    this.root.appendChild(this.toastEl);

    this.drop = h(`<div class="drop"><div><strong>Drop to sculpt</strong><span class="mono">.ply · gaussian splat · .splat · .glb</span></div></div>`);
    document.body.appendChild(this.drop);
    this.bindDrop();

    if (debug) {
      this.debugEl = h(`<div class="debug mono"></div>`);
      this.root.appendChild(this.debugEl);
    }

    this.start = h(`<section class="start" aria-label="Welcome">
      <div class="inner">
        <div class="eyebrow mono">Real-time hand tracking · runs in your browser</div>
        <h1>Hold a <em>lily</em><br/>in mid-air.</h1>
        <p>Pinch the air to turn it. Close your fist to crush it into light, then open your hand and it blooms into something new. Seven sculptures made of glowing particles, running entirely in your browser.</p>
        <div class="actions">
          <button class="btn primary" data-act="start-camera">${ICONS.hand}<span>Enable camera</span></button>
          <button class="btn ghost" data-act="start-mouse">Explore with mouse</button>
        </div>
        <div class="problem" role="alert" hidden></div>
        <div class="fine mono">Video is processed on this device and never uploaded.</div>
      </div>
    </section>`);
    document.body.appendChild(this.start);
    this.root.classList.add('intro');
    this.start.querySelector('[data-act="start-camera"]')!.addEventListener('click', () => cb.onStartCamera());
    this.start.querySelector('[data-act="start-mouse"]')!.addEventListener('click', () => cb.onStartMouse());
  }

  private buildPanel(): HTMLElement {
    const s = this.settings;
    const p = h(`<div class="panel glass" hidden>
      <h3 class="mono">Display</h3>
      ${this.toggleRow('glow', 'Glow', 'G', s.glow)}
      ${this.toggleRow('box', 'Bounding box', 'B', s.box)}
      ${this.toggleRow('skeleton', 'Hand skeleton', 'H', s.skeleton)}
      ${this.toggleRow('mirror', 'Mirror camera', 'M', s.mirror)}
      ${this.toggleRow('autoRotate', 'Idle spin', '', s.autoRotate)}
      <div class="row"><label for="dim">Camera brightness</label><input id="dim" type="range" min="0.2" max="1.2" step="0.01" value="${s.dim}" /></div>
      <h3 class="mono">Style</h3>
      <div class="row"><div class="seg wide" data-key="style">
        ${STYLES.map((name, i) => `<button data-style="${i}" aria-pressed="${i === 0}">${name}</button>`).join('')}
      </div></div>
      <h3 class="mono">Particles</h3>
      <div class="row"><label>Density</label><div class="seg" data-key="quality">
        ${(['low', 'medium', 'high'] as Quality[]).map((q) => `<button data-q="${q}" aria-pressed="${q === s.quality}">${q}</button>`).join('')}
      </div></div>
    </div>`);
    p.querySelectorAll<HTMLButtonElement>('.toggle').forEach((t) =>
      t.addEventListener('click', () => {
        const key = t.dataset.key as keyof HudSettings;
        const value = t.getAttribute('aria-checked') !== 'true';
        this.setSetting(key, value as never);
        this.cb.onSetting(key, value as never);
      }),
    );
    p.querySelector<HTMLInputElement>('#dim')!.addEventListener('input', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      this.cb.onSetting('dim', v);
    });
    p.querySelectorAll<HTMLButtonElement>('.seg[data-key="quality"] button').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSetting('quality', b.dataset.q as Quality)),
    );
    p.querySelectorAll<HTMLButtonElement>('.seg[data-key="style"] button').forEach((b) =>
      b.addEventListener('click', () => this.cb.onStyle(parseInt(b.dataset.style!, 10))),
    );
    return p;
  }

  private toggleRow(key: keyof HudSettings, label: string, kbd: string, on: boolean): string {
    return `<div class="row"><label>${label}${kbd ? `<kbd>${kbd}</kbd>` : ''}</label>
      <button class="toggle" role="switch" data-key="${key}" aria-checked="${on}" aria-label="${label}"></button></div>`;
  }

  /** Reflect a setting changed elsewhere (e.g. a keyboard shortcut). */
  setSetting<K extends keyof HudSettings>(key: K, value: HudSettings[K]): void {
    this.settings[key] = value;
    const t = this.panel.querySelector(`.toggle[data-key="${key}"]`);
    if (t) t.setAttribute('aria-checked', String(value));
  }

  toggleRecMenu(force?: boolean): void {
    const open = force ?? this.recMenu.hidden;
    this.recMenu.hidden = !open;
    if (open) this.togglePanel(false);
  }

  setStyle(index: number): void {
    this.panel.querySelectorAll<HTMLButtonElement>('.seg[data-key="style"] button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.style === String(index))),
    );
  }

  togglePanel(force?: boolean): void {
    const open = force ?? this.panel.hidden;
    this.panel.hidden = !open;
    if (open && this.recMenu) this.recMenu.hidden = true;
    this.root.querySelector('[data-act="settings"]')!.setAttribute('aria-pressed', String(open));
  }

  setShapes(names: string[], active: number): void {
    this.carousel.innerHTML = '';
    this.chips = names.map((name, i) => {
      const c = h(`<button class="chip mono" aria-current="${i === active}"><span class="num">${String(i + 1).padStart(2, '0')}</span>${name}<span class="bar"></span></button>`);
      c.addEventListener('click', () => this.cb.onSelectShape(i));
      this.carousel.appendChild(c);
      return c;
    });
  }

  setActive(index: number): void {
    this.chips.forEach((c, i) => c.setAttribute('aria-current', String(i === index)));
    this.chips[index]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  /** Morph progress bar under the active chip (0..1, hidden at 1). */
  setProgress(index: number, p: number): void {
    const bar = this.chips[index]?.querySelector<HTMLElement>('.bar');
    if (bar) bar.style.transform = `scaleX(${p >= 0.999 ? 0 : p})`;
  }

  setStatus(mode: StatusMode, label: string): void {
    this.status.dataset.mode = mode;
    this.statusLabel.textContent = label;
  }

  setGuideMode(mode: 'hands' | 'mouse'): void {
    this.guide.dataset.mode = mode;
  }

  setCameraOn(on: boolean): void {
    const b = this.root.querySelector('[data-act="camera"]')!;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = on ? ICONS.camera : ICONS.cameraOff;
  }

  setRecording(on: boolean): void {
    this.isRecording = on;
    this.toggleRecMenu(false);
    const b = this.root.querySelector('[data-act="record"]')!;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = on ? ICONS.stop : ICONS.record;
  }

  setStartBusy(busy: boolean, text = 'Enable camera'): void {
    const b = this.start.querySelector<HTMLButtonElement>('[data-act="start-camera"]')!;
    b.disabled = busy;
    b.querySelector('span')!.textContent = text;
  }

  /** Show (or clear) a camera problem on the welcome screen. */
  showProblem(problem: { title: string; steps: string[]; code: string } | null): void {
    const el = this.start.querySelector<HTMLElement>('.problem')!;
    if (!problem) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '';
    const title = document.createElement('strong');
    title.textContent = problem.title;
    const list = document.createElement('ol');
    for (const step of problem.steps) {
      const li = document.createElement('li');
      li.textContent = step;
      list.appendChild(li);
    }
    const code = document.createElement('code');
    code.className = 'mono';
    code.textContent = problem.code;
    el.append(title, list, code);
    el.hidden = false;
    this.start.hidden = false;
    this.root.classList.add('intro');
  }

  hideStart(): void {
    this.start.hidden = true;
    this.root.classList.remove('intro');
  }

  get startVisible(): boolean {
    return !this.start.hidden;
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  debug(text: string): void {
    if (this.debugEl) this.debugEl.textContent = text;
  }

  private bindDrop(): void {
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      this.drop.classList.add('show');
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.drop.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      this.drop.classList.remove('show');
      if (e.dataTransfer?.files.length) this.cb.onImport(e.dataTransfer.files);
    });
  }
}
