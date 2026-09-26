/**
 * Renderer/schema contract audit (ml-tfd.8): schema-accepted surfaces that
 * silently did nothing must now say so.
 *
 * - `$ref` handling was AUDITED AS ALREADY CLOSED and is pinned here: a v1
 *   standalone block resolves `$ref` against its own `sources:` record and
 *   hard-errors when the target is missing (todos/039 is stale); v2
 *   hard-errors on the shape itself ($ref is a v1 affordance).
 * - Unimplemented scrollytelling fields (spinGlobe, rotateAnimation,
 *   callback, fitBounds/custom/flyTo/easeTo chapter actions) →
 *   `kind: "unimplemented"` warnings, which never promote: the document is
 *   not wrong, the engine is behind.
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

describe("unimplemented scrollytelling fields warn without promoting", () => {
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

  it("spinGlobe warns with kind unimplemented", () => {
    const { result } = YAMLParser.safeParseAny(scrolly(`    spinGlobe: true`));
    expect(result.success).toBe(true);
    const w = result.warnings.find((x) => x.path.endsWith("spinGlobe"));
    expect(w).toBeDefined();
    expect(w!.kind).toBe("unimplemented");
    expect(w!.message).toMatch(/not implemented/);
  });

  it("rotateAnimation and callback warn too", () => {
    const { result } = YAMLParser.safeParseAny(
      scrolly(`    rotateAnimation: true
    callback: doThing`)
    );
    expect(result.success).toBe(true);
    const kinds = result.warnings.filter((x) => x.kind === "unimplemented");
    expect(kinds.map((x) => x.path.split(".").pop()).sort()).toEqual([
      "callback",
      "rotateAnimation",
    ]);
  });

  it("a fitBounds chapter action warns; an implemented action does not", () => {
    const { result } = YAMLParser.safeParseAny(
      scrolly(`    onChapterEnter:
      - action: fitBounds
        layer: p
      - action: setFilter
        layer: p`)
    );
    expect(result.success).toBe(true);
    const unimplemented = result.warnings.filter(
      (x) => x.kind === "unimplemented" && x.path.endsWith("action")
    );
    expect(unimplemented).toHaveLength(1);
    expect(unimplemented[0].path).toContain("onChapterEnter.0");
  });
});
