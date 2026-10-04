/**
 * The packed 20-byte vertex: what survives packing (positions to 1/16 tile
 * unit, heights to 1/16 m, wall lengths to half precision).
 */
import { describe, it, expect } from "vitest";
import { packVertices, readVertex, toHalf, fromHalf, posScaleFor, VERTEX_BYTES, STAGING } from "../src/backends/extrusions/vertex-format";

describe("vertex format", () => {
  it("half floats round-trip within half precision", () => {
    for (const v of [0, 1, 0.5, 3.25, 63, 119.5, 541.3, 2048, -7.5]) {
      expect(fromHalf(toHalf(v))).toBeCloseTo(v, v > 512 ? 0 : 1);
    }
    expect(fromHalf(toHalf(1e9))).toBe(65504); // clamps, never Infinity
  });

  it("packs and reads back a wall vertex and a roof vertex", () => {
    const staging = [
      // x, y, h0, h1, b0, b1, u, v, nx, ny, facew  — a wall's TOP vertex
      100.25, 4096, 200, 175, 7, 7, 0.4, 1, 0.6, -0.8, 119.3,
      // a roof vertex
      12, 34.5, 70, 70, 70, 70, 0.5, 0.5, 0, 0, 0,
    ];
    expect(staging.length).toBe(2 * STAGING);
    const scale = posScaleFor(4096);
    expect(scale).toBe(15);
    const bytes = packVertices(staging, scale);
    expect(bytes.length).toBe(2 * VERTEX_BYTES);
    const wall = readVertex(bytes, 0, scale);
    expect(wall.x).toBeCloseTo(100.25, 1);
    expect(wall.y).toBe(4096); // the tile edge stays exact
    expect([wall.z0, wall.z1]).toEqual([200, 175]); // a top vertex carries the height
    expect([wall.fh0, wall.fh1]).toEqual([193, 168]); // face height = height − base
    expect(wall.u).toBeCloseTo(0.4, 4);
    expect(wall.v).toBe(1);
    expect(wall.nx).toBeCloseTo(0.6, 1);
    expect(wall.ny).toBeCloseTo(-0.8, 1);
    expect(wall.facew).toBeCloseTo(119.3, 0);
    expect(wall.isRoof).toBe(false);
    const roof = readVertex(bytes, 1, scale);
    expect(roof.isRoof).toBe(true);
    expect([roof.z0, roof.z1, roof.fh0]).toEqual([70, 70, 0]);
  });
});
