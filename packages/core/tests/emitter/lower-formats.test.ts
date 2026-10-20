/**
 * Cloud-native sources on emit (0.9, ml-cnv): style.json carries a URL, not
 * a decoder. PMTiles export as canonical `pmtiles://` URLs (contract);
 * FlatGeobuf and GeoParquet export as GeoJSON the CLI reads in (core
 * describes each with an `EmitDataRef`). Every emitted style must pass
 * MapLibre's own validator.
 */
import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { projectStyle, EmitError, attachSourceData } from "../../src/emitter";
import { normalizeMapBlock, toModel } from "../../src/model";
import type { V1MapInput } from "../../src/model";
import { exportClasses } from "../../src/export/registrations";
import { YAMLParser } from "../../src/parser";

const emit = (input: unknown, mode?: "strict" | "with-fallbacks") =>
  projectStyle(normalizeMapBlock(input as V1MapInput), mode);

const base = { id: "m", config: { center: [10.2, 42.15], zoom: 10 } };

describe("PMTiles", () => {
  it("the extension form is written as pmtiles://, type untouched, with a contract note", () => {
    const { style, warnings } = emit({
      ...base,
      sources: {
        tiles: { type: "vector", url: "https://x.org/a.pmtiles" },
        imagery: { type: "raster", url: "pmtiles://https://x.org/i.pmtiles", tileSize: 256 },
      },
      layers: [
        { id: "a", type: "fill", source: "tiles", "source-layer": "d" },
        { id: "i", type: "raster", source: "imagery" },
      ],
    });
    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["tiles"]).toEqual({ type: "vector", url: "pmtiles://https://x.org/a.pmtiles" });
    expect(sources["imagery"]).toEqual({ type: "raster", url: "pmtiles://https://x.org/i.pmtiles", tileSize: 256 });
    expect(warnings.filter((w) => w.construct === "format.pmtiles")).toHaveLength(2);
    expect(warnings.every((w) => w.kind === "contract")).toBe(true);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("format: never reaches style.json (and strict mode accepts it)", () => {
    const { style, warnings } = emit(
      {
        ...base,
        sources: { tiles: { type: "vector", url: "https://x.org/tiles?k=1", format: "pmtiles" } },
        layers: [{ id: "a", type: "line", source: "tiles", "source-layer": "d" }],
      },
      "strict"
    );
    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["tiles"]).toEqual({ type: "vector", url: "pmtiles://https://x.org/tiles?k=1" });
    expect(warnings).toContainEqual(expect.objectContaining({ path: "sources.tiles.format", kind: "contract" }));
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe("FlatGeobuf", () => {
  it("emits an empty GeoJSON source and describes the file for the caller to inline", () => {
    const result = emit(
      {
        ...base,
        sources: { parcels: { type: "geojson", url: "data/parcels.fgb", load: "viewport" } },
        layers: [
          { id: "p", type: "fill", source: "parcels" },
          { id: "inline", type: "circle", source: { type: "geojson", url: "https://x.org/pts.fgb" } },
        ],
      },
      "strict"
    );
    const sources = result.style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["parcels"]).toEqual({ type: "geojson", data: { type: "FeatureCollection", features: [] } });
    expect(result.data).toEqual([
      { source: "parcels", url: "data/parcels.fgb", format: "flatgeobuf" },
      { source: "inline-source", url: "https://x.org/pts.fgb", format: "flatgeobuf" },
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ construct: "format.flatgeobuf", kind: "contract", exportClass: "exports-with-fallback" })
    );
    expect(result.warnings).toContainEqual(expect.objectContaining({ path: "sources.parcels.load", kind: "contract" }));
    expect(validateStyleMin(result.style as never)).toEqual([]);

    const filled = attachSourceData(result.style, [
      { source: "parcels", data: { type: "FeatureCollection", features: [] } },
    ]);
    expect(validateStyleMin(filled as never)).toEqual([]);
  });

  it("a v2 document's runtime.format", () => {
    const parsed = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [10.2, 42.15]
  zoom: 10
  sources:
    parcels:
      type: geojson
      url: https://x.org/api/parcels
      runtime: { format: flatgeobuf }
  layers:
    - { id: p, type: fill, source: parcels }
`);
    expect(parsed.success).toBe(true);
    const result = projectStyle(toModel(parsed.data as never));
    expect(result.data).toEqual([{ source: "parcels", url: "https://x.org/api/parcels", format: "flatgeobuf" }]);
    expect(validateStyleMin(result.style as never)).toEqual([]);
  });
});

describe("GeoParquet", () => {
  it("emits an empty placeholder plus a data ref for the CLI (contract, exports-with-fallback)", () => {
    const doc = {
      ...base,
      sources: { wells: { type: "geojson", url: "data/wells.parquet" } },
      layers: [{ id: "w", type: "circle", source: "wells" }],
    };
    const { style, warnings, data } = emit(doc, "strict");
    expect(data).toEqual([{ source: "wells", url: "data/wells.parquet", format: "geoparquet" }]);
    expect((style as { sources: Record<string, unknown> }).sources["wells"]).toEqual({
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    expect(warnings).toContainEqual(
      expect.objectContaining({
        construct: "format.geoparquet",
        kind: "contract",
        exportClass: "exports-with-fallback",
      })
    );
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("an author's columns: travels on the data ref; load: and columns: never reach the style", () => {
    const parsed = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [10.2, 42.15]
  zoom: 10
  sources:
    wells:
      type: geojson
      url: https://x.org/api/wells
      runtime: { format: geoparquet, columns: [kind, depth_m], load: viewport }
  layers:
    - { id: w, type: circle, source: wells }
`);
    expect(parsed.success).toBe(true);
    const result = projectStyle(toModel(parsed.data as never));
    expect(result.data).toEqual([
      { source: "wells", url: "https://x.org/api/wells", format: "geoparquet", columns: ["kind", "depth_m"] },
    ]);
    expect(JSON.stringify(result.style)).not.toMatch(/"columns"|"load"|"format"/);
    expect(result.warnings.map((w) => w.construct)).toEqual(
      expect.arrayContaining(["format.geoparquet", "source.columns", "source.load"])
    );
    expect(validateStyleMin(result.style as never)).toEqual([]);
  });
});

describe("COG (ml-cnv.2)", () => {
  it("writes cog:// URLs the way the renderer does: #dem, #color:, tileSize 256 (contract)", () => {
    const parsed = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 10
  mapStyle: https://x.org/style.json
sources:
  imagery: { type: raster, url: data/imagery.tif }
  elevation: { type: raster-dem, url: data/elevation.tif }
  ndvi:
    type: raster
    url: https://x.org/ndvi.tif
    colorRamp: { palette: viridis, min: 0, max: 1, classes: 3 }
  own:
    type: raster
    url: "cog://data/t.tif#color:BrewerSpectral9,-5,35,c"
    tileSize: 512
layers:
  - { id: i, type: raster, source: imagery }
  - { id: h, type: hillshade, source: elevation }
  - { id: n, type: raster, source: ndvi }
  - { id: o, type: raster, source: own }
`);
    expect(parsed.success).toBe(true);
    const { style, warnings } = projectStyle(normalizeMapBlock(parsed.data as never), "strict");
    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["imagery"]).toEqual({ type: "raster", url: "cog://data/imagery.tif", tileSize: 256 });
    expect(sources["elevation"]).toEqual({
      type: "raster-dem",
      url: "cog://data/elevation.tif#dem",
      tileSize: 256,
      encoding: "mapbox",
    });
    expect(sources["ndvi"]).toEqual({
      type: "raster",
      url: 'cog://https://x.org/ndvi.tif#color:["#440154","#21918c","#fde725"],0,1',
      tileSize: 256,
    });
    // An authored fragment and tileSize are the author's.
    expect(sources["own"]).toEqual({
      type: "raster",
      url: "cog://data/t.tif#color:BrewerSpectral9,-5,35,c",
      tileSize: 512,
    });
    expect(warnings.filter((w) => w.construct === "format.cog")).toHaveLength(4);
    expect(warnings).toContainEqual(
      expect.objectContaining({ path: "sources.ndvi.colorRamp", kind: "contract", construct: "source.colorRamp" })
    );
    expect(warnings.every((w) => w.kind === "contract")).toBe(true);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("a v2 document's runtime.colorRamp", () => {
    const parsed = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [10.2, 42.15]
  zoom: 10
  sources:
    ndvi:
      type: raster
      url: data/ndvi.tif
      runtime: { colorRamp: { colors: ["#000", "#fff"], min: -1, max: 1, reverse: true } }
  layers:
    - { id: n, type: raster, source: ndvi }
`);
    expect(parsed.success).toBe(true);
    const { style } = projectStyle(toModel(parsed.data as never));
    expect((style["sources"] as Record<string, unknown>)["ndvi"]).toEqual({
      type: "raster",
      url: 'cog://data/ndvi.tif#color:["#000000","#ffffff"],-1,1,c-',
      tileSize: 256,
    });
  });
});

describe("registrations", () => {
  it("declare each format's export class", () => {
    expect(exportClasses.require("format.pmtiles").class).toBe("exports");
    expect(exportClasses.require("format.flatgeobuf").class).toBe("exports-with-fallback");
    expect(exportClasses.require("format.cog").class).toBe("exports");
    expect(exportClasses.require("format.geoparquet").class).toBe("exports-with-fallback");
    expect(exportClasses.require("source.format").class).toBe("exports");
    expect(exportClasses.require("source.load").class).toBe("no-export");
    expect(exportClasses.require("source.columns").class).toBe("no-export");
    expect(exportClasses.require("source.colorRamp").class).toBe("exports");
  });

  it("the flatgeobuf export() hook shares the projection's lowering", () => {
    const lowering = exportClasses.require("format.flatgeobuf").export!({
      value: { id: "p", spec: { type: "geojson", url: "p.fgb" } },
      path: "sources.p",
    });
    expect(lowering.sources).toEqual({ p: { type: "geojson", data: { type: "FeatureCollection", features: [] } } });
  });
});
