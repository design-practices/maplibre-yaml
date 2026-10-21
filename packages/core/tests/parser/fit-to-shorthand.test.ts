/**
 * `fitTo: tracts` is shorthand for `fitTo: { source: tracts }` (ml-aot.104):
 * it used to stop the map with "Expected object, got string".
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

const doc = (fitTo: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
  fitTo: ${fitTo}
sources:
  tracts: { type: geojson, data: { type: FeatureCollection, features: [] } }
layers:
  - { id: t, type: fill, source: tracts }
`;

describe("fitTo shorthand", () => {
  it("a source name means { source: name }", () => {
    const result = YAMLParser.safeParseMapBlock(doc("tracts"));
    expect(result.errors).toEqual([]);
    expect((result.data as { config: { fitTo: unknown } }).config.fitTo).toEqual({ source: "tracts" });
  });

  it("the object form is unchanged", () => {
    const result = YAMLParser.safeParseMapBlock(doc("{ source: tracts, padding: 20 }"));
    expect((result.data as { config: { fitTo: unknown } }).config.fitTo).toEqual({ source: "tracts", padding: 20 });
  });

  it("a misspelt name in the shorthand gets the same did-you-mean", () => {
    const result = YAMLParser.safeParseMapBlock(doc("tract"));
    expect(result.success).toBe(true);
    const w = result.warnings.find((x) => x.path === "config.fitTo.source");
    expect(w?.message).toContain('Did you mean "tracts"?');
    expect(w?.line).toBe(7);
  });
});
