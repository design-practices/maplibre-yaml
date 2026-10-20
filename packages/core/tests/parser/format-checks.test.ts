/**
 * Cloud-native sources at validation time (0.9, ml-cnv): the authoring rule
 * is `type:` = what MapLibre draws, the URL (or `format:`) = what the file
 * is. Everything here is static — `mlym validate`, the Astro loader and the
 * browser all say the same — and works in v1, v2 and story documents.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

const v1 = (sources: string, layers = "layers: []") =>
  YAMLParser.safeParseMapBlock(
    `type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
${layers}
`
  );

const v2 = (sources: string) =>
  YAMLParser.safeParseMapBlock(
    `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [10.2, 42.15]
  zoom: 9
  sources:
${sources}
  layers: []
`
  );

const story = (sources: string) =>
  YAMLParser.safeParseScrollytellingBlock(
    `type: scrollytelling
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
`
  );

describe("valid cloud-native sources", () => {
  it("v1: PMTiles (extension and scheme), FlatGeobuf, format: and load:", () => {
    const result = v1(`  tiles:
    type: vector
    url: data/buildings.pmtiles
  scheme:
    type: raster
    url: pmtiles://https://example.com/imagery.pmtiles
    tileSize: 256
  dem:
    type: raster-dem
    url: data/terrain.pmtiles
    encoding: terrarium
  parcels:
    type: geojson
    url: data/parcels.fgb
  api:
    type: geojson
    url: https://example.com/api/parcels?f=fgb
    format: flatgeobuf
    load: { mode: viewport, minzoom: 14 }`);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("v2: format and load sit under the source's runtime:", () => {
    const result = v2(`    tiles: { type: vector, url: "pmtiles://data/a.pmtiles" }
    parcels:
      type: geojson
      url: https://example.com/api/parcels
      runtime:
        format: flatgeobuf
        load: viewport`);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("stories read them too", () => {
    const result = story(`  tiles: { type: vector, url: data/a.pmtiles }
  parcels: { type: geojson, url: data/p.fgb }`);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});

describe("type: <a file format> is an error with the fix", () => {
  it.each([
    ["pmtiles", 'Keep the url: and set type: vector (or raster / raster-dem for image or elevation tiles)'],
    ["flatgeobuf", "Keep the url: and set type: geojson"],
    ["fgb", "Keep the url: and set type: geojson"],
    ["geoparquet", "GeoParquet files are read with type: geojson. This version of maplibre-yaml can't read GeoParquet yet"],
    ["cog", "Keep the url: and set type: raster (or raster-dem for elevation)"],
    ["mbtiles", "Convert it to PMTiles (pmtiles convert in.mbtiles out.pmtiles)"],
  ])("type: %s", (word, fix) => {
    const result = v1(`  data:
    type: ${word}
    url: data/x.${word}`);
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.message.includes("is a file format"));
    expect(error, JSON.stringify(result.errors)).toBeDefined();
    expect(error!.message).toContain(`"${word}" is a file format`);
    expect(error!.message).toContain(fix);
    expect(error!.line).toBeDefined();
  });

  it("in v2 and in stories as well", () => {
    for (const result of [
      v2(`    data: { type: pmtiles, url: data/x.pmtiles }`),
      story(`  data: { type: pmtiles, url: data/x.pmtiles }`),
    ]) {
      expect(result.success).toBe(false);
      expect(result.errors.map((e) => e.message).join("\n")).toContain('"pmtiles" is a file format, not a source type');
    }
  });

  it("an inline layer source too", () => {
    const result = v1("  {}", `layers:
  - id: a
    type: fill
    source: { type: flatgeobuf, url: data/p.fgb }`);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join("\n")).toContain('"flatgeobuf" is a file format');
  });
});

describe("a format on a source type that can't draw it", () => {
  it("FlatGeobuf on a tile source", () => {
    const result = v1(`  p:
    type: vector
    url: data/parcels.fgb`);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.p.type",
        message: '"data/parcels.fgb" is a FlatGeobuf file: it holds features, not tiles. Use type: geojson.',
      })
    );
  });

  it("PMTiles on a geojson source (scheme, extension or format:)", () => {
    for (const source of [
      "    type: geojson\n    url: data/a.pmtiles",
      "    type: geojson\n    url: pmtiles://https://x.org/a",
      "    type: geojson\n    url: https://x.org/a\n    format: pmtiles",
    ]) {
      const result = v1(`  a:\n${source}`);
      expect(result.success, source).toBe(false);
      expect(result.errors.map((e) => e.message).join("\n")).toContain(
        "is a PMTiles archive: it holds tiles, not GeoJSON features. Use type: vector"
      );
    }
  });

  it("a GeoTIFF on a geojson source", () => {
    const result = v1(`  a:\n    type: geojson\n    url: data/scene.tif`);
    expect(result.errors.map((e) => e.message).join("\n")).toContain("is a GeoTIFF: an image, not GeoJSON features");
  });
});

describe("format:", () => {
  it("an unknown value gets a did-you-mean", () => {
    const result = v1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: flatgeobuff`);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/Did you mean "flatgeobuf"\?/);
  });

  it("the file extension as a value gets the format name", () => {
    const result = v1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: fgb`);
    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/Did you mean "flatgeobuf"\?/);
  });

  it("disagreeing with the URL warns, and format: wins", () => {
    const result = v1(`  a:\n    type: vector\n    url: data/a.fgb\n    format: pmtiles`);
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "sources.a.format",
        message:
          "format: pmtiles, but the URL looks like a FlatGeobuf file; the source is read as PMTiles (format: wins).",
      })
    );
  });
});

describe("load:", () => {
  it("warns where it does nothing", () => {
    const result = v1(`  a:\n    type: geojson\n    url: data/a.geojson\n    load: viewport`);
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: "sources.a.load", message: expect.stringContaining("only applies to FlatGeobuf") })
    );
  });

  it("rejects an unknown mode", () => {
    const result = v1(`  a:\n    type: geojson\n    url: data/a.fgb\n    load: lazy`);
    expect(result.success).toBe(false);
  });
});

describe("live data on FlatGeobuf is not available in 0.9", () => {
  it("v1 refresh:", () => {
    const result = v1(`  a:
    type: geojson
    url: data/a.fgb
    refresh: { refreshInterval: 5000 }`);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.a.refresh",
        message:
          "refresh: live data isn't available for FlatGeobuf sources yet. Remove it, or serve the data as GeoJSON for live updates.",
      })
    );
  });

  it("v2 runtime.refresh:", () => {
    const result = v2(`    a:
      type: geojson
      url: data/a.fgb
      runtime:
        refresh: { refreshInterval: 5000 }`);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain("style.sources.a.runtime.refresh");
  });
});

describe("GeoParquet is reserved: recognized, not read yet (COG is read since ml-cnv.2)", () => {
  it("warns (not an error: the rest of the map still renders)", () => {
    const result = v1(`  wells:
    type: geojson
    url: data/wells.parquet
  scene:
    type: raster
    url: data/scene.tif`);
    expect(result.success).toBe(true);
    const messages = result.warnings.map((w) => w.message).join("\n");
    expect(messages).toContain(
      '"data/wells.parquet" is a GeoParquet file. This version of maplibre-yaml can\'t read GeoParquet yet (it\'s planned)'
    );
    // A COG is read now: no "not yet" warning for it.
    expect(messages).not.toContain("scene.tif");
    expect(result.warnings.every((w) => w.kind === "unimplemented")).toBe(true);
  });

  it("format: geoparquet / cog validate", () => {
    expect(v1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: geoparquet`).success).toBe(true);
    expect(v1(`  a:\n    type: raster\n    url: https://x.org/a\n    format: cog`).success).toBe(true);
  });
});
