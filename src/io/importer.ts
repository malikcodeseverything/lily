import type { PointCloud } from '../shapes/types';
import { sampleGltf } from './gltf';
import { parsePly } from './ply';
import { rawToCloud } from './rawCloud';
import { parseSplat } from './splat';

export const ACCEPTED = '.ply,.splat,.glb,.gltf';

/** Load a user file into a cloud the renderer can morph into. */
export async function importFile(file: File, capacity: number): Promise<PointCloud> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Import';
  const buf = await file.arrayBuffer();
  switch (ext) {
    case 'ply': {
      const raw = parsePly(buf);
      // Splats trained from COLMAP scenes are usually upside down.
      return rawToCloud(raw, name, capacity, raw.isSplat ? [Math.PI, 0, 0] : [0, 0, 0]);
    }
    case 'splat':
      return rawToCloud(parseSplat(buf), name, capacity, [Math.PI, 0, 0]);
    case 'glb':
    case 'gltf':
      return rawToCloud(await sampleGltf(buf, Math.round(capacity * 1.2)), name, capacity);
    default:
      throw new Error(`Unsupported file type .${ext}. Try ${ACCEPTED}.`);
  }
}
