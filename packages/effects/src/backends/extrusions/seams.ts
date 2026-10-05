/**
 * @file The tile-seam fix: stitch walls across tile edges
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * A wall's texture coordinate runs 0→1 along the whole wall (Tangram's
 * per-face parametrisation — stroke scale follows the face). A long wall
 * that crosses a tile edge is cut by the vector-tile generator at each
 * tile's buffer, so a tile may not know the true wall: the U12 spike gave
 * each tile its own buffer-cut edge, and the stroke scale stepped at the
 * seam (ml-rzm, "REGRESSION (not fixed)").
 *
 * The worker reports every wall that leaves its tile square (mesh-build
 * `CutWall`), flagging which ends the generator cut. Here, on the main
 * thread, those records are grouped by GEOMETRY — same direction, same line
 * (with a tolerance for the generator's integer rounding), overlapping
 * along it — not by feature id: real tilesets do not keep ids stable across
 * tiles (OpenFreeMap's lower-Manhattan tiles share 9 of 54). Adjacent row
 * houses on one facade line only touch at a corner, so the overlap test
 * keeps them apart. Each record contributes the true (uncut) ends it can
 * see; once a group knows both, every member's `u` and wall length are
 * recomputed from the unclipped wall and patched into its vertices —
 * identical on both sides of the seam.
 *
 * A wall stays on its local parametrisation until a tile that sees its far
 * end has loaded; it is only visible on both sides once both have.
 */

import type { CutWall } from "./mesh-build";
import { VERTEX_BYTES, VB, writeUv, writeFacew, fromHalf } from "./vertex-format";

const EARTH_CIRCUMFERENCE = 40075016.68557849;

type Vec = [number, number];

interface Member {
  meshKey: string;
  wall: CutWall;
  /** World (mercator 0–1) original edge. */
  a: Vec;
  b: Vec;
  /** World positions of the clipped endpoints. */
  A: Vec;
  B: Vec;
  /**
   * When a clipped endpoint lies on the tile square's edge, that edge as an
   * axis-aligned world line (axis 0: x = value, axis 1: y = value). Tiles that
   * share the edge share the value exactly, so `u` there is taken where the
   * stitched wall crosses it — identical on both sides even when the tiles'
   * copies of the wall disagree by a few units (maplibre-gl 6 slices).
   */
  edgeA?: [0 | 1, number];
  edgeB?: [0 | 1, number];
  /** A private copy of the wall's four packed vertices (4 × VERTEX_BYTES). */
  verts: Uint8Array;
  /** Whether the stitched parametrisation was applied. */
  patched: boolean;
  group: Group;
}

interface Group {
  dir: Vec;
  origin: Vec;
  tol: number;
  members: Set<Member>;
  bucket: string;
  start?: Vec;
  end?: Vec;
  resolved: boolean;
}

/** Called with a wall's four patched (packed) vertices (first vertex index `vi`). */
export type PatchFn = (meshKey: string, vi: number, verts: Uint8Array) => void;

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];

const ANGLE_BIN = (2 * Math.PI) / 360; // 1°
const OFFSET_BIN = 2e-6; // mercator units (~80 m at the equator)

export class SeamRegistry {
  private readonly buckets = new Map<string, Set<Group>>();
  private readonly byMesh = new Map<string, Member[]>();
  /** Walls whose texture coordinates were rewritten from the unclipped wall. */
  patchedWalls = 0;

  constructor(private readonly patch: PatchFn) {}

  /** Number of walls known end to end (groups with both true ends). */
  get resolvedGroups(): number {
    let n = 0;
    for (const g of this.groups()) if (g.resolved) n++;
    return n;
  }

  private *groups(): Generator<Group> {
    for (const set of this.buckets.values()) yield* set;
  }

