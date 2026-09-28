/**
 * @file U12 SPIKE — the crosshatch tile mesh builder (route 2; shared with route 1 since session 3)
 *
 * Moved out of crosshatch-custom.ts unchanged, so route 1's bundled tile
 * worker can import it without pulling in deck.gl or maplibre.
 */
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import Pbf from "pbf";
import earcut from "earcut";

// Tangram's lights in a north-up frame (route 1's constants).
const LD = norm3([-0.2, -0.7, 0.5]);
const LP = norm3([0.0, -1.0, 1.0]);
function norm3(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}
const diffuse = (nx: number, ny: number, nz: number) =>
  Math.max(0, nx * LD[0]! + ny * LD[1]! + nz * LD[2]!) + 0.5 * Math.max(0, nx * LP[0]! + ny * LP[1]! + nz * LP[2]!);
const ROOF_DIFFUSE = diffuse(0, 0, 1);

type Pt = { x: number; y: number };

/** Sutherland–Hodgman against the square [0, E]². Input ring may be closed. */
function clipRing(ring: Pt[], E: number): number[] {
  let pts: number[] = [];
  const n = ring.length - (ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.y === ring[ring.length - 1]!.y ? 1 : 0);
  for (let i = 0; i < n; i++) pts.push(ring[i]!.x, ring[i]!.y);
  // edges: x>=0, x<=E, y>=0, y<=E
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const axis = e < 2 ? 0 : 1;
    const lo = e % 2 === 0;
    const inside = (v: number) => (lo ? v >= 0 : v <= E);
    const bound = lo ? 0 : E;
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

/** Liang–Barsky: clip segment to [0, E]², returning [t0, t1] or null. */
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
      if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
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

export interface MeshData {
  vertices: Float32Array; // 7 floats / vertex
  indices: Uint32Array;
  extent: number;
  features: number;
  droppedBoundaryWalls: number;
}

/**
 * Decode one tile's building layer and build the crosshatch mesh.
 *
 * `wallsFromGround` (route 1): ignore render_min_height, as deck's
 * SolidPolygonLayer does (its walls always start at the ground), so a
 * building part on a podium keeps route 1's look — no fresh base-darkening
 * gradient at its min height (route 2's default).
 * `groundUV` (route 1, cheaper): walls start at render_min_height but keep
 * the from-the-ground v texcoord (mh/h at their base) — the same shading
 * with less wall area hidden inside podiums; ~0.4% of pixels differ.
 */
export function buildTileMesh(
  raw: ArrayBuffer | Uint8Array,
  sourceLayer: string,
  opts: { wallsFromGround?: boolean; groundUV?: boolean } = {}
): MeshData | null {
  const vt = new VectorTile(new Pbf(raw instanceof Uint8Array ? raw : new Uint8Array(raw)));
  const layer = vt.layers[sourceLayer];
  if (!layer) return null;
  const E = layer.extent;
  const v: number[] = [];
  const idx: number[] = [];
  let dropped = 0;
  const vert = (x: number, y: number, z: number, u: number, w: number, d: number, roof: number) => {
    v.push(x, y, z, u, w, d, roof);
    return v.length / 7 - 1;
  };
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 3) continue;
    const props = feat.properties as Record<string, unknown>;
    const h = typeof props.render_height === "number" ? props.render_height : 10;
    const mh = !opts.wallsFromGround && typeof props.render_min_height === "number" ? props.render_min_height : 0;
    const rings = feat.loadGeometry() as Pt[][];
    for (const poly of classifyRings(rings) as Pt[][][]) {
      // Signed area (tile coords, y down) of the outer ring fixes which edge
      // normal points out of the solid, for the outer ring and its holes.
      const outer = poly[0]!;
      let area = 0;
      for (let i = 0; i < outer.length - 1; i++) area += outer[i]!.x * outer[i + 1]!.y - outer[i + 1]!.x * outer[i]!.y;
      if (area === 0) continue;
      const s = area > 0 ? 1 : -1;

      // --- walls: original edges, clipped to the tile square ------------
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
          if (onSameBoundary(ax, ay, bx, by, E)) { dropped++; continue; }
          // outward normal in tile coords, then to north-up (flip y)
          const nx = (s * dy) / len, ny = (-s * dx) / len;
          const d = diffuse(nx, -ny, 0);
          const v0 = opts.groundUV && h > 0 ? mh / h : 0;
          const i0 = vert(ax, ay, mh, t[0], v0, d, 0);
          vert(bx, by, mh, t[1], v0, d, 0);
          vert(bx, by, h, t[1], 1, d, 0);
          vert(ax, ay, h, t[0], 1, d, 0);
          idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        }
      }

      // --- roof: clip every ring to the square, earcut ------------------
      const flat: number[] = [];
      const holes: number[] = [];
      let ok = true;
      for (let r = 0; r < poly.length; r++) {
        const c = clipRing(poly[r]!, E);
        if (c.length === 0) { if (r === 0) ok = false; continue; }
        if (r > 0) holes.push(flat.length / 2);
        for (const x of c) flat.push(x);
      }
      if (!ok) continue;
      const tris = earcut(flat, holes.length ? holes : undefined, 2);
      const base = v.length / 7;
      for (let i = 0; i < flat.length; i += 2) vert(flat[i]!, flat[i + 1]!, h, 0.5, 0.6, ROOF_DIFFUSE, 1);
      for (const k of tris) idx.push(base + k);
    }
  }
  if (idx.length === 0) return null;
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx), extent: E, features: layer.length, droppedBoundaryWalls: dropped };
}

