/**
 * Cloud-native sources on emit (0.9, ml-cnv): style.json carries a URL, not
 * a decoder. PMTiles export as canonical `pmtiles://` URLs (contract);
 * FlatGeobuf exports as GeoJSON the CLI reads in (core describes it with an
 * `EmitDataRef`); GeoParquet, not read yet, exports empty (lossy). Every
 * emitted style must pass MapLibre's own validator.
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

describe("GeoParquet (not read yet)", () => {
  it("emits empty, lossy — so --strict refuses", () => {
    const doc = {
      ...base,
      sources: { wells: { type: "geojson", url: "data/wells.parquet" } },
      layers: [{ id: "w", type: "circle", source: "wells" }],
    };
    expect(() => emit(doc, "strict")).toThrow(EmitError);
    const { style, warnings } = emit(doc);
    expect(warnings).toContainEqual(expect.objectContaining({ construct: "format.geoparquet", kind: "lossy" }));
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe("registrations", () => {
  it("declare each format's export class", () => {
    expect(exportClasses.require("format.pmtiles").class).toBe("exports");
    expect(exportClasses.require("format.flatgeobuf").class).toBe("exports-with-fallback");
    expect(exportClasses.require("format.cog").class).toBe("exports");
    expect(exportClasses.require("format.geoparquet").class).toBe("no-export");
    expect(exportClasses.require("source.format").class).toBe("exports");
    expect(exportClasses.require("source.load").class).toBe("no-export");
  });

  it("the flatgeobuf export() hook shares the projection's lowering", () => {
    const lowering = exportClasses.require("format.flatgeobuf").export!({
      value: { id: "p", spec: { type: "geojson", url: "p.fgb" } },
      path: "sources.p",
    });
    expect(lowering.sources).toEqual({ p: { type: "geojson", data: { type: "FeatureCollection", features: [] } } });
  });
});
