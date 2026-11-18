/// <reference lib="webworker" />
import { BUILTIN_SHAPES } from './registry';
import type { PointCloud } from './types';

export interface BuildRequest {
  reqId: number;
  id: string;
  count: number;
}
export interface BuildResponse {
  reqId: number;
  cloud?: PointCloud;
  error?: string;
}

// Generating 100k+ points takes a few hundred ms per shape. Doing it here
// keeps the render loop smooth while the carousel warms up.
self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { reqId, id, count } = e.data;
  const def = BUILTIN_SHAPES.find((s) => s.id === id);
  if (!def) {
    (self as unknown as Worker).postMessage({ reqId, error: `Unknown shape ${id}` } satisfies BuildResponse);
    return;
  }
  try {
    const cloud = def.build(count);
    const transfer = [cloud.positions.buffer, cloud.colors.buffer, cloud.normals.buffer, cloud.sizes.buffer, cloud.anim.buffer];
    (self as unknown as Worker).postMessage({ reqId, cloud } satisfies BuildResponse, transfer as Transferable[]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, error: String(err) } satisfies BuildResponse);
  }
};
