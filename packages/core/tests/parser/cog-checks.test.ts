/**
 * COG sources at validation time (0.9, ml-cnv.2): `colorRamp:` (palette
 * names as in `classify:`, with did-you-mean), the fix-its for a COG on the
 * wrong source type, and the parsed document's `tileSize: 256` for a COG
 * whose author didn't write one — in v1, v2 and story documents.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

const v1 = (sources: string) =>
  YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
layers: []
`);

const v2 = (sources: string) =>
  YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [10.2, 42.15]
  zoom: 9
  sources:
${sources}
  layers: []
`);

const story = (sources: string) =>
  YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
layers: []
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
`);

type Sources = Record<string, Record<string, unknown>>;
const sourcesOf = (r: ReturnType<typeof v1>) => (r.data as unknown as { sources: Sources }).sources;

describe("a COG source validates, with tileSize 256 unless the author wrote one", () => {
  it("v1: imagery, elevation, colorRamp; an authored tileSize is kept", () => {
    const result = v1(`  imagery: { type: raster, url: data/imagery.tif }
  elevation: { type: raster-dem, url: "cog://data/elevation.tif" }
  ndvi:
    type: raster
    url: data/ndvi.tif
    colorRamp: { palette: YlGn, min: 0, max: 0.9 }
  big: { type: raster, url: data/big.tif, tileSize: 512 }
  plain: { type: raster, url: https://tiles.example.com/tiles.json }`);
    expect(result.errors).toEqual([]);
    // An authored tileSize is kept — with a note that the reader draws 256 (ml-cnv.17).
    expect(result.warnings.map((w) => w.path)).toEqual(["sources.big.tileSize"]);
    const s = sourcesOf(result);
    expect(s["imagery"]!["tileSize"]).toBe(256);
    expect(s["elevation"]!["tileSize"]).toBe(256);
    expect(s["ndvi"]!["tileSize"]).toBe(256);
    expect(s["big"]!["tileSize"]).toBe(512);
    // Not a COG: the schema's default stands.
    expect(s["plain"]!["tileSize"]).toBe(512);
  });

  it("v2 (colorRamp under runtime:) and stories", () => {
    const two = v2(`    ndvi:
      type: raster
      url: data/ndvi.tif
      runtime:
        colorRamp: { palette: viridis, min: 0, max: 1 }`);
    expect(two.errors).toEqual([]);
    expect(two.warnings).toEqual([]);
    expect(
      (two.data as unknown as { style: { sources: Sources } }).style.sources["ndvi"]!["tileSize"]
    ).toBe(256);
    const s = story(`  dem: { type: raster-dem, url: data/dem.tiff }`);
    expect(s.errors).toEqual([]);
    expect((s.data as unknown as { sources: Sources }).sources["dem"]!["tileSize"]).toBe(256);
  });
});

describe("colorRamp mistakes", () => {
  it("a misspelt palette gets a did-you-mean, at its line", () => {
    const result = v1(`  ndvi:
    type: raster
    url: data/ndvi.tif
    colorRamp: { palette: virdis, min: 0, max: 1 }`);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.ndvi.colorRamp.palette",
        suggestion: "viridis",
        message: expect.stringContaining('"virdis" isn\'t a palette name — did you mean "viridis"?'),
        line: 11,
      })
    );
  });

  it("colours that aren't hex, min not below max, too many classes, palette and colors together", () => {
    const result = v1(`  a:
    type: raster
    url: a.tif
    colorRamp: { colors: ["#000", red], min: 1, max: 0 }
  b:
    type: raster
    url: b.tif
    colorRamp: { palette: Blues, classes: 12, min: 0, max: 1 }
  c:
    type: raster
    url: c.tif
    colorRamp: { palette: Blues, colors: ["#000", "#fff"], min: 0, max: 1 }`);
    const messages = result.errors.map((e) => `${e.path}: ${e.message}`);
    expect(messages).toContain('sources.a.colorRamp.colors.1: colorRamp colours are written #rrggbb (or #rgb); "red" isn\'t.');
    expect(messages).toContain(
      "sources.a.colorRamp.max: colorRamp: max (0) must be greater than min (1). To run the colours from high " +
        "values to low, keep min below max and add reverse: true."
    );
    expect(messages).toContain("sources.b.colorRamp.classes: Blues has at most 9 classes; colorRamp asks for 12.");
    expect(messages).toContain("sources.c.colorRamp.colors: colorRamp: takes palette: or colors:, not both.");
  });

  it("a qualitative palette as a smooth ramp, and a tileSize the reader doesn't draw, are warned about (ml-cnv.17)", () => {
    const result = v1(`  a:
    type: raster
    url: a.tif
    colorRamp: { palette: okabe-ito, min: 0, max: 1 }
  b:
    type: raster
    url: b.tif
    colorRamp: { palette: Set1, classes: 5, min: 0, max: 1 }
  c:
    type: raster
    url: c.tif
    tileSize: 512
    colorRamp: { palette: viridis, min: 0, max: 1 }`);
    expect(result.success).toBe(true);
    const warnings = result.warnings.map((w) => `${w.path}: ${w.message}`);
    expect(warnings).toContainEqual(
      expect.stringContaining("sources.a.colorRamp.palette: okabe-ito is a qualitative palette")
    );
    // Flat classes keep a qualitative palette's colours apart: no warning.
    expect(warnings.some((w) => w.startsWith("sources.b."))).toBe(false);
    expect(warnings).toContainEqual(
      expect.stringContaining("sources.c.tileSize: tileSize: 512 on a COG: the COG reader draws 256-pixel tiles")
    );
    expect(warnings.some((w) => w.startsWith("sources.a.tileSize"))).toBe(false);
  });

  it("min and max are required (the schema says so)", () => {
    const result = v1(`  a: { type: raster, url: a.tif, colorRamp: { palette: viridis } }`);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join("\n")).toContain(
      "colorRamp is missing min: (required; expected a number)."
    );
  });

  it("warnings: on elevation, on a source that isn't a COG, beside a hand-written fragment", () => {
    const result = v1(`  dem:
    type: raster-dem
    url: dem.tif
    colorRamp: { min: 0, max: 1 }
  tiles:
    type: raster
    url: https://tiles.example.com/tiles.json
    colorRamp: { min: 0, max: 1 }
  both:
    type: raster
    url: "t.tif#color:CartoEarth,1,100"
    colorRamp: { min: 0, max: 1 }`);
    expect(result.success).toBe(true);
    const warnings = result.warnings.map((w) => `${w.path}: ${w.message}`);
    expect(warnings).toContainEqual(expect.stringContaining("sources.dem.colorRamp: colorRamp: does nothing on a raster-dem"));
    expect(warnings).toContainEqual(
      expect.stringContaining("sources.tiles.colorRamp: colorRamp: only colours a Cloud Optimized GeoTIFF")
    );
    expect(warnings).toContainEqual(expect.stringContaining("sources.both.url: This URL already has a #… fragment"));
    // The specific warning replaces the generic unknown-key one.
    expect(warnings.filter((w) => w.startsWith("sources.dem.colorRamp"))).toHaveLength(1);
  });

  it("encoding: terrarium on a COG elevation source warns (the reader writes mapbox)", () => {
    const result = v1(`  dem: { type: raster-dem, url: dem.tif, encoding: terrarium }`);
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => w.message)).toContainEqual(
      expect.stringContaining("encoding: terrarium has no effect on a COG")
    );
  });
});

describe("a COG on the wrong source type gets the fix", () => {
  it("type: cog / geotiff / tif → keep the url, use raster", () => {
    for (const word of ["cog", "geotiff", "tif"]) {
      const result = v1(`  a: { type: ${word}, url: a.tif }`);
      expect(result.success, word).toBe(false);
      expect(result.errors.map((e) => e.message).join("\n")).toContain(
        "is a file format, not a source type. Keep the url: and set type: raster (or raster-dem for elevation)"
      );
    }
  });

  it("a .tif on a geojson source is an error", () => {
    const result = v1(`  a: { type: geojson, url: data/a.tif }`);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.a.type",
        message: '"data/a.tif" is a GeoTIFF: an image, not GeoJSON features. Use type: raster (or raster-dem for elevation).',
      })
    );
  });
});
