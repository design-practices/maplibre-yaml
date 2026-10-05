/**
 * @file The packed vertex format of the extrusions backend
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * 20 bytes per vertex. Vertex fetch, not shading, bounded the first
 * graduated build on an integrated GPU: a 44-byte float layout ran the
 * geometry path ~3x slower per pass than the U12 spike's 28-byte one, and
 * the depth prepass stopped paying for itself. Packed, the depth prepass
 * fetches ONE 8-byte attribute:
 *
 * | bytes | attribute | type | meaning |
 * |---|---|---|---|
 * | 0–7 | `a_posz` | uint16 × 4 | x, y (tile units × `posScale`, ~1/15 unit at extent 4096), this vertex's height at the tile's zoom and zoom + 1 (metres × 16) |
 * | 8–11 | `a_uv` | unorm16 × 2 | u along the whole wall, v up the wall |
 * | 12–15 | `a_fh` | half × 2 | the face's height (wall height) at zoom and zoom + 1, metres |
 * | 16–17 | `a_nrm` | snorm8 × 2 | outward normal (north-up); (0, 0) marks a roof |
 * | 18–19 | `a_facew` | half | the whole wall's length, metres |
 *
 * Heights quantize to 1/16 m up to 4096 m; wall lengths to half precision
 * (0.5 m at 1 km).
 */

export const VERTEX_BYTES = 20;
export const VB = { posz: 0, uv: 8, fh: 12, nrm: 16, facew: 18 } as const;
/** Height units per metre in `a_posz`. */
export const Z_SCALE = 16;

/** Position units per tile unit for an extent (positions span [0, extent]). */
export function posScaleFor(extent: number): number {
  return Math.max(1, Math.floor(65535 / extent));
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float → IEEE half bits (round to nearest; clamps to ±65504). */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp >= 31) return sign | 0x7bff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  const half = sign | (exp << 10) | (mant >> 13);
  return (mant & 0x1000) !== 0 ? half + 1 : half;
}

/** IEEE half bits → float. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

/** One vertex, unpacked (tests, seams, debugging). */
export interface Vertex {
  x: number;
  y: number;
  /** This vertex's height at the tile's zoom and zoom + 1. */
  z0: number;
  z1: number;
  u: number;
  v: number;
  /** Face (wall) height at zoom and zoom + 1. */
  fh0: number;
  fh1: number;
  nx: number;
  ny: number;
  facew: number;
  isRoof: boolean;
}

/**
 * Floats per vertex in the builder's staging layout: x, y, height lo/hi,
 * base lo/hi, u, v, normal x, normal y, wall length.
 */
export const STAGING = 11;

const quantZ = (m: number) => Math.min(65535, Math.max(0, Math.round(m * Z_SCALE)));

/** Pack staging floats into the GPU layout. */
export function packVertices(staging: ArrayLike<number>, posScale: number): Uint8Array {
  const count = staging.length / STAGING;
  const out = new Uint8Array(count * VERTEX_BYTES);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    const s = i * STAGING, o = i * VERTEX_BYTES;
    const h0 = staging[s + 2]!, h1 = staging[s + 3]!, b0 = staging[s + 4]!, b1 = staging[s + 5]!;
    const v = staging[s + 7]!, nx = staging[s + 8]!, ny = staging[s + 9]!;
    const roof = nx === 0 && ny === 0;
    const top = roof || v > 0.5;
    dv.setUint16(o + VB.posz, Math.round(staging[s]! * posScale), true);
    dv.setUint16(o + VB.posz + 2, Math.round(staging[s + 1]! * posScale), true);
    dv.setUint16(o + VB.posz + 4, quantZ(top ? h0 : b0), true);
    dv.setUint16(o + VB.posz + 6, quantZ(top ? h1 : b1), true);
    writeUv(dv, o, staging[s + 6]!, v);
    dv.setUint16(o + VB.fh, toHalf(roof ? 0 : Math.max(0, h0) - Math.max(0, b0)), true);
    dv.setUint16(o + VB.fh + 2, toHalf(roof ? 0 : Math.max(0, h1) - Math.max(0, b1)), true);
    dv.setInt8(o + VB.nrm, Math.round(nx * 127));
    dv.setInt8(o + VB.nrm + 1, Math.round(ny * 127));
    dv.setUint16(o + VB.facew, toHalf(staging[s + 10]!), true);
  }
  return out;
}

/** Write u, v (clamped to [0, 1]) at a vertex's byte offset. */
export function writeUv(dv: DataView, vertexByte: number, u: number, v: number): void {
  dv.setUint16(vertexByte + VB.uv, Math.round(Math.min(1, Math.max(0, u)) * 65535), true);
  dv.setUint16(vertexByte + VB.uv + 2, Math.round(Math.min(1, Math.max(0, v)) * 65535), true);
}

/** Write the wall length at a vertex's byte offset. */
export function writeFacew(dv: DataView, vertexByte: number, metres: number): void {
  dv.setUint16(vertexByte + VB.facew, toHalf(metres), true);
}

/** Read one vertex back. */
export function readVertex(bytes: Uint8Array, i: number, posScale: number): Vertex {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = i * VERTEX_BYTES;
  const nx = Math.max(-1, dv.getInt8(o + VB.nrm) / 127);
  const ny = Math.max(-1, dv.getInt8(o + VB.nrm + 1) / 127);
  return {
    x: dv.getUint16(o + VB.posz, true) / posScale,
    y: dv.getUint16(o + VB.posz + 2, true) / posScale,
    z0: dv.getUint16(o + VB.posz + 4, true) / Z_SCALE,
    z1: dv.getUint16(o + VB.posz + 6, true) / Z_SCALE,
    u: dv.getUint16(o + VB.uv, true) / 65535,
    v: dv.getUint16(o + VB.uv + 2, true) / 65535,
    fh0: fromHalf(dv.getUint16(o + VB.fh, true)),
    fh1: fromHalf(dv.getUint16(o + VB.fh + 2, true)),
    nx,
    ny,
    facew: fromHalf(dv.getUint16(o + VB.facew, true)),
    isRoof: nx === 0 && ny === 0,
  };
}
