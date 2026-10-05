/**
 * The tile-seam fix (regression for ml-rzm's "REGRESSION (not fixed)"): a
 * long wall crossing a tile edge must keep one stroke scale — its texture
 * coordinate comes from the unclipped wall, identically in both tiles.
 */
import { describe, it, expect } from "vitest";
import { buildTileMesh, readCuts } from "../src/backends/extrusions/mesh-build";
import { readVertex, VERTEX_BYTES } from "../src/backends/extrusions/vertex-format";
import { SeamRegistry } from "../src/backends/extrusions/seams";
import { makeTile } from "./helpers";

const E = 4096;
const B = 64; // the generator's buffer
// One building, 2596 tile units long, from x=3000 in tile A to x=1500 in
// tile B; each tile holds it clipped at its own buffer, as a tile generator
// writes it.
const tileA = makeTile("b", [
  { id: 42, properties: { h: 30 }, rings: [[[3000, 1000], [E + B, 1000], [E + B, 1200], [3000, 1200]]] },
]);
const tileB = makeTile("b", [
  { id: 42, properties: { h: 30 }, rings: [[[-B, 1000], [1500, 1000], [1500, 1200], [-B, 1200]]] },
]);

function build(raw: Uint8Array, x: number) {
  return buildTileMesh({ raw, sourceLayer: "b", z: 14, x, y: 6000, zoom: 14, height: ["get", "h"] })!;
}

/** u at the bottom vertices of the wall along y = 1000. */
function wallU(mesh: { vertices: Uint8Array; posScale: number }): number[] {
  const us: number[] = [];
  for (let i = 0; i < mesh.vertices.length / VERTEX_BYTES; i++) {
    const v = readVertex(mesh.vertices, i, mesh.posScale);
    if (!v.isRoof && v.y === 1000 && v.v === 0) us.push(v.u);
  }
  return us.sort((a, b) => a - b);
}

describe("SeamRegistry", () => {
  it("documents the bug: each tile parametrises its own buffer-cut edge", () => {
    const a = build(tileA, 100), b = build(tileB, 101);
    const [, aSeam] = wallU(a); // tile A's u where the wall leaves it
    const [bSeam] = wallU(b); // tile B's u where it enters
    expect(Math.abs(aSeam! - bSeam!)).toBeGreaterThan(0.5); // 0.945 vs 0.041
  });

  it("stitches the cut wall: both tiles agree at the seam and on the wall length", () => {
    const a = build(tileA, 100), b = build(tileB, 101);
    const cutsA = readCuts(a.cuts), cutsB = readCuts(b.cuts);
    // the two long walls (y=1000 and y=1200) are generator-cut in each tile
    expect(cutsA).toHaveLength(2);
    expect(cutsB).toHaveLength(2);

    const patched = new Map<string, Uint8Array>(); // `${mesh}:${vi}` → 4 packed vertices
    const seams = new SeamRegistry((mesh, vi, verts) => patched.set(`${mesh}:${vi}`, verts.slice()));
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, cutsA, a.vertices);
    expect(seams.resolvedGroups).toBe(0); // one tile alone never knows the true wall
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, cutsB, b.vertices);
    expect(seams.resolvedGroups).toBe(2);
    expect(seams.patchedWalls).toBe(4);

    const bottom = (mesh: string) => {
      const wall = (mesh === "A" ? cutsA : cutsB).find((w) => w.ay === 1000 && w.by === 1000)!;
      const v = patched.get(`${mesh}:${wall.vi}`)!;
      // vertex order: A bottom, B bottom, B top, A top
      const v0 = readVertex(v, 0, 16), v1 = readVertex(v, 1, 16);
      return { u0: v0.u, u1: v1.u, metres: v0.facew };
    };
    const A = bottom("A"), Bw = bottom("B");
    const total = 2596; // the true wall, in tile units
    expect(A.u0).toBeCloseTo(0, 4);
    expect(A.u1).toBeCloseTo((E - 3000) / total, 4); // where it crosses the seam…
    expect(Bw.u0).toBeCloseTo((E - 3000) / total, 4); // …is where B picks it up
    expect(Bw.u1).toBeCloseTo(1, 4);
    // one wall, one length: the stroke scale is the same on both sides
    expect(A.metres).toBe(Bw.metres);
    expect(A.metres).toBeGreaterThan(0);
  });

  it("removing a tile forgets its walls; re-adding resolves again", () => {
    const a = build(tileA, 100), b = build(tileB, 101);
    const seams = new SeamRegistry(() => {});
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, readCuts(a.cuts), a.vertices);
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, readCuts(b.cuts), b.vertices);
    seams.remove("B");
    seams.remove("A");
    expect(seams.resolvedGroups).toBe(0);
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, readCuts(b.cuts), b.vertices);
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, readCuts(a.cuts), a.vertices);
    expect(seams.resolvedGroups).toBe(2);
  });

  it("matches by geometry, not feature id (tilesets don't keep ids stable across tiles)", () => {
    const renumbered = makeTile("b", [
      { id: 7, properties: { h: 30 }, rings: [[[-B, 1000], [1500, 1000], [1500, 1200], [-B, 1200]]] },
    ]);
    const a = build(tileA, 100), b = build(renumbered, 101);
    const seams = new SeamRegistry(() => {});
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, readCuts(a.cuts), a.vertices);
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, readCuts(b.cuts), b.vertices);
    expect(seams.resolvedGroups).toBe(2);
  });

  it("keeps colinear row houses apart: walls that only touch end to end are different walls", () => {
    // tile B holds a second building on the same facade line, starting
    // where nothing of tile A's wall reaches
    const rowHouse = makeTile("b", [
      { id: 8, properties: { h: 30 }, rings: [[[500, 1000], [1500, 1000], [1500, 1200], [500, 1200]]] },
    ]);
    const a = build(tileA, 100), b = build(rowHouse, 101);
    const seams = new SeamRegistry(() => {});
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, readCuts(a.cuts), a.vertices);
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, readCuts(b.cuts), b.vertices);
    expect(seams.resolvedGroups).toBe(0);
    expect(seams.patchedWalls).toBe(0);
  });

  it("the neighbour holding the whole wall in its buffer supplies the far end", () => {
    // 256 units long, crossing the seam: tile A sees it end in its buffer;
    // tile B gets it generator-cut at its own buffer
    const a = build(makeTile("b", [{ id: 1, properties: { h: 30 }, rings: [[[3900, 1000], [4156, 1000], [4156, 1200], [3900, 1200]]] }]), 100);
    const b = build(makeTile("b", [{ id: 2, properties: { h: 30 }, rings: [[[-B, 1000], [60, 1000], [60, 1200], [-B, 1200]]] }]), 101);
    const patched = new Map<string, Uint8Array>();
    const seams = new SeamRegistry((mesh, vi, verts) => patched.set(`${mesh}:${vi}`, verts.slice()));
    seams.add("B", { z: 14, x: 101, y: 6000 }, E, readCuts(b.cuts), b.vertices);
    seams.add("A", { z: 14, x: 100, y: 6000 }, E, readCuts(a.cuts), a.vertices);
    const bWall = readCuts(b.cuts).find((w) => w.ay === 1000)!;
    const v = patched.get(`B:${bWall.vi}`)!;
    expect(readVertex(v, 0, 16).u).toBeCloseTo((E - 3900) / 256, 4); // B starts where A's part ends
    expect(readVertex(v, 1, 16).u).toBeCloseTo(1, 4);
  });
});
