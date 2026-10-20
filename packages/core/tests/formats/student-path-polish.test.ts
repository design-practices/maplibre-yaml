/**
 * Small 0.9 formats polish from the student-path pass (ml-aot.123): a
 * flavor in any case, one message per misspelt basemap key, a v2 source's
 * maplibre-yaml key outside runtime: told where it goes, and a GeoParquet
 * file read as JSON named for what it is.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";
import { protomapsStyle } from "../../src/formats/protomaps-style";
import { describeDataProblem } from "../../src/components/student-messages";

const v1 = (mapStyle: string) => `
type: map
id: pm
config:
  center: [-73.99, 40.70]
  zoom: 14
  mapStyle: ${mapStyle}
layers: []
`;

describe("Protomaps basemap flavor and keys", () => {
  it("flavor: Dark is dark, as palette names take any case", async () => {
    const r = YAMLParser.safeParseMapBlock(v1("{ pmtiles: data/nyc.pmtiles, flavor: Dark }"));
    expect(r.errors).toEqual([]);
    expect((r.data as any).config.mapStyle).toEqual({ pmtiles: "data/nyc.pmtiles", flavor: "dark" });
    // A programmatic config that skipped the parser too.
    const style = await protomapsStyle({ pmtiles: "data/nyc.pmtiles", flavor: "GrayScale" as never });
    expect(style["sprite"]).toMatch(/\/sprites\/v4\/grayscale$/);
  });

  it("a misspelt key (flavour:) is reported once, not as an error and a warning", () => {
    const r = YAMLParser.safeParseMapBlock(v1("{ pmtiles: data/nyc.pmtiles, flavour: dark }"));
    expect(r.errors.map((e) => e.path)).toEqual(["config.mapStyle.flavour"]);
    expect(r.warnings.filter((w) => w.path === "config.mapStyle.flavour")).toEqual([]);
  });
});

describe("v2: a maplibre-yaml source key outside runtime:", () => {
  it("says it goes under runtime:, instead of calling it unknown", () => {
    const r = YAMLParser.safeParseMapBlock(`
version: 2
type: map
id: x
style:
  center: [0, 0]
  zoom: 2
  basemap: "https://x/style.json"
  sources:
    v: { type: raster, url: data/x.tif, colorRamp: { palette: viridis, min: 0, max: 1 } }
    g: { type: geojson, url: data/x.parquet, load: viewport }
  layers: [ { id: v, type: raster, source: v }, { id: g, type: circle, source: g } ]
`);
    expect(r.errors).toEqual([]);
    const ramp = r.warnings.find((w) => w.path === "style.sources.v.colorRamp")!;
    expect(ramp.message).toContain("colorRamp: is a maplibre-yaml key");
    expect(ramp.message).toContain("under the source's runtime: block (runtime: { colorRamp: … })");
    expect(ramp.message).not.toMatch(/^Unknown key/);
    expect(r.warnings.find((w) => w.path === "style.sources.g.load")!.message).toContain("runtime: { load: … }");
  });
});

describe("a cloud-native file read as JSON", () => {
  it("names the format and the fix, not 'isn't JSON'", () => {
    const text = describeDataProblem("tracts", Object.assign(new Error("Parquet data from data/tracts.pq without a format"), { url: "data/tracts.pq" }), {
      filePage: false,
    });
    expect(text).toContain("it is a Parquet file, but its name doesn't end in .parquet");
    expect(text).toContain("add format: geoparquet to the source");
    expect(text).not.toContain("isn't JSON");
  });
});
