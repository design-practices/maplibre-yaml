/**
 * @file `config:` map options MapLibre 6.13–6.18 added or reshaped (ml-vwz)
 * @module @maplibre-yaml/core/tests/parser
 *
 * @description
 * The YAML surface mirrors MapLibre's own shapes:
 *
 * - `dragRotate` takes `true | false`, `{ around: pointer }` or
 *   `{ around: center, movement: circular | linear }` (6.15, `DragRotateOptions`).
 * - `maxBounds` may leave longitude open with `-.inf` west and `.inf` east
 *   together, `[-.inf, south, .inf, north]` (6.16, `setMaxBounds`: "Use
 *   `-Infinity` and `Infinity` for an unconstrained longitude range, with
 *   finite latitude limits"). A half-open longitude or an open latitude is
 *   explained in MapLibre's words; `bounds` (the initial fit) stays finite.
 * - `transformStyle` and `globalState` are `MapOptions` (6.16 / 6.14), so a
 *   host's config object no longer draws an "Unknown key" warning; but
 *   `globalState` under `config:` is told that `state:` is the place.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { MapConfigSchema } from "../../src/schemas/map.schema";
import { MAPLIBRE_MAP_OPTIONS } from "../../src/parser/document-checks";
import { boundsProblem, toFlatBounds } from "../../src/utils/bounds";

const STYLE = '"https://demotiles.maplibre.org/style.json"';
const v1 = (extra: string) => `type: map
id: m
config:
  center: [-73.97, 40.72]
  zoom: 2
${extra}
  mapStyle: ${STYLE}
layers: []
`;
const v2 = (extra: string) => `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  basemap: ${STYLE}
  sources: {}
  layers: []
runtime:
  map:
${extra}
`;
const parse = (doc: string) => YAMLParser.safeParseMapBlock(doc);
const config = (extra: Record<string, unknown>) =>
  MapConfigSchema.safeParse({ center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json", ...extra });

describe("dragRotate: boolean or DragRotateOptions (6.15)", () => {
  it("accepts both booleans and both option objects, as MapLibre spells them", () => {
    for (const value of [true, false, { around: "pointer" }, { around: "center" }, { around: "center", movement: "linear" }, { around: "center", movement: "circular" }]) {
      const result = config({ dragRotate: value });
      expect(result.success, JSON.stringify(value)).toBe(true);
      if (result.success) expect(result.data.dragRotate).toEqual(value);
    }
  });

  it("rejects values MapLibre does not take: an unknown around, movement with pointer, extra keys, a string", () => {
    for (const value of [{ around: "centre" }, { around: "pointer", movement: "linear" }, { around: "center", speed: 2 }, "pointer", { movement: "linear" }]) {
      expect(config({ dragRotate: value }).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("parses from YAML in a v1 config: and a v2 runtime.map:", () => {
    const flat = parse(v1("  dragRotate: { around: pointer }"));
    expect(flat.errors).toEqual([]);
    expect(flat.success).toBe(true);
    const nested = parse(v1("  dragRotate:\n    around: center\n    movement: linear"));
    expect(nested.success).toBe(true);
    expect(parse(v2("    dragRotate: { around: pointer }")).success).toBe(true);
  });
});

describe("maxBounds with an open longitude (6.16)", () => {
  it("accepts -.inf west and .inf east together, in both bounds forms, in v1 and v2", () => {
    for (const value of ["[-.inf, 40.5, .inf, 40.9]", "[[-.inf, 40.5], [.inf, 40.9]]"]) {
      const result = parse(v1(`  maxBounds: ${value}`));
      expect(result.errors, value).toEqual([]);
      expect(result.success).toBe(true);
      expect(parse(v2(`    maxBounds: ${value}`)).success, value).toBe(true);
    }
    const parsed = parse(v1("  maxBounds: [-.inf, 40.5, .inf, 40.9]"));
    expect((parsed.data as any).config.maxBounds).toEqual([-Infinity, 40.5, Infinity, 40.9]);
  });

  it("a half-open longitude is explained in MapLibre's words, at the maxBounds line", () => {
    const result = parse(v1("  maxBounds: [-.inf, 40.5, -73.7, 40.9]"));
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => [e.path, e.line])).toEqual([["config.maxBounds", 6]]);
    expect(result.errors[0]!.message).toContain("must either be finite or span from -Infinity to Infinity");
    expect(result.errors[0]!.message).toContain("-.inf");
  });

  it("an open latitude is refused: the latitude limits stay finite", () => {
    const result = parse(v1("  maxBounds: [-.inf, -.inf, .inf, .inf]"));
    expect(result.success).toBe(false);
    expect(result.errors[0]!.path).toBe("config.maxBounds");
    expect(result.errors[0]!.message).toContain("latitude");
  });

  it("bounds (the initial fit) stays finite: an open longitude there says maxBounds is the key that takes it", () => {
    const result = parse(v1("  bounds: [-.inf, 40.5, .inf, 40.9]"));
    expect(result.success).toBe(false);
    expect(result.errors[0]!.path).toBe("config.bounds");
    expect(result.errors[0]!.message).toContain("maxBounds");
  });

  it("the schema alone agrees", () => {
    expect(config({ maxBounds: [-Infinity, 40.5, Infinity, 40.9] }).success).toBe(true);
    expect(config({ maxBounds: [[-Infinity, 40.5], [Infinity, 40.9]] }).success).toBe(true);
    expect(config({ maxBounds: [-Infinity, 40.5, 10, 40.9] }).success).toBe(false);
    expect(config({ maxBounds: [-Infinity, -Infinity, Infinity, Infinity] }).success).toBe(false);
    expect(config({ bounds: [-Infinity, 40.5, Infinity, 40.9] }).success).toBe(false);
  });

  it("the bounds helpers read the open form only when asked", () => {
    expect(toFlatBounds([-Infinity, 40.5, Infinity, 40.9])).toBeNull();
    expect(toFlatBounds([-Infinity, 40.5, Infinity, 40.9], { openLongitude: true })).toEqual([-Infinity, 40.5, Infinity, 40.9]);
    expect(toFlatBounds([[-Infinity, 40.5], [Infinity, 40.9]], { openLongitude: true })).toEqual([-Infinity, 40.5, Infinity, 40.9]);
    expect(toFlatBounds([-Infinity, 40.5, 10, 40.9], { openLongitude: true })).toBeNull();
    expect(boundsProblem([-Infinity, 40.5, Infinity, 40.9], "maxBounds")).toBeUndefined();
    expect(boundsProblem([[-Infinity, 40.5], [Infinity, 40.9]], "maxBounds")).toBeUndefined();
    expect(boundsProblem([-Infinity, 40.5, 10, 40.9], "maxBounds")).toContain("must either be finite");
    expect(boundsProblem([-Infinity, 40.5, Infinity, 40.9], "bounds")).toContain("maxBounds");
  });
});

describe("MapOptions names a host passes through config: (transformStyle, globalState)", () => {
  it("are known map options, so they draw no Unknown key warning", () => {
    expect(MAPLIBRE_MAP_OPTIONS.has("transformStyle")).toBe(true);
    expect(MAPLIBRE_MAP_OPTIONS.has("globalState")).toBe(true);
    const result = parse(v1("  transformStyle: null"));
    expect(result.warnings.filter((w) => w.message.includes("Unknown key"))).toEqual([]);
  });

  it("config.globalState warns that state: is the place (one source of truth), not Unknown key", () => {
    const result = parse(v1("  globalState: { year: 2010 }"));
    expect(result.success).toBe(true);
    const warning = result.warnings.find((w) => w.path === "config.globalState");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("state:");
    expect(warning!.line).toBe(6);
    expect(result.warnings.filter((w) => w.message.includes("Unknown key"))).toEqual([]);
  });

  it("v2 runtime.map.globalState warns the same way", () => {
    const result = parse(v2("    globalState: { year: 2010 }"));
    expect(result.success).toBe(true);
    const warning = result.warnings.find((w) => w.path === "runtime.map.globalState");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("state:");
  });
});