  /**
   * Register one mesh's boundary walls.
   *
   * @param vertices - the mesh's packed vertices (read for the copies; never retained)
   * @param driftUnits - extra matching tolerance, in tile units, for tiles
   *   whose bytes carry known vertex drift (maplibre-gl 6's re-encoded
   *   overzoom slices; see adapter.ts)
   */
  add(
    meshKey: string,
    tile: { z: number; x: number; y: number },
    extent: number,
    cuts: CutWall[],
    vertices: Uint8Array,
    driftUnits = 0
  ): void {
    if (cuts.length === 0) return;
    const n = 2 ** tile.z;
    const world = (px: number, py: number): Vec => [(tile.x + px / extent) / n, (tile.y + py / extent) / n];
    // the generator rounds cut points to integer tile units: allow a few
    // units of drift at this tile's zoom (more where the bytes are known to drift)
    const tol = (3 + driftUnits) / (extent * n);
    const eps = 1e-6;
    const snap = (p: number) => (Math.abs(p) < eps ? 0 : Math.abs(p - extent) < eps ? extent : undefined);
    const edge = (px: number, py: number): [0 | 1, number] | undefined => {
      const sx = snap(px);
      if (sx !== undefined) return [0, (tile.x + sx / extent) / n];
      const sy = snap(py);
      return sy !== undefined ? [1, (tile.y + sy / extent) / n] : undefined;
    };
    const members: Member[] = [];
    for (const wall of cuts) {
      const a = world(wall.oax, wall.oay);
      const b = world(wall.obx, wall.oby);
      const d = sub(b, a);
      const len = Math.hypot(d[0], d[1]);
      if (len === 0) continue;
      const dir: Vec = [d[0] / len, d[1] / len];
      const group = this.join(a, b, dir, tol);
      const member: Member = {
        meshKey,
        wall,
        a,
        b,
        A: world(wall.ax, wall.ay),
        B: world(wall.bx, wall.by),
        edgeA: edge(wall.ax, wall.ay),
        edgeB: edge(wall.bx, wall.by),
        verts: vertices.slice(wall.vi * VERTEX_BYTES, (wall.vi + 4) * VERTEX_BYTES),
        patched: false,
        group,
      };
      group.members.add(member);
      this.learnEnds(group, member);
      members.push(member);
      if (group.resolved) this.patchMember(group, member);
      else this.tryResolve(group);
    }
    const existing = this.byMesh.get(meshKey);
    this.byMesh.set(meshKey, existing ? existing.concat(members) : members);
  }

  /** Forget a mesh's walls (eviction / rebuild). */
  remove(meshKey: string): void {
    const members = this.byMesh.get(meshKey);
    if (!members) return;
    this.byMesh.delete(meshKey);
    for (const m of members) {
      const g = m.group;
      g.members.delete(m);
      if (g.members.size === 0) this.buckets.get(g.bucket)?.delete(g);
    }
  }

  clear(): void {
    this.buckets.clear();
    this.byMesh.clear();
  }

  /**
   * The stitched walls, for tests and debugging: per resolved group, each
   * member's texture-coordinate span and wall length after patching.
   */
  report(): Array<{ members: Array<{ meshKey: string; uA: number; uB: number; metres: number; patched: boolean }> }> {
    const out = [];
    for (const g of this.groups()) {
      if (!g.resolved) continue;
      out.push({
        members: [...g.members].map((m) => {
          const dv = new DataView(m.verts.buffer, m.verts.byteOffset, m.verts.byteLength);
          return {
            meshKey: m.meshKey,
            uA: dv.getUint16(VB.uv, true) / 65535,
            uB: dv.getUint16(VERTEX_BYTES + VB.uv, true) / 65535,
            metres: fromHalf(dv.getUint16(VB.facew, true)),
            patched: m.patched,
          };
        }),
      });
    }
    return out;
  }

  private keyOf(dir: Vec, point: Vec): [number, number] {
    const angle = Math.atan2(dir[1], dir[0]);
    return [Math.round(angle / ANGLE_BIN), Math.round(cross(point, dir) / OFFSET_BIN)];
  }

