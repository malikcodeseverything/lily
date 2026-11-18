import { BUILTIN_SHAPES } from './registry';
import type { PointCloud } from './types';
import type { BuildRequest, BuildResponse } from './worker';

export interface LibraryEntry {
  id: string;
  name: string;
  kind: 'builtin' | 'imported';
  cloud?: PointCloud;
  pending?: Promise<PointCloud>;
}

/**
 * The carousel of objects. Built-in shapes are generated lazily in a Web
 * Worker and cached; imported scans are added already resampled.
 */
export class ShapeLibrary {
  readonly entries: LibraryEntry[];
  private worker: Worker | null = null;
  private reqId = 0;
  private waiting = new Map<number, { resolve: (c: PointCloud) => void; reject: (e: Error) => void }>();
  private listeners = new Set<() => void>();

  constructor(readonly capacity: number) {
    this.entries = BUILTIN_SHAPES.map((s) => ({ id: s.id, name: s.name, kind: 'builtin' as const }));
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<BuildResponse>) => {
        const job = this.waiting.get(e.data.reqId);
        if (!job) return;
        this.waiting.delete(e.data.reqId);
        if (e.data.cloud) job.resolve(e.data.cloud);
        else job.reject(new Error(e.data.error ?? 'build failed'));
      };
    } catch {
      this.worker = null;
    }
  }

  get length(): number {
    return this.entries.length;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  load(index: number): Promise<PointCloud> {
    const entry = this.entries[index];
    if (entry.cloud) return Promise.resolve(entry.cloud);
    if (entry.pending) return entry.pending;
    entry.pending = this.build(entry.id).then((cloud) => {
      entry.cloud = cloud;
      entry.pending = undefined;
      return cloud;
    });
    return entry.pending;
  }

  /** Build everything in the background, one shape at a time. */
  async prewarm(): Promise<void> {
    for (let i = 0; i < this.entries.length; i++) {
      try {
        await this.load(i);
      } catch (err) {
        console.warn('prewarm failed for', this.entries[i].id, err);
      }
    }
  }

  addImported(cloud: PointCloud): number {
    this.entries.push({ id: `import-${this.entries.length}`, name: cloud.name, kind: 'imported', cloud });
    this.listeners.forEach((fn) => fn());
    return this.entries.length - 1;
  }

  private build(id: string): Promise<PointCloud> {
    if (!this.worker) {
      const def = BUILTIN_SHAPES.find((s) => s.id === id);
      if (!def) return Promise.reject(new Error(`Unknown shape ${id}`));
      return new Promise((resolve) => setTimeout(() => resolve(def.build(this.capacity)), 0));
    }
    const reqId = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.waiting.set(reqId, { resolve, reject });
      this.worker!.postMessage({ reqId, id, count: this.capacity } satisfies BuildRequest);
    });
  }
}
