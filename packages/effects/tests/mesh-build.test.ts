/**
 * The worker-side mesh builder: heights from the static layer's OWN
 * expressions (any schema), its filter, exact tile clipping, and the
 * generator-cut wall records the seam fix consumes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTileMesh, readCuts, type MeshData } from "../src/backends/extrusions/mesh-build";
import { readVertex, VERTEX_BYTES, type Vertex } from "../src/backends/extrusions/vertex-format";
import { zoomFactor } from "../src/backends/extrusions/interp";
import { makeTile } from "./helpers";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../examples/verification/data/omt/14/4823/6159.pbf");

const vertices = (mesh: MeshData): Vertex[] =>
  Array.from({ length: mesh.vertices.length / VERTEX_BYTES }, (_, i) => readVertex(mesh.vertices, i, mesh.posScale));

/** All distinct per-vertex (height at zoom, height at zoom + 1) pairs. */
function heights(mesh: MeshData): string[] {
  return [...new Set(vertices(mesh).map((v) => `${v.z0},${v.z1}`))];
}

const square = (x0: number, y0: number, s: number): Array<[number, number]> => [
  [x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s],
];

describe("buildTileMesh — heights from the layer's own expressions", () => {
  it("evaluates a non-OpenMapTiles property (`levels` × 3.5 on a `podium` base)", () => {
    const raw = makeTile("blocks", [
      { id: 1, properties: { levels: 4, podium: 0 }, rings: [square(100, 100, 200)] },
      { id: 2, properties: { levels: 20, podium: 2 }, rings: [square(1000, 1000, 300)] },
    ]);
    const mesh = buildTileMesh({
      raw, sourceLayer: "blocks", z: 14, x: 4823, y: 6159, zoom: 14,
      height: ["*", ["get", "levels"], 3.5],
      base: ["*", ["get", "podium"], 3.5],
    })!;
    expect(mesh).not.toBeNull();
    expect(mesh.interp.height.zoomDependent).toBe(false);
    const hs = heights(mesh);
    expect(hs).toContain("0,0"); // block 1's walls start on the ground
    expect(hs).toContain("14,14"); // … and rise 4 × 3.5 m
    expect(hs).toContain("7,7"); // block 2 sits on a 2-level podium
    expect(hs).toContain("70,70"); // … and rises to 20 levels
    const wall2 = vertices(mesh).find((v) => !v.isRoof && v.z0 === 70)!;
    expect(wall2.fh0).toBe(63); // its walls are 63 m tall
  });

  it("a zoom ramp evaluates at the tile zoom and zoom + 1, like MapLibre's composite binder", () => {
    const raw = makeTile("b", [{ id: 1, properties: { h: 100 }, rings: [square(100, 100, 200)] }]);
    const ramp = ["interpolate", ["linear"], ["zoom"], 13, ["*", ["get", "h"], 2.25], 18, ["get", "h"]];
    const mesh = buildTileMesh({ raw, sourceLayer: "b", z: 14, x: 0, y: 0, zoom: 14, height: ramp })!;
    expect(mesh.interp.height).toEqual({ zoomDependent: true, type: { name: "linear" } });
    const top = vertices(mesh).find((v) => v.z0 > 0)!;
    expect(top.z0).toBeCloseTo(200, 4); // z14: 2.0x
    expect(top.z1).toBeCloseTo(175, 4); // z15: 1.75x
    // halfway between 14 and 15 the renderer blends halfway
    expect(zoomFactor(mesh.interp.height, 14.5, 14)).toBeCloseTo(0.5, 6);
    expect(zoomFactor(mesh.interp.height, 16, 14)).toBe(1); // clamped, as MapLibre does
  });

  it("an absent height is the spec default (0)", () => {
    const raw = makeTile("b", [{ id: 1, rings: [square(10, 10, 20)] }]);
    const mesh = buildTileMesh({ raw, sourceLayer: "b", z: 14, x: 0, y: 0, zoom: 14 })!;
    expect(heights(mesh)).toEqual(["0,0"]);
  });

  it("honours the static layer's filter", () => {
    const raw = makeTile("b", [
      { id: 1, properties: { kind: "keep", h: 10 }, rings: [square(10, 10, 20)] },
      { id: 2, properties: { kind: "drop", h: 99 }, rings: [square(100, 100, 20)] },
    ]);
    const mesh = buildTileMesh({
      raw, sourceLayer: "b", z: 14, x: 0, y: 0, zoom: 14,
      height: ["get", "h"], filter: ["==", ["get", "kind"], "keep"],
    })!;
    expect(heights(mesh)).not.toContain("99,99");
    expect(heights(mesh)).toContain("10,10");
  });

  it("an invalid expression throws the style-spec's message (the backend declares absence)", () => {
    const raw = makeTile("b", [{ id: 1, rings: [square(10, 10, 20)] }]);
    expect(() =>
      buildTileMesh({ raw, sourceLayer: "b", z: 14, x: 0, y: 0, zoom: 14, height: ["get"] })
    ).toThrow(/Expected arguments/);
  });
});

describe("buildTileMesh — geometry", () => {
  it("builds the real lower-Manhattan fixture tile with the crosshatch expressions", () => {
    const mesh = buildTileMesh({
      raw: readFileSync(FIXTURE),
      sourceLayer: "building",
      z: 14, x: 4823, y: 6159, zoom: 14,
      height: ["interpolate", ["linear"], ["zoom"], 13, ["*", ["coalesce", ["get", "render_height"], 10], 2.25], 18, ["coalesce", ["get", "render_height"], 10]],
      base: ["coalesce", ["get", "render_min_height"], 0],
    })!;
    expect(mesh.features).toBeGreaterThan(400);
    expect(mesh.vertices.length % VERTEX_BYTES).toBe(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length / 3).toBeGreaterThan(10_000);
    // every vertex is inside the tile square: buffer geometry is clipped away
    for (const v of vertices(mesh)) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(mesh.extent);
    }
    // generator-cut walls (at the tile buffer) are reported for the seam fix
    expect(readCuts(mesh.cuts).length).toBeGreaterThan(0);
  });

  it("wall texture coordinates come from the unclipped edge; roofs are marked by a zero normal", () => {
    // a wall from x=-500 to x=500 (genuine corners outside the extent, so not cut):
    const raw = makeTile("b", [{ id: 9, properties: { h: 10 }, rings: [[[-500, 100], [500, 100], [500, 300], [-500, 300]]] }]);
    const mesh = buildTileMesh({ raw, sourceLayer: "b", z: 14, x: 0, y: 0, zoom: 14, height: ["get", "h"] })!;
    const us = vertices(mesh)
      .filter((v) => !v.isRoof && v.nx === 0 && v.y === 100)
      .map((v) => v.u);
    // the clipped part [0, 500] of the [-500, 500] wall spans u 0.5 → 1
    expect(Math.min(...us)).toBeCloseTo(0.5, 4);
    expect(Math.max(...us)).toBeCloseTo(1, 4);
    expect(vertices(mesh).some((v) => v.isRoof)).toBe(true);
  });
});
