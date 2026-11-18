import type { RawCloud } from './rawCloud';

const SH_C0 = 0.28209479177387814;

type PlyType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'float' | 'double';
const SIZES: Record<PlyType, number> = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };
const ALIASES: Record<string, PlyType> = {
  int8: 'char', uint8: 'uchar', int16: 'short', uint16: 'ushort', int32: 'int', uint32: 'uint', float32: 'float', float64: 'double',
};

interface Header {
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  vertexCount: number;
  props: { name: string; type: PlyType }[];
  /** Byte offset where the body starts. */
  bodyStart: number;
}

export function parsePlyHeader(buf: ArrayBuffer): Header {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64 * 1024));
  const text = new TextDecoder().decode(bytes);
  const end = text.indexOf('end_header');
  if (!text.startsWith('ply') || end < 0) throw new Error('Not a PLY file.');
  const lines = text.slice(0, end).split(/\r?\n/);
  let format: Header['format'] = 'ascii';
  let vertexCount = 0;
  let inVertex = false;
  const props: Header['props'] = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1] as Header['format'];
    else if (t[0] === 'element') {
      inVertex = t[1] === 'vertex';
      if (inVertex) vertexCount = parseInt(t[2], 10);
    } else if (t[0] === 'property' && inVertex) {
      if (t[1] === 'list') throw new Error('List properties on vertices are not supported.');
      const type = (ALIASES[t[1]] ?? t[1]) as PlyType;
      if (!(type in SIZES)) throw new Error(`Unknown PLY type ${t[1]}`);
      props.push({ name: t[2], type });
    }
  }
  // Body starts after "end_header\n" (count bytes, not characters).
  const headerBytes = new TextEncoder().encode(text.slice(0, end + 'end_header'.length));
  let bodyStart = headerBytes.length;
  const all = new Uint8Array(buf);
  if (all[bodyStart] === 13) bodyStart++;
  if (all[bodyStart] === 10) bodyStart++;
  return { format, vertexCount, props, bodyStart };
}

/**
 * Reads point clouds and 3D Gaussian Splatting PLYs. For splats, color
 * comes from the zeroth spherical harmonic (f_dc_*), opacity is a logit and
 * scales are log-space, all of which are decoded here.
 */
export function parsePly(buf: ArrayBuffer): RawCloud & { isSplat: boolean } {
  const h = parsePlyHeader(buf);
  const n = h.vertexCount;
  const idx = (name: string) => h.props.findIndex((p) => p.name === name);
  const values = readVertices(buf, h);
  const get = (i: number, p: number) => values[i * h.props.length + p];

  const ix = idx('x'), iy = idx('y'), iz = idx('z');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('PLY has no x/y/z properties.');
  const dc = [idx('f_dc_0'), idx('f_dc_1'), idx('f_dc_2')];
  const isSplat = dc.every((i) => i >= 0);
  const rgb = [idx('red'), idx('green'), idx('blue')];
  const diffuse = [idx('diffuse_red'), idx('diffuse_green'), idx('diffuse_blue')];
  const nrm = [idx('nx'), idx('ny'), idx('nz')];
  const opacityI = idx('opacity');
  const scaleI = [idx('scale_0'), idx('scale_1'), idx('scale_2')];

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const hasNormals = nrm.every((i) => i >= 0) && !isSplat;
  const normals = hasNormals ? new Float32Array(n * 3) : undefined;
  const opacity = isSplat && opacityI >= 0 ? new Float32Array(n) : undefined;
  const sizes = isSplat && scaleI.every((i) => i >= 0) ? new Float32Array(n) : undefined;
  const colorIdx = rgb.every((i) => i >= 0) ? rgb : diffuse.every((i) => i >= 0) ? diffuse : null;
  const colorScale = colorIdx && h.props[colorIdx[0]].type === 'float' ? 1 : 1 / 255;

  for (let i = 0; i < n; i++) {
    positions[i * 3] = get(i, ix);
    positions[i * 3 + 1] = get(i, iy);
    positions[i * 3 + 2] = get(i, iz);
    for (let k = 0; k < 3; k++) {
      let c = 0.8;
      if (isSplat) c = 0.5 + SH_C0 * get(i, dc[k]);
      else if (colorIdx) c = get(i, colorIdx[k]) * colorScale;
      colors[i * 3 + k] = Math.min(1, Math.max(0, c));
      if (normals) normals[i * 3 + k] = get(i, nrm[k]);
    }
    if (opacity) opacity[i] = 1 / (1 + Math.exp(-get(i, opacityI)));
    if (sizes) sizes[i] = Math.exp((get(i, scaleI[0]) + get(i, scaleI[1]) + get(i, scaleI[2])) / 3);
  }
  return { count: n, positions, colors, normals, opacity, sizes, isSplat };
}

function readVertices(buf: ArrayBuffer, h: Header): Float64Array {
  const n = h.vertexCount;
  const P = h.props.length;
  const out = new Float64Array(n * P);
  if (h.format === 'ascii') {
    const text = new TextDecoder().decode(new Uint8Array(buf, h.bodyStart));
    const lines = text.split(/\r?\n/);
    let row = 0;
    for (const line of lines) {
      if (row >= n) break;
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/\s+/);
      for (let p = 0; p < P; p++) out[row * P + p] = parseFloat(parts[p]);
      row++;
    }
    return out;
  }
  const little = h.format === 'binary_little_endian';
  const view = new DataView(buf, h.bodyStart);
  const stride = h.props.reduce((s, p) => s + SIZES[p.type], 0);
  if (stride * n > view.byteLength) throw new Error('PLY body is shorter than the header claims.');
  const readers = h.props.map((p) => reader(p.type, little));
  const offsets: number[] = [];
  let o = 0;
  for (const p of h.props) {
    offsets.push(o);
    o += SIZES[p.type];
  }
  for (let i = 0; i < n; i++) {
    const base = i * stride;
    for (let p = 0; p < P; p++) out[i * P + p] = readers[p](view, base + offsets[p]);
  }
  return out;
}

function reader(type: PlyType, le: boolean): (v: DataView, o: number) => number {
  switch (type) {
    case 'char': return (v, o) => v.getInt8(o);
    case 'uchar': return (v, o) => v.getUint8(o);
    case 'short': return (v, o) => v.getInt16(o, le);
    case 'ushort': return (v, o) => v.getUint16(o, le);
    case 'int': return (v, o) => v.getInt32(o, le);
    case 'uint': return (v, o) => v.getUint32(o, le);
    case 'float': return (v, o) => v.getFloat32(o, le);
    case 'double': return (v, o) => v.getFloat64(o, le);
  }
}
