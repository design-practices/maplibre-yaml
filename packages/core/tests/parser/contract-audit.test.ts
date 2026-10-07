/**
 * Renderer/schema contract audit (ml-tfd.8): schema-accepted surfaces that
 * silently did nothing must now say so.
 *
 * - `$ref` handling was AUDITED AS ALREADY CLOSED and is pinned here: a v1
 *   standalone block resolves `$ref` against its own `sources:` record and
 *   hard-errors when the target is missing (todos/039 is stale); v2
 *   hard-errors on the shape itself ($ref is a v1 affordance).
 * - Scrollytelling fields that once warned `kind: "unimplemented"`
 *   (spinGlobe, rotateAnimation, callback, and the fitBounds/custom/flyTo/
 *   easeTo chapter actions) run in @maplibre-yaml/astro since 0.7, so they
 *   must no longer warn; a stale "not implemented" note would tell authors
 *   to delete a working field.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

describe("$ref contract (pinned: already loud, keep it that way)", () => {
  it("a standalone block's dangling $ref is a hard error, not a silent no-op", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: p
    type: circle
    source: { $ref: "#/sources/cities" }
`);
    expect(result.success).toBe(false);
    expect(
      result.errors!.some((e) => /Source reference not found/.test(e.message))
    ).toBe(true);
  });

  it("a standalone block's $ref resolves against its own sources record", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  cities:
    type: geojson
    url: "https://example.com/cities.geojson"
layers:
  - id: p
    type: circle
    source: { $ref: "#/sources/cities" }
`);
    expect(result.success).toBe(true);
    expect(result.warnings.filter((w) => /Unknown key/.test(w.message))).toEqual([]);
  });
});

describe("implemented scrollytelling fields do not warn as unimplemented", () => {
  const scrolly = (chapterExtra: string) => `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: c1
    title: One
    center: [0, 0]
    zoom: 3
${chapterExtra}
`;

  it("spinGlobe, rotateAnimation and callback raise no unimplemented warning", () => {
    const { result } = YAMLParser.safeParseAny(
      scrolly(`    spinGlobe: true
    rotateAnimation: true
    callback: doThing`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings.filter((x) => x.kind === "unimplemented")).toEqual([]);
    expect(result.warnings.filter((x) => /not implemented/.test(x.message))).toEqual([]);
  });

  it("fitBounds, custom, flyTo and easeTo chapter actions raise no unimplemented warning", () => {
    const { result } = YAMLParser.safeParseAny(
      scrolly(`    onChapterEnter:
      - action: fitBounds
        layer: p
      - action: custom
      - action: flyTo
      - action: easeTo
    onChapterExit:
      - action: setFilter
        layer: p`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings.filter((x) => x.kind === "unimplemented")).toEqual([]);
  });
});
