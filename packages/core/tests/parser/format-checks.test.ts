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
    ["geoparquet", "Keep the url: and set type: geojson — the .parquet (or .geoparquet) file name tells maplibre-yaml to read it as GeoParquet"],
    ["parquet", "Keep the url: and set type: geojson — the .parquet (or .geoparquet) file name tells maplibre-yaml to read it as GeoParquet"],
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
      expect.objectContaining({
        path: "sources.a.load",
        message: expect.stringContaining("only applies to FlatGeobuf and GeoParquet"),
      })
    );
  });

  it("applies to GeoParquet, flat in v1 and under runtime: in v2", () => {
    const flat = v1(`  a:\n    type: geojson\n    url: data/a.parquet\n    load: { mode: viewport, minzoom: 12 }`);
    expect(flat.errors).toEqual([]);
    expect(flat.warnings).toEqual([]);
    const nested = v2(`    a:
      type: geojson
      url: https://example.com/api/wells
      runtime:
        format: geoparquet
        load: viewport
        columns: [kind, depth_m]`);
    expect(nested.errors).toEqual([]);
    expect(nested.warnings).toEqual([]);
  });

  it("rejects an unknown mode", () => {
    const result = v1(`  a:\n    type: geojson\n    url: data/a.fgb\n    load: lazy`);
    expect(result.success).toBe(false);
  });
});

describe("columns:", () => {
  it("a list or all on a GeoParquet source", () => {
    for (const columns of ["[name, depth_m]", "all"]) {
      const result = v1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: ${columns}`);
      expect(result.errors, columns).toEqual([]);
      expect(result.warnings, columns).toEqual([]);
    }
  });

  it("warns where it does nothing", () => {
    const result = v1(`  a:\n    type: geojson\n    url: data/a.fgb\n    columns: [name]`);
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: "sources.a.columns", message: expect.stringContaining("only applies to GeoParquet") })
    );
  });

  it("a list that leaves out a property the map uses warns, naming each one (ml-aot.117)", () => {
    const result = v1(
      `  t:\n    type: geojson\n    url: data/tracts.parquet\n    columns: [tract]`,
      `layers:
  - id: t
    type: fill
    source: t
    paint: { fill-color: "#ccc" }
    interactive:
      click:
        popup:
          - h3: [{ property: tract }]
          - p: [{ str: "Population: " }, { property: population }]
  - id: labels
    type: symbol
    source: t
    layout: { text-field: "{ Tract Name }" }
  - id: inline
    type: circle
    source: { type: geojson, url: data/wells.parquet, columns: [id] }
    filter: [">", ["get", "depth"], 10]`
    );
    expect(result.success).toBe(true);
    const at = (path: string) => result.warnings.filter((w) => w.path === path);
    expect(at("sources.t.columns")).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('columns: leaves out "Tract Name", "population", which this map uses'),
        line: 11,
      }),
    ]);
    expect(at("layers.2.source.columns")[0]?.message).toContain('leaves out "depth"');
  });

  it("…and counts a story chapter's actions; a complete list, all, or no list doesn't warn", () => {
    const parquet = `  w:\n    type: geojson\n    url: data/w.parquet\n    columns: [kind]`;
    const doc = (sources: string) =>
      YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config: { center: [10.2, 42.15], zoom: 9, mapStyle: https://example.com/style.json }
sources:
${sources}
layers:
  - { id: w, type: circle, source: w, paint: { circle-color: ["get", "kind"] } }
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
    onChapterEnter:
      - { action: setFilter, layer: w, filter: [">=", ["get", "value"], 50] }
`);
    expect(doc(parquet).warnings.find((w) => w.path === "sources.w.columns")?.message).toContain('leaves out "value"');
    for (const columns of ["[kind, value]", "all"]) {
      expect(doc(parquet.replace("[kind]", columns)).warnings.filter((w) => w.path === "sources.w.columns")).toEqual([]);
    }
    expect(doc(parquet.replace("\n    columns: [kind]", "")).warnings).toEqual([]);
  });

  it("rejects an empty list and a bare word other than all", () => {
    expect(v1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: []`).success).toBe(false);
    expect(v1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: some`).success).toBe(false);
  });
});

describe("format: geoparquet", () => {
  it("format: parquet gets the format name", () => {
    const result = v1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: parquet`);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join("\n")).toMatch(/Did you mean "geoparquet"\?/);
  });

  it("a GeoParquet file on a tile source is an error with the fix", () => {
    const result = v1(`  p:\n    type: vector\n    url: data/wells.parquet`);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.p.type",
        message: '"data/wells.parquet" is a GeoParquet file: it holds features, not tiles. Use type: geojson.',
      })
    );
  });

  it("refresh: / stream: are refused, in v1 and v2", () => {
    const flat = v1(`  a:
    type: geojson
    url: data/a.parquet
    refresh: { refreshInterval: 5000 }`);
    expect(flat.success).toBe(false);
    expect(flat.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.a.refresh",
        message:
          "refresh: live data isn't available for GeoParquet sources yet. Remove it, or serve the data as GeoJSON for live updates.",
      })
    );
    const nested = v2(`    a:
      type: geojson
      url: data/a.parquet
      runtime:
        stream: { type: sse, url: https://example.com/s }`);
    expect(nested.success).toBe(false);
    expect(nested.errors.map((e) => e.path)).toContain("style.sources.a.runtime.stream");
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

describe("GeoParquet and COG are both read: neither is reported as 'not yet'", () => {
  it("both validate clean", () => {
    const result = v1(`  wells:
    type: geojson
    url: data/wells.parquet
  also:
    type: geojson
    url: data/wells.geoparquet
  scene:
    type: raster
    url: data/scene.tif`);
    expect(result.success).toBe(true);
    const messages = result.warnings.map((w) => w.message).join("\n");
    expect(messages).not.toContain("GeoParquet");
    expect(messages).not.toContain("scene.tif");
    expect(messages).not.toMatch(/not supported yet|can't read/);
    expect(result.warnings).toHaveLength(0);
  });

  it("format: geoparquet / cog validate", () => {
    expect(v1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: geoparquet`).success).toBe(true);
    expect(v1(`  a:\n    type: raster\n    url: https://x.org/a\n    format: cog`).success).toBe(true);
  });
});

describe("load: maxFeatures — the per-view budget (ml-37r.17)", () => {
  it("accepts a positive whole number, flat (v1) and under runtime: (v2)", () => {
    const flat = v1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { mode: viewport, minzoom: 12, maxFeatures: 50000 }`);
    expect(flat.errors).toEqual([]);
    expect(flat.warnings).toEqual([]);
    const nested = v2(`    lots:
      type: geojson
      url: data/lots.fgb
      runtime:
        load: { mode: viewport, maxFeatures: 20000 }`);
    expect(nested.errors).toEqual([]);
  });

  it.each([
    ["0", "Value must be >= 1"],
    ["-5", "Value must be >= 1"],
    ["1.5", "Expected integer"],
  ])("refuses maxFeatures: %s", (value, message) => {
    const result = v1(`  lots:
    type: geojson
    url: data/lots.fgb
    load: { mode: viewport, maxFeatures: ${value} }`);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({ path: "sources.lots.load.maxFeatures" });
    expect(result.errors[0]!.message).toContain(message);
  });

  it("refuses a maxFeatures that isn't a number", () => {
    const result = v1(`  lots:
    type: geojson
    url: data/lots.fgb
    load: { mode: viewport, maxFeatures: lots }`);
    expect(result.success).toBe(false);
  });
});
