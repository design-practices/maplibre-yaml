/**
 * @file Tile mesh builder for the extrusions backend (runs in the worker)
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * Graduated from the U12 spike's route 2 (ml-rzm). One mesh per MapLibre
 * tile, built from the raw vector-tile bytes MapLibre already loaded:
 *
 * - the static layer's own `filter`, `fill-extrusion-height` and
 *   `fill-extrusion-base` decide which features extrude and how far
 *   (expressions.ts) — any source schema, not just OpenMapTiles;
 * - geometry stays in tile coordinates and is clipped to the tile extent
 *   exactly: roofs by Sutherland–Hodgman, walls by Liang–Barsky on the
 *   ORIGINAL ring edges. Buffer geometry is deduplicated (each tile draws
 *   only its own square) and walls lying on the extent boundary are
 *   dropped, so tile seams carry no fake walls or outlines;
 * - a clipped wall keeps the texture coordinate of its unclipped edge.
 *   Where the vector-tile generator itself cut the edge (at the tile
 *   buffer), the true wall is longer than either tile knows: such walls are
 *   reported as {@link CutWall}s so the main thread can stitch them across
 *   tiles (seams.ts) — the tile-seam fix.
 *
 * Vertices are staged as 11 floats — x, y (tile units) · height lo/hi,
 * base lo/hi (metres) · u, v, normal x, normal y (north-up; (0, 0) = roof)
 * · wall length (metres) — and packed to 24 bytes for the GPU
 * (vertex-format.ts).
 */

import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import Pbf from "pbf";
import earcut from "earcut";
import { compileExtrusionValue, compileFilter, type CompiledNumber, type ZoomInterp } from "./expressions";
import { STAGING, packVertices, posScaleFor } from "./vertex-format";

/** Doubles per cut-wall record. */
export const CUT_STRIDE = 12;

const EARTH_CIRCUMFERENCE = 40075016.68557849;

/** What the worker needs to know about the static layer. */
export interface LayerExpressions {
  sourceLayer: string;
  filter?: unknown;
  height?: unknown;
  base?: unknown;
  /** Diagnostics prefix for expression errors, e.g. `layers.buildings`. */
  rootKey?: string;
}

/** One tile to build. */
export interface BuildInput extends LayerExpressions {
  raw: ArrayBuffer | Uint8Array;
  /** The tile's canonical coordinates (the bytes' own tile). */
  z: number;
  x: number;
  y: number;
  /** MapLibre's overscaled zoom for this tile: expressions evaluate here and at +1. */
  zoom: number;
}

/**
 * A wall whose edge the tile generator cut at the tile buffer. Packed as
 * {@link CUT_STRIDE} doubles: fid, first vertex index, cutA, cutB, then the
 * clipped endpoints (ax, ay, bx, by) and the original edge (oax, oay, obx,
 * oby), all in tile units.
 */
export interface CutWall {
  fid: number;
  vi: number;
  cutA: boolean;
  cutB: boolean;
  ax: number; ay: number; bx: number; by: number;
  oax: number; oay: number; obx: number; oby: number;
}

export interface MeshData {
  /** Packed vertices (vertex-format.ts, 24 bytes each). */
  vertices: Uint8Array;
  /** Position units per tile unit in `vertices`. */
  posScale: number;
  indices: Uint32Array;
  extent: number;
  features: number;
  droppedBoundaryWalls: number;
  /** Packed {@link CutWall} records. */
  cuts: Float64Array;
  interp: { height: ZoomInterp; base: ZoomInterp };
}

type Pt = { x: number; y: number };

