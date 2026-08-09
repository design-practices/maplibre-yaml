/**
 * @file ml-ldv — v1 warns (does not error) on malformed inline GeoJSON `data`.
 *
 * Format v2 hard-errors on inline `source.data` that is not RFC 7946 GeoJSON
 * (the strict schema is composed onto the field). Format v1 keeps `data` as
 * `z.any()` for byte-for-byte compat, so the same malformed data still parses —
 * but now surfaces a **warning** rather than passing silently. The check is
 * self-gating on the field schema (permissive `z.any()` = v1), so the v2 hard
 * error is never duplicated as a warning.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

const BASEMAP = "https://demotiles.maplibre.org/style.json";

/** A geojson source whose inline data has a 1-element position (invalid). */
const V1_MALFORMED = `
type: map
id: bad
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
sources:
  pts:
    type: geojson
    data:
      type: FeatureCollection
      features:
        - type: Feature
          geometry: { type: Point, coordinates: [0] }
          properties: {}
layers:
  - id: dot
    type: circle
    source: pts
`;

const V1_VALID = `
type: map
id: ok
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
sources:
  pts:
    type: geojson
    data:
      type: FeatureCollection
      features: []
layers:
  - id: dot
    type: circle
    source: pts
`;

const V2_MALFORMED = `
version: 2
type: map
id: bad
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  sources:
    pts:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - type: Feature
            geometry: { type: Point, coordinates: [0] }
            properties: {}
  layers:
    - id: dot
      type: circle
      source: pts
`;

describe("ml-ldv — v1 warns on malformed inline GeoJSON data", () => {
  it("v1: a malformed inline Feature parses, with an RFC-7946 warning", () => {
    const result = YAMLParser.safeParseMapBlock(V1_MALFORMED);
    expect(result.success).toBe(true);
    const geo = result.warnings.filter((w) => /GeoJSON|RFC 7946/.test(w.message));
    expect(geo.length).toBeGreaterThan(0);
    expect(geo[0]!.path).toContain("data");
    // It is a plain warning, not a deprecation (still promotes under --strict).
    expect(geo[0]!.kind).toBeUndefined();
  });

  it("v1: valid inline GeoJSON produces no GeoJSON warning", () => {
    const result = YAMLParser.safeParseMapBlock(V1_VALID);
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((w) => /GeoJSON|RFC 7946/.test(w.message))
    ).toBe(false);
  });

  it("v2: the same malformed data is a hard error, not a duplicated warning", () => {
    const result = YAMLParser.safeParseMapBlock(V2_MALFORMED);
    expect(result.success).toBe(false);
    if (result.success) return;
    // The v2 strict schema owns this as an error; the v1 warning path is
    // self-gated off (the field schema is not `z.any()`), so no warning dup.
    expect(
      result.warnings.some((w) => /GeoJSON|RFC 7946/.test(w.message))
    ).toBe(false);
  });
});
