import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { RawCloud } from './rawCloud';

/** Reads pixels out of a texture image so surface samples can be colored. */
class TextureReader {
  private data: ImageData | null = null;
  constructor(private readonly tex: THREE.Texture) {
    const img = tex.image as CanvasImageSource & { width: number; height: number };
    if (!img?.width) return;
    const c = document.createElement('canvas');
    c.width = Math.min(img.width, 2048);
    c.height = Math.min(img.height, 2048);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    this.data = ctx.getImageData(0, 0, c.width, c.height);
  }

  sample(uv: THREE.Vector2, out: THREE.Color): boolean {
    const d = this.data;
    if (!d) return false;
    const t = uv.clone();
    this.tex.transformUv(t);
    const x = Math.min(d.width - 1, Math.max(0, Math.floor(t.x * d.width)));
    const y = Math.min(d.height - 1, Math.max(0, Math.floor(t.y * d.height)));
    const i = (y * d.width + x) * 4;
    out.setRGB(d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255);
    return true;
  }
}

/**
 * Scatter points over every mesh in a glTF/GLB, in proportion to surface
 * area, coloring each from the base color texture, vertex colors or the
 * material color.
 */
export async function sampleGltf(buf: ArrayBuffer, budget: number): Promise<RawCloud> {
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (!meshes.length) throw new Error('No meshes found in this file.');

  const areas = meshes.map((m) => meshArea(m));
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const positions = new Float32Array(budget * 3);
  const colors = new Float32Array(budget * 3);
  const normals = new Float32Array(budget * 3);
  let n = 0;
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const col = new THREE.Color();
  const uv = new THREE.Vector2();

  meshes.forEach((mesh, mi) => {
    const want = Math.round((budget * areas[mi]) / total);
    if (want === 0) return;
    const sampler = new MeshSurfaceSampler(mesh).build();
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const reader = mat?.map ? new TextureReader(mat.map) : null;
    const base = mat?.color ?? new THREE.Color(0.8, 0.8, 0.8);
    const hasVertexColors = !!mesh.geometry.getAttribute('color');
    const hasUv = !!mesh.geometry.getAttribute('uv');
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < want && n < budget; i++) {
      sampler.sample(p, nrm, col, hasUv ? uv : undefined);
      p.applyMatrix4(mesh.matrixWorld);
      nrm.applyMatrix3(normalMatrix).normalize();
      const c = new THREE.Color().copy(base);
      if (hasVertexColors) c.multiply(col);
      if (reader && hasUv) {
        const t = new THREE.Color();
        if (reader.sample(uv, t)) c.multiply(t);
      }
      positions.set([p.x, p.y, p.z], n * 3);
      normals.set([nrm.x, nrm.y, nrm.z], n * 3);
      colors.set([c.r, c.g, c.b], n * 3);
      n++;
    }
  });
  return { count: n, positions: positions.subarray(0, n * 3), colors: colors.subarray(0, n * 3), normals: normals.subarray(0, n * 3) };
}

function meshArea(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const s = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
  const scale = Math.abs(s.x * s.y + s.y * s.z + s.z * s.x) / 3 || 1;
  let area = 0;
  const tris = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area * scale;
}
