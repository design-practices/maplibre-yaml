/**
 * Format detection (0.9, ml-cnv): `type:` stays the MapLibre source type;
 * the URL's scheme or extension (or `format:`) says what the file is.
 */
import { describe, it, expect } from "vitest";
import {
  formatFromUrl,
  formatOfSource,
  formatsIn,
  formatNamedAsType,
  typeReadsFormat,
  stripScheme,
  SUPPORTED_FORMATS,
} from "../../src/formats/detect";

describe("formatFromUrl", () => {
  it.each([
    ["pmtiles://https://x.org/a.pmtiles", "pmtiles"],
    ["pmtiles://data/a.pmtiles", "pmtiles"],
    ["PMTILES://data/a", "pmtiles"],
    ["data/buildings.pmtiles", "pmtiles"],
    ["/data/buildings.PMTiles?v=3#x", "pmtiles"],
    ["https://x.org/parcels.fgb", "flatgeobuf"],
    ["data/parcels.fgb?token=abc", "flatgeobuf"],
    ["data/wells.parquet", "geoparquet"],
    ["data/wells.geoparquet", "geoparquet"],
    ["cog://https://x.org/a.tif", "cog"],
    ["scene.tif", "cog"],
    ["scene.TIFF", "cog"],
  ])("%s → %s", (url, format) => {
    expect(formatFromUrl(url)).toBe(format);
  });

  it.each([
    "https://x.org/tiles.json",
    "data/points.geojson",
    "https://x.org/fgb/list.json",
    "https://x.org/a.pmtiles.json",
    "data/a.fgb.geojson",
    "",
  ])("%s → nothing", (url) => {
    expect(formatFromUrl(url)).toBeUndefined();
  });

  it("ignores non-strings", () => {
    expect(formatFromUrl(undefined)).toBeUndefined();
    expect(formatFromUrl(42)).toBeUndefined();
  });
});

describe("formatOfSource", () => {
  it("reads the URL", () => {
    expect(formatOfSource({ type: "vector", url: "a.pmtiles" })).toBe("pmtiles");
    expect(formatOfSource({ type: "geojson", url: "a.fgb" })).toBe("flatgeobuf");
    expect(formatOfSource({ type: "geojson", url: "a.geojson" })).toBeUndefined();
    expect(formatOfSource({ type: "geojson", data: { type: "FeatureCollection", features: [] } })).toBeUndefined();
  });

  it("lets format: win over an extensionless (or misleading) URL", () => {
    expect(formatOfSource({ type: "geojson", url: "https://api.x.org/parcels?f=fgb", format: "flatgeobuf" })).toBe(
      "flatgeobuf"
    );
    expect(formatOfSource({ type: "vector", url: "https://x.org/a.json", format: "pmtiles" })).toBe("pmtiles");
  });

  it("reads a v2 source's runtime.format", () => {
    expect(formatOfSource({ type: "geojson", url: "https://x.org/p", runtime: { format: "flatgeobuf" } })).toBe(
      "flatgeobuf"
    );
  });

  it("ignores an unrecognized format: and falls back to the URL", () => {
    expect(formatOfSource({ type: "vector", url: "a.pmtiles", format: "nope" })).toBe("pmtiles");
  });
});

describe("type and format", () => {
  it("knows which source types draw which formats", () => {
    expect(typeReadsFormat("vector", "pmtiles")).toBe(true);
    expect(typeReadsFormat("raster", "pmtiles")).toBe(true);
    expect(typeReadsFormat("raster-dem", "pmtiles")).toBe(true);
    expect(typeReadsFormat("geojson", "pmtiles")).toBe(false);
    expect(typeReadsFormat("geojson", "flatgeobuf")).toBe(true);
    expect(typeReadsFormat("vector", "flatgeobuf")).toBe(false);
  });

  it("names the format a mistaken type: spells", () => {
    expect(formatNamedAsType("pmtiles")).toBe("pmtiles");
    expect(formatNamedAsType("FlatGeobuf")).toBe("flatgeobuf");
    expect(formatNamedAsType("fgb")).toBe("flatgeobuf");
    expect(formatNamedAsType("parquet")).toBe("geoparquet");
    expect(formatNamedAsType("geotiff")).toBe("cog");
    expect(formatNamedAsType("mbtiles")).toBe("mbtiles");
    expect(formatNamedAsType("vector")).toBeUndefined();
  });

  it("strips a protocol scheme, keeping the file URL", () => {
    expect(stripScheme("pmtiles://https://x.org/a.pmtiles")).toBe("https://x.org/a.pmtiles");
    expect(stripScheme("cog://data/a.tif")).toBe("data/a.tif");
    expect(stripScheme("data/a.pmtiles")).toBe("data/a.pmtiles");
  });
});

describe("formatsIn", () => {
  it("collects the supported formats a document reads, named and inline", () => {
    const found = formatsIn(
      {
        a: { type: "vector", url: "a.pmtiles" },
        b: { type: "geojson", url: "b.geojson" },
        c: { type: "geojson", url: "c.parquet" },
      },
      [{ id: "x", source: { type: "geojson", url: "x.fgb" } }, { id: "y", source: "a" }]
    );
    expect([...found].sort()).toEqual(["flatgeobuf", "pmtiles"]);
  });

  it("skips a format on a type that can't draw it", () => {
    expect([...formatsIn({ a: { type: "geojson", url: "a.pmtiles" } }, [])]).toEqual([]);
  });

  it("reads PMTiles, FlatGeobuf and COG in this version", () => {
    expect([...SUPPORTED_FORMATS].sort()).toEqual(["cog", "flatgeobuf", "pmtiles"]);
  });
});
