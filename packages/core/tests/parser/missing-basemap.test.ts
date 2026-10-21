/**
 * A standalone map with no basemap validates (the Astro builders can fill it
 * from defaultMapStyle) but <ml-map> refuses it: validation now warns, so
 * `mlym validate` and the page agree (ml-aot.97).
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

describe("a map with no basemap", () => {
  it("v1: warns at config.mapStyle", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
layers: []
`);
    expect(result.success).toBe(true);
    const w = result.warnings.find((x) => x.path === "config.mapStyle");
    expect(w?.message).toContain("<ml-map> needs one");
    expect(w?.line).toBe(3);
  });

  it("v2: warns at style.basemap (the thematic-maps guide's snippet, before its fix)", () => {
    const result = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: income-v2
style:
  center: [-75.19, 39.936]
  zoom: 12
  sources:
    tracts: { type: geojson, url: /data/classify/sample-tracts.geojson }
  layers:
    - id: income
      type: fill
      source: tracts
      classify: { field: median_income, method: quantile, palette: Blues }
`);
    expect(result.success).toBe(true);
    expect(result.warnings.find((x) => x.path === "style.basemap")?.message).toContain("basemap:");
  });

  it("no warning with a basemap", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" }
layers: []
`);
    expect(result.warnings.filter((x) => /basemap/.test(x.message))).toEqual([]);
  });
});
