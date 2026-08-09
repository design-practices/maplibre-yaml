/**
 * @file Tests for the hand-rolled feature-bbox helper
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * `geometryBounds` walks a GeoJSON geometry's coordinates and returns the
 * axis-aligned bounding box as `[[minLng, minLat], [maxLng, maxLat]]`. It is
 * the geometry half of the `zoomToFeature` click interaction and is deliberately
 * dependency-free (no `@turf/*`). These tests pin the bbox per geometry type,
 * the altitude-position (3-element) case, and the empty/missing → null contract
 * the caller relies on to no-op.
 */

import { describe, it, expect } from "vitest";
import { geometryBounds } from "../../src/interactions/geometry-bounds";

describe("geometryBounds — per geometry type", () => {
  it("returns a degenerate bbox for a Point", () => {
    expect(geometryBounds({ type: "Point", coordinates: [1, 2] })).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it("ignores the altitude (z) of a 3-element position", () => {
    expect(
      geometryBounds({ type: "Point", coordinates: [1, 2, 100] })
    ).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it("spans a LineString", () => {
    expect(
      geometryBounds({
        type: "LineString",
        coordinates: [
          [0, 0],
          [2, 3],
          [-1, 5],
        ],
      })
    ).toEqual([
      [-1, 0],
      [2, 5],
    ]);
  });

  it("spans a Polygon (outer ring)", () => {
    expect(
      geometryBounds({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      })
    ).toEqual([
      [0, 0],
      [4, 4],
    ]);
  });

  it("spans a MultiPoint", () => {
    expect(
      geometryBounds({
        type: "MultiPoint",
        coordinates: [
          [0, 0],
          [10, -5],
        ],
      })
    ).toEqual([
      [0, -5],
      [10, 0],
    ]);
  });

  it("spans a MultiLineString", () => {
    expect(
      geometryBounds({
        type: "MultiLineString",
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [-3, 2],
            [2, 9],
          ],
        ],
      })
    ).toEqual([
      [-3, 0],
      [2, 9],
    ]);
  });

  it("spans a MultiPolygon", () => {
    expect(
      geometryBounds({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
          [
            [
              [5, 5],
              [8, 5],
              [8, 7],
              [5, 5],
            ],
          ],
        ],
      })
    ).toEqual([
      [0, 0],
      [8, 7],
    ]);
  });

  it("spans a GeometryCollection across its members", () => {
    expect(
      geometryBounds({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [-10, 3] },
          {
            type: "LineString",
            coordinates: [
              [4, -2],
              [6, 8],
            ],
          },
        ],
      })
    ).toEqual([
      [-10, -2],
      [6, 8],
    ]);
  });
});

describe("geometryBounds — empty / missing → null (caller no-ops)", () => {
  it("returns null for a null geometry", () => {
    expect(geometryBounds(null)).toBeNull();
  });

  it("returns null for an undefined geometry", () => {
    expect(geometryBounds(undefined)).toBeNull();
  });

  it("returns null for an empty LineString", () => {
    expect(geometryBounds({ type: "LineString", coordinates: [] })).toBeNull();
  });

  it("returns null for a Polygon with an empty ring set", () => {
    expect(geometryBounds({ type: "Polygon", coordinates: [] })).toBeNull();
  });

  it("returns null for an empty GeometryCollection", () => {
    expect(
      geometryBounds({ type: "GeometryCollection", geometries: [] })
    ).toBeNull();
  });
});