  /** Find (or create) the group this edge belongs to, merging groups it bridges. */
  private join(a: Vec, b: Vec, dir: Vec, tol: number): Group {
    const [ka, ko] = this.keyOf(dir, a);
    const found: Group[] = [];
    for (let da = -1; da <= 1; da++) {
      for (let dO = -1; dO <= 1; dO++) {
        const set = this.buckets.get(`${ka + da}:${ko + dO}`);
        if (!set) continue;
        for (const g of set) {
          if (dot(g.dir, dir) < 0.9995) continue;
          const t = Math.max(tol, g.tol);
          // on the same line …
          if (Math.abs(cross(sub(a, g.origin), g.dir)) > t || Math.abs(cross(sub(b, g.origin), g.dir)) > t) continue;
          // … and overlapping along it (touching end-to-end is a different wall)
          const s0 = dot(sub(a, g.origin), g.dir), s1 = dot(sub(b, g.origin), g.dir);
          let lo = Infinity, hi = -Infinity;
          for (const m of g.members) {
            lo = Math.min(lo, dot(sub(m.a, g.origin), g.dir));
            hi = Math.max(hi, dot(sub(m.b, g.origin), g.dir));
          }
          if (Math.min(s1, hi) - Math.max(s0, lo) > 2 * t) found.push(g);
        }
      }
    }
    if (found.length === 0) {
      const bucket = `${ka}:${ko}`;
      const g: Group = { dir, origin: a, tol, members: new Set(), bucket, resolved: false };
      let set = this.buckets.get(bucket);
      if (!set) {
        set = new Set();
        this.buckets.set(bucket, set);
      }
      set.add(g);
      return g;
    }
    const [g, ...rest] = found;
    for (const other of rest) {
      for (const m of other.members) {
        m.group = g!;
        g!.members.add(m);
        this.learnEnds(g!, m);
      }
      this.buckets.get(other.bucket)?.delete(other);
    }
    g!.tol = Math.max(g!.tol, tol);
    return g!;
  }

  private learnEnds(g: Group, m: Member): void {
    if (!m.wall.cutA && !g.start) g.start = m.a;
    if (!m.wall.cutB && !g.end) g.end = m.b;
  }

  private tryResolve(g: Group): void {
    if (!g.start || !g.end) return;
    if (dot(sub(g.end, g.start), g.dir) <= 0) return;
    g.resolved = true;
    for (const m of g.members) this.patchMember(g, m);
  }

  private patchMember(g: Group, m: Member): void {
    const d = sub(g.end!, g.start!);
    const L = Math.hypot(d[0], d[1]);
    const dir: Vec = [d[0] / L, d[1] / L];
    // u where the stitched wall crosses a shared tile edge (exact on both
    // sides of the seam), else the endpoint's projection onto the wall
    // The slack is relative (2 %) or the group's matching tolerance,
    // whichever is larger — a short wall in drifting (re-encoded) tiles can
    // miss its true ends by more than 2 % of its length.
    const slack = Math.max(0.02, (2 * g.tol) / L);
    const at = (P: Vec, e: [0 | 1, number] | undefined): number => {
      const projected = dot(sub(P, g.start!), dir) / L;
      if (!e || Math.abs(d[e[0]]) < 1e-12) return projected;
      const crossing = (e[1] - g.start![e[0]]) / d[e[0]];
      // near-parallel to the edge, drift moves the crossing a long way: trust it
      // only when it agrees with the projection
      return Math.abs(crossing - projected) <= slack ? crossing : projected;
    };
    const uA = at(m.A, m.edgeA);
    const uB = at(m.B, m.edgeB);
    // a member that doesn't sit on the stitched wall is a grouping mistake:
    // leave its local parametrisation rather than draw it wrong.
    if (uA < -slack || uB > 1 + slack || uB < uA) return;
    const midLat = Math.atan(Math.sinh(Math.PI * (1 - (g.start![1] + g.end![1]))));
    const metres = L * EARTH_CIRCUMFERENCE * Math.cos(midLat);
    // vertex order per wall: A bottom, B bottom, B top, A top
    const u = [uA, uB, uB, uA];
    const v = [0, 0, 1, 1];
    const dv = new DataView(m.verts.buffer, m.verts.byteOffset, m.verts.byteLength);
    for (let k = 0; k < 4; k++) {
      writeUv(dv, k * VERTEX_BYTES, u[k]!, v[k]!);
      writeFacew(dv, k * VERTEX_BYTES, metres);
    }
    if (!m.patched) this.patchedWalls++;
    m.patched = true;
    this.patch(m.meshKey, m.wall.vi, m.verts);
  }
}
