/**
 * The `grid` source (ml-nb1.2, U1): a sampleable regular raster field on a
 * lat/lon grid. Its schema is closed (zod's default strip object, not marked
 * open), so a misspelt key gets the parser's did-you-mean instead of riding
 * silently to a renderer that never reads it; its enum values and `type:`
 * get the same treatment; and it validates in v1 `sources:`, inline on a
 * layer, and in a v2 document's `style.sources`.
 */
import { describe, it, expect } from "vitest";
import { GridSourceSchema, LayerSourceSchema } from "../../src/schemas/source.schema";
import { SourceV2Schema } from "../../src/schemas/map-v2.schema";
import { YAMLParser } from "../../src/parser";

const v1 = (sources: string, layers = "layers: []") => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
${sources}
${layers}
`;

const v2 = (sources: string) => `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
${sources}
  layers: []
`;

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((l) => (l === "" ? l : by + l))
    .join("\n");

/** The four encodings, each written the minimal valid way. */
const FOUR = `vectors:
  type: grid
  url: data/field-uv.png
  encoding: rg-uv
  bounds: [-180, -90, 180, 90]
  range: [-40, 40]
  units: m/s
scalar:
  type: grid
  url: data/field.png
  encoding: scalar-r
  grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 }
  range: [193, 328]
  units: K
  nodata: { channel: a, equals: 0 }
header:
  type: grid
  url: data/field.json
  encoding: nullschool-json
tiff:
  type: grid
  url: https://example.com/field.tif
  encoding: geotiff
  bands: [0, 1]
  nodata: -9999
  attribution: Example data`;

describe("GridSourceSchema accepts the four encodings", () => {
  it("rg-uv with bounds and range", () => {
    const parsed = GridSourceSchema.parse({
      type: "grid",
      url: "data/field-uv.png",
      encoding: "rg-uv",
      bounds: [-180, -90, 180, 90],
      range: [-40, 40],
    });
    expect(parsed.type).toBe("grid");
    expect(parsed.bounds).toEqual([-180, -90, 180, 90]);
  });

  it("scalar-r with node geometry; nullschool-json bare; geotiff with bands", () => {
    expect(
      GridSourceSchema.safeParse({
        type: "grid",
        url: "data/field.png",
        encoding: "scalar-r",
        grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 },
        range: [193, 328],
      }).success
    ).toBe(true);
    expect(
      GridSourceSchema.safeParse({ type: "grid", url: "data/f.json", encoding: "nullschool-json" }).success
    ).toBe(true);
    expect(
      GridSourceSchema.safeParse({
        type: "grid",
        url: "https://example.com/f.tif",
        encoding: "geotiff",
        bands: [0, 1],
        nodata: -9999,
      }).success
    ).toBe(true);
  });

  it("is a member of the v1 source union and of the v2 one (runtime: for cache/loading)", () => {
    const grid = { type: "grid", url: "data/f.png", encoding: "scalar-r", bounds: [0, 0, 1, 1], range: [0, 1] };
    expect(LayerSourceSchema.safeParse({ ...grid, cache: { ttl: 1000 } }).success).toBe(true);
    const two = SourceV2Schema.safeParse({ ...grid, runtime: { cache: { ttl: 1000 } } });
    expect(two.success).toBe(true);
  });

  it("strips unknown keys rather than keeping or rejecting them (closed, not strict)", () => {
    const parsed = GridSourceSchema.parse({
      type: "grid",
      url: "data/f.png",
      encoding: "scalar-r",
      bounds: [0, 0, 1, 1],
      range: [0, 1],
      unit: "K",
    });
    expect("unit" in parsed).toBe(false);
  });

  it("rejects an encoding outside the four", () => {
    expect(
      GridSourceSchema.safeParse({ type: "grid", url: "data/f.png", encoding: "float32" }).success
    ).toBe(false);
  });
});

describe("a grid source validates in documents", () => {
  it("v1 sources: all four encodings, zero errors and zero warnings", () => {
    const result = YAMLParser.safeParseMapBlock(v1(indent(FOUR, "  ")));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.success).toBe(true);
    const sources = (result.data as unknown as { sources: Record<string, { type: string }> }).sources;
    expect(Object.values(sources).map((s) => s.type)).toEqual(["grid", "grid", "grid", "grid"]);
  });

  it("v2 style.sources: the same four", () => {
    const result = YAMLParser.safeParseMapBlock(v2(indent(FOUR, "    ")));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("mlym validate (safeParseAny) on a grid-only v1 document: success, no warnings", () => {
    const { blockType, result } = YAMLParser.safeParseAny(v1(indent(FOUR, "  ")));
    expect(blockType).toBe("map");
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("cache: and loading: are accepted as on other sources", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  t:
    type: grid
    url: data/f.png
    encoding: scalar-r
    bounds: [0, 0, 1, 1]
    range: [0, 1]
    cache: { enabled: true, ttl: 60000 }`)
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("did-you-mean on a grid source", () => {
  it("an optional key misspelt (unit: for units:) warns with the suggestion, through the walker", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  t:
    type: grid
    url: data/f.png
    encoding: scalar-r
    bounds: [0, 0, 1, 1]
    range: [0, 1]
    unit: K`)
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "sources.t.unit",
        message: 'Unknown key "unit". Did you mean "units"?',
        suggestion: "units",
        line: 14,
      })
    );
  });

  it("a required key misspelt (encodng: for encoding:) is the error, with the suggestion", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  t:
    type: grid
    url: data/f.png
    encodng: scalar-r
    bounds: [0, 0, 1, 1]
    range: [0, 1]`)
    );
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path === "sources.t.encodng");
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/Unknown key "encodng".*did you mean "encoding"/i);
    expect(error!.suggestion).toBe("encoding");
  });

  it("encoding: rg_uv suggests rg-uv", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  t:
    type: grid
    url: data/f.png
    encoding: rg_uv
    bounds: [0, 0, 1, 1]
    range: [0, 1]`)
    );
    expect(result.success).toBe(false);
    const messages = result.errors.map((e) => e.message).join("\n");
    expect(messages).toMatch(/rg_uv/);
    expect(messages).toContain('encoding: "rg_uv" is not one of rg-uv, scalar-r, nullschool-json, geotiff.');
    expect(messages).toContain('Did you mean "rg-uv"?');
  });

  it("type: gird suggests grid through the source-type message, which now lists grid", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  t:
    type: gird
    url: data/f.png
    encoding: scalar-r`)
    );
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path === "sources.t" || e.path === "sources.t.type");
    expect(error).toBeDefined();
    expect(error!.message).toContain('Unknown source type "gird"');
    expect(error!.message).toContain("grid");
    expect(error!.message).toContain('Did you mean "grid"?');
  });

  it("the same for a v2 source: unknown key warns, bad type is named", () => {
    const warned = YAMLParser.safeParseMapBlock(
      v2(`    t:
      type: grid
      url: data/f.png
      encoding: scalar-r
      bounds: [0, 0, 1, 1]
      range: [0, 1]
      unit: K`)
    );
    expect(warned.errors).toEqual([]);
    expect(warned.warnings).toContainEqual(
      expect.objectContaining({ path: "style.sources.t.unit", suggestion: "units" })
    );
    const typed = YAMLParser.safeParseMapBlock(
      v2(`    t:
      type: gird
      url: data/f.png
      encoding: scalar-r`)
    );
    expect(typed.success).toBe(false);
    expect(typed.errors.map((e) => e.message).join("\n")).toContain('Unknown source type "gird"');
  });
});