/** Sutherland–Hodgman against [0, E]². The ring may be closed. */
function clipRing(ring: Pt[], E: number): number[] {
  let pts: number[] = [];
  const closed =
    ring.length > 1 &&
    ring[0]!.x === ring[ring.length - 1]!.x &&
    ring[0]!.y === ring[ring.length - 1]!.y;
  const n = ring.length - (closed ? 1 : 0);
  for (let i = 0; i < n; i++) pts.push(ring[i]!.x, ring[i]!.y);
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const axis = e < 2 ? 0 : 1;
    const lo = e % 2 === 0;
    const bound = lo ? 0 : E;
    const inside = (v: number) => (lo ? v >= 0 : v <= E);
    const out: number[] = [];
    const m = pts.length / 2;
    for (let i = 0; i < m; i++) {
      const ax = pts[i * 2]!, ay = pts[i * 2 + 1]!;
      const j = (i + 1) % m;
      const bx = pts[j * 2]!, by = pts[j * 2 + 1]!;
      const av = axis === 0 ? ax : ay, bv = axis === 0 ? bx : by;
      const ain = inside(av), bin = inside(bv);
      if (ain) out.push(ax, ay);
      if (ain !== bin) {
        const t = (bound - av) / (bv - av);
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    pts = out;
  }
  return pts.length >= 6 ? pts : [];
}

/** Liang–Barsky: clip a segment to [0, E]², returning [t0, t1] or null. */
function clipSeg(ax: number, ay: number, bx: number, by: number, E: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax, E - ax, ay, E - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return null;
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

const onSameBoundary = (ax: number, ay: number, bx: number, by: number, E: number) => {
  const eps = 1e-6;
  return (
    (Math.abs(ax) < eps && Math.abs(bx) < eps) ||
    (Math.abs(ax - E) < eps && Math.abs(bx - E) < eps) ||
    (Math.abs(ay) < eps && Math.abs(by) < eps) ||
    (Math.abs(ay - E) < eps && Math.abs(by - E) < eps)
  );
};

/** Metres per tile unit at a tile's centre latitude. */
export function metresPerTileUnit(z: number, y: number, extent: number): number {
  const n = 2 ** z;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return (EARTH_CIRCUMFERENCE * Math.cos(lat)) / (n * extent);
}

/** Compiled expressions, cached per layer description. */
const compiledCache = new Map<string, { filter: (z: number, f: unknown) => boolean; height: CompiledNumber; base: CompiledNumber }>();

function compiled(input: LayerExpressions) {
  const key = JSON.stringify([input.filter ?? null, input.height ?? null, input.base ?? null]);
  let c = compiledCache.get(key);
  if (!c) {
    const root = input.rootKey ?? "layer";
    c = {
      filter: compileFilter(input.filter, `${root}.filter`),
      height: compileExtrusionValue(input.height, `${root}.paint.fill-extrusion-height`),
      base: compileExtrusionValue(input.base, `${root}.paint.fill-extrusion-base`),
    };
    if (compiledCache.size > 32) compiledCache.clear();
    compiledCache.set(key, c);
  }
  return c;
}

/**
 * Decode one tile's source layer and build its extrusion mesh, or null when
 * nothing extrudes.
 */
export function buildTileMesh(input: BuildInput): MeshData | null {
  const bytes = input.raw instanceof Uint8Array ? input.raw : new Uint8Array(input.raw);
  const vt = new VectorTile(new Pbf(bytes));
  const layer = vt.layers[input.sourceLayer];
  if (!layer) return null;
  const { filter, height, base } = compiled(input);
  const E = layer.extent;
  const mpu = metresPerTileUnit(input.z, input.y, E);
  const z0 = input.zoom, z1 = input.zoom + 1;

  // The tile generator's clip lines: a vertex outside the extent that sits
  // on the layer's outermost coordinate on that side was put there by
  // clipping (at the tile buffer) — the wall it ends continues beyond.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const feats: Array<{ fid: number | undefined; polys: Pt[][][]; h0: number; h1: number; b0: number; b1: number }> = [];
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 3) continue;
    if (!filter(z0, feat)) continue;
    const h0 = height.evaluate(z0, feat);
    const h1 = height.interp.zoomDependent ? height.evaluate(z1, feat) : h0;
    const b0 = base.evaluate(z0, feat);
    const b1 = base.interp.zoomDependent ? base.evaluate(z1, feat) : b0;
    const rings = feat.loadGeometry() as Pt[][];
    for (const ring of rings) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    feats.push({
      fid: typeof feat.id === "number" ? feat.id : undefined,
      polys: classifyRings(rings as never) as unknown as Pt[][][],
      h0, h1, b0, b1,
    });
  }
  const isCut = (p: Pt) =>
    (minX < 0 && p.x === minX) ||
    (maxX > E && p.x === maxX) ||
    (minY < 0 && p.y === minY) ||
    (maxY > E && p.y === maxY);

  const v: number[] = [];
  const idx: number[] = [];
  const cuts: number[] = [];
  let dropped = 0;
  const vert = (x: number, y: number, hb: [number, number, number, number], u: number, w: number, nx: number, ny: number, facew: number) => {
    v.push(x, y, hb[0], hb[1], hb[2], hb[3], u, w, nx, ny, facew);
    return v.length / STAGING - 1;
  };

  for (const { fid, polys, h0, h1, b0, b1 } of feats) {
    const hb: [number, number, number, number] = [h0, h1, b0, b1];
    for (const poly of polys) {
      // The outer ring's signed area (tile coords, y down) fixes which edge
      // normal points out of the solid, for the outer ring and its holes.
      const outer = poly[0]!;
      let area = 0;
      for (let i = 0; i < outer.length - 1; i++) area += outer[i]!.x * outer[i + 1]!.y - outer[i + 1]!.x * outer[i]!.y;
      if (area === 0) continue;
      const s = area > 0 ? 1 : -1;

      // --- walls: original edges, clipped to the tile square -------------
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]!, b = ring[i + 1]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len === 0) continue;
          const t = clipSeg(a.x, a.y, b.x, b.y, E);
          if (!t) continue;
          const ax = a.x + dx * t[0], ay = a.y + dy * t[0];
          const bx = a.x + dx * t[1], by = a.y + dy * t[1];
          if (onSameBoundary(ax, ay, bx, by, E)) {
            dropped++;
            continue;
          }
          // outward normal in tile coords (y down), reported north-up
          const nx = (s * dy) / len, ny = (-s * dx) / len;
          const facew = len * mpu;
          const i0 = vert(ax, ay, hb, t[0], 0, nx, -ny, facew);
          vert(bx, by, hb, t[1], 0, nx, -ny, facew);
          vert(bx, by, hb, t[1], 1, nx, -ny, facew);
          vert(ax, ay, hb, t[0], 1, nx, -ny, facew);
          idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
          // Report every wall that leaves the tile square, not only the
          // generator-cut ones: the neighbouring tile very often holds the
          // WHOLE wall (both true corners inside its buffer) and is the one
          // that can tell the cut side where the wall really ends.
          const cutA = isCut(a), cutB = isCut(b);
          const crosses = t[0] > 0 || t[1] < 1;
          if ((cutA || cutB || crosses) && fid !== undefined) {
            cuts.push(fid, i0, cutA ? 1 : 0, cutB ? 1 : 0, ax, ay, bx, by, a.x, a.y, b.x, b.y);
          }
        }
      }

      // --- roof: every ring clipped to the square, then earcut -----------
      const flat: number[] = [];
      const holes: number[] = [];
      let ok = true;
      for (let r = 0; r < poly.length; r++) {
        const c = clipRing(poly[r]!, E);
        if (c.length === 0) {
          if (r === 0) ok = false;
          continue;
        }
        if (r > 0) holes.push(flat.length / 2);
        for (const x of c) flat.push(x);
      }
      if (!ok) continue;
      const tris = earcut(flat, holes.length ? holes : undefined, 2);
      const first = v.length / STAGING;
      const roofHb: [number, number, number, number] = [h0, h1, h0, h1];
      for (let i = 0; i < flat.length; i += 2) vert(flat[i]!, flat[i + 1]!, roofHb, 0.5, 0.5, 0, 0, 0);
      for (const k of tris) idx.push(first + k);
    }
  }
  if (idx.length === 0) return null;
  const posScale = posScaleFor(E);
  return {
    vertices: packVertices(v, posScale),
    posScale,
    indices: new Uint32Array(idx),
    extent: E,
    features: layer.length,
    droppedBoundaryWalls: dropped,
    cuts: new Float64Array(cuts),
    interp: { height: height.interp, base: base.interp },
  };
}

/** Unpack {@link MeshData.cuts}. */
export function readCuts(cuts: Float64Array): CutWall[] {
  const out: CutWall[] = [];
  for (let i = 0; i + CUT_STRIDE <= cuts.length; i += CUT_STRIDE) {
    out.push({
      fid: cuts[i]!, vi: cuts[i + 1]!, cutA: cuts[i + 2] === 1, cutB: cuts[i + 3] === 1,
      ax: cuts[i + 4]!, ay: cuts[i + 5]!, bx: cuts[i + 6]!, by: cuts[i + 7]!,
      oax: cuts[i + 8]!, oay: cuts[i + 9]!, obx: cuts[i + 10]!, oby: cuts[i + 11]!,
    });
  }
  return out;
}
