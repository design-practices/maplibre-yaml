/**
 * Cross-field rules for `grid` sources at validation time (ml-nb1.2, U1):
 * geometry (`bounds:` or `grid:`, per encoding), `range:` per encoding,
 * `nodata:` shape, `bands:` only with geotiff, `format:` pointing at
 * `encoding:`, and the error for a layer drawn over a grid, which no layer
 * type does yet (AE3). In v1 and v2 documents.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";
import { formatOfSource } from "../../src/formats/detect";

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

const v2 = (sources: string, layers = "  layers: []") => `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
${sources}
${layers}
`;

/** A v1 document with one grid source `t` whose body is `lines` (4-space indented). */
const one = (lines: string) =>
  v1(
    `  t:
    type: grid
    url: data/f.png
${lines}`
  );

const parse = (doc: string) => YAMLParser.safeParseMapBlock(doc);
const errorAt = (doc: string, path: string) => parse(doc).errors.find((e) => e.path === path);

describe("geometry: bounds: or grid:, as the encoding allows", () => {
  it("both present is an error at grid:", () => {
    const doc = one(`    encoding: scalar-r
    range: [0, 1]
    bounds: [0, 0, 1, 1]
    grid: { nx: 2, ny: 2, lo1: 0, la1: 1, dx: 0.5, dy: 0.5 }`);
    const error = errorAt(doc, "sources.t.grid");
    expect(error).toBeDefined();
    expect(error!.message).toBe("A grid source takes bounds: or grid:, not both.");
    expect(error!.line).toBe(14);
  });

  it("neither, on an image encoding, is an error at the source", () => {
    const doc = one(`    encoding: rg-uv
    range: [-40, 40]`);
    const error = errorAt(doc, "sources.t");
    expect(error).toBeDefined();
    expect(error!.message).toContain("encoding: rg-uv needs the field's geometry");
    expect(error!.message).toContain("bounds: [west, south, east, north]");
    expect(error!.message).toContain("grid: { nx, ny, lo1, la1, dx, dy }");
  });

  it("bounds: on nullschool-json, and grid: on geotiff, are redundant with the file", () => {
    const json = errorAt(
      one(`    encoding: nullschool-json
    bounds: [-180, -90, 180, 90]`),
      "sources.t.bounds"
    );
    expect(json?.message).toBe(
      "encoding: nullschool-json reads the field's geometry from the file; remove bounds:."
    );
    const tiff = errorAt(
      one(`    encoding: geotiff
    grid: { nx: 2, ny: 2, lo1: 0, la1: 1, dx: 0.5, dy: 0.5 }`),
      "sources.t.grid"
    );
    expect(tiff?.message).toBe("encoding: geotiff reads the field's geometry from the file; remove grid:.");
  });
});

describe("bounds: [west, south, east, north]", () => {
  const withBounds = (bounds: string) =>
    one(`    encoding: scalar-r
    range: [0, 1]
    bounds: ${bounds}`);

  it("a node-centred global grid overshooting the poles by half a cell is accepted", () => {
    const result = parse(withBounds("[-180.5, -90.5, 179.5, 90.5]"));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("the globe plus one duplicated column, and a 0..360 longitude convention, are accepted", () => {
    expect(parse(withBounds("[-180, -90, 181, 90]")).errors).toEqual([]);
    expect(parse(withBounds("[0, -90, 360, 90]")).errors).toEqual([]);
  });

  it("overshooting the pole by two cells is rejected, naming the 1° tolerance", () => {
    const error = errorAt(withBounds("[-180, -90, 180, 92]"), "sources.t.bounds");
    expect(error).toBeDefined();
    expect(error!.message).toContain("north (92)");
    expect(error!.message).toContain("1°");
  });

  it("south at or above north is an order error", () => {
    const error = errorAt(withBounds("[-10, 50, 10, 40]"), "sources.t.bounds");
    expect(error?.message).toBe(
      "bounds: south (50) must be below north (40); bounds are [west, south, east, north]."
    );
  });

  it("latitude values far outside ±90 with longitudes inside: the lat/lon swap did-you-mean", () => {
    const error = errorAt(withBounds("[40, -74, 41, -73]"), "sources.t.bounds");
    // Both pairs are plausible here, so nothing can be said: this is accepted.
    expect(error).toBeUndefined();
    const swapped = errorAt(withBounds("[-74, -180, -73, 180]"), "sources.t.bounds");
    expect(swapped).toBeDefined();
    expect(swapped!.message).toContain("longitude first");
    expect(swapped!.message).toContain("did you mean [-180, -74, 180, -73]?");
    expect(swapped!.suggestion).toBe("[-180, -74, 180, -73]");
  });

  it("west at or above east, a span past the globe plus a column, and longitudes far outside", () => {
    expect(errorAt(withBounds("[10, 0, -10, 1]"), "sources.t.bounds")?.message).toBe(
      "bounds: west (10) must be below east (-10); bounds are [west, south, east, north]."
    );
    expect(errorAt(withBounds("[-180, 0, 200, 1]"), "sources.t.bounds")?.message).toContain("361°");
    expect(errorAt(withBounds("[-200, 0, 100, 1]"), "sources.t.bounds")?.message).toContain("-200");
  });
});

describe("grid: { nx, ny, lo1, la1, dx, dy }", () => {
  const withGrid = (grid: string) =>
    one(`    encoding: scalar-r
    range: [0, 1]
    grid: ${grid}`);

  it("dy is positive and counted southward from la1 (the top row)", () => {
    expect(parse(withGrid("{ nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 }")).errors).toEqual([]);
    const error = errorAt(withGrid("{ nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: -1 }"), "sources.t.grid.dy");
    expect(error).toBeDefined();
    expect(error!.message).toContain("positive");
    expect(error!.message).toContain("southward");
  });

  it("nx and ny are positive whole numbers; dx positive; lo1 and la1 in range", () => {
    const bad = withGrid("{ nx: 0, ny: 2.5, lo1: 400, la1: 91, dx: 0, dy: 1 }");
    const paths = parse(bad).errors.map((e) => e.path).sort();
    expect(paths).toEqual([
      "sources.t.grid.dx",
      "sources.t.grid.la1",
      "sources.t.grid.lo1",
      "sources.t.grid.nx",
      "sources.t.grid.ny",
    ]);
  });
});

describe("range: per encoding", () => {
  it("missing on scalar-r", () => {
    const error = errorAt(
      one(`    encoding: scalar-r
    bounds: [0, 0, 1, 1]`),
      "sources.t"
    );
    expect(error?.message).toBe("encoding: scalar-r needs range: [lo, hi], the values bytes 0 and 255 stand for.");
  });

  it("present on nullschool-json", () => {
    const error = errorAt(
      one(`    encoding: nullschool-json
    range: [0, 1]`),
      "sources.t.range"
    );
    expect(error?.message).toBe("encoding: nullschool-json carries physical values; remove range:.");
  });

  it("reversed", () => {
    const error = errorAt(
      one(`    encoding: rg-uv
    bounds: [0, 0, 1, 1]
    range: [40, -40]`),
      "sources.t.range"
    );
    expect(error?.message).toBe("range: [40, -40] must be [lo, hi] with lo below hi.");
  });
});

describe("nodata: per encoding", () => {
  it("an image encoding takes { channel, below | above | equals } with one comparator", () => {
    const base = `    encoding: scalar-r
    bounds: [0, 0, 1, 1]
    range: [0, 1]
`;
    expect(parse(one(base + "    nodata: { channel: a, equals: 0 }")).errors).toEqual([]);
    expect(errorAt(one(base + "    nodata: -9999"), "sources.t.nodata")?.message).toContain(
      "{ channel: r | g | b | a, below | above | equals: n }"
    );
    expect(errorAt(one(base + "    nodata: { channel: a, below: 1, above: 254 }"), "sources.t.nodata")?.message).toContain(
      "one comparator"
    );
    expect(errorAt(one(base + "    nodata: { channel: a }"), "sources.t.nodata")).toBeDefined();
  });

  it("geotiff takes a number; nullschool-json takes none", () => {
    expect(
      errorAt(
        one(`    encoding: geotiff
    nodata: { channel: a, equals: 0 }`),
        "sources.t.nodata"
      )?.message
    ).toBe("nodata: on encoding: geotiff is a number, the file's missing-value marker.");
    expect(
      errorAt(
        one(`    encoding: nullschool-json
    nodata: -9999`),
        "sources.t.nodata"
      )?.message
    ).toBe("encoding: nullschool-json marks missing nodes as null; remove nodata:.");
  });
});

describe("bands: only with geotiff", () => {
  it("bands: [0] on rg-uv is rejected", () => {
    const error = errorAt(
      one(`    encoding: rg-uv
    bounds: [0, 0, 1, 1]
    range: [0, 1]
    bands: [0]`),
      "sources.t.bands"
    );
    expect(error?.message).toBe("bands: only applies to encoding: geotiff; remove it.");
  });

  it("one or two whole numbers from 0", () => {
    expect(parse(one(`    encoding: geotiff
    bands: [2]`)).errors).toEqual([]);
    expect(errorAt(one(`    encoding: geotiff
    bands: [0, 1, 2]`), "sources.t.bands")?.message).toBe(
      "bands: lists 1 or 2 band indices (whole numbers from 0)."
    );
    expect(errorAt(one(`    encoding: geotiff
    bands: [-1]`), "sources.t.bands")).toBeDefined();
  });
});

describe("format: on a grid points at encoding:", () => {
  it("v1: an error at format:, and no duplicate unknown-key warning", () => {
    const result = parse(
      one(`    encoding: scalar-r
    bounds: [0, 0, 1, 1]
    range: [0, 1]
    format: cog`)
    );
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "sources.t.format",
        message: "grid sources describe their pixel packing with encoding:, not format:.",
        line: 14,
      })
    );
    expect(result.warnings.filter((w) => w.path === "sources.t.format")).toEqual([]);
  });

  it("v2: under runtime:, and flat", () => {
    const under = parse(
      v2(`    t:
      type: grid
      url: data/f.tif
      encoding: geotiff
      runtime: { format: cog }`)
    );
    expect(under.errors.map((e) => e.path)).toContain("style.sources.t.runtime.format");
    const flat = parse(
      v2(`    t:
      type: grid
      url: data/f.tif
      encoding: geotiff
      format: cog`)
    );
    expect(flat.errors.map((e) => e.path)).toContain("style.sources.t.format");
    expect(flat.warnings.filter((w) => w.path === "style.sources.t.format")).toEqual([]);
  });

  it("a .tif grid is not sniffed as a COG, and the cloud-format checks leave it alone", () => {
    expect(formatOfSource({ type: "grid", url: "data/f.tif", encoding: "geotiff" })).toBeUndefined();
    expect(formatOfSource({ type: "grid", url: "cog://data/f.tif", encoding: "geotiff" })).toBeUndefined();
    const result = parse(
      one(`    encoding: geotiff`).replace("data/f.png", "data/f.tif")
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("a layer over a grid (AE3)", () => {
  const layerOverGrid = v1(
    `  temperature:
    type: grid
    url: data/t.png
    encoding: scalar-r
    bounds: [-180, -90, 180, 90]
    range: [193, 328]`,
    `layers:
  - id: heat
    type: fill
    source: temperature
    paint: { fill-color: "#f00" }`
  );

  it("fails at the layer's source: line with the documented wording", () => {
    const result = parse(layerOverGrid);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "layers.0.source",
        message:
          '"temperature" is a grid source; no layer type draws a grid yet. ' +
          'Read its values from page code with getGrid("temperature").sample(lngLat).',
        line: 17,
        column: 13,
      })
    );
  });

  it("mlym validate (safeParseAny) agrees; a grid-only document passes with no warnings", () => {
    const failing = YAMLParser.safeParseAny(layerOverGrid);
    expect(failing.result.success).toBe(false);
    expect(failing.result.errors.map((e) => e.path)).toContain("layers.0.source");
    const passing = YAMLParser.safeParseAny(
      v1(`  temperature:
    type: grid
    url: data/t.png
    encoding: scalar-r
    bounds: [-180, -90, 180, 90]
    range: [193, 328]`)
    );
    expect(passing.result.success).toBe(true);
    expect(passing.result.warnings).toEqual([]);
  });

  it("an inline grid source on a layer, and a v2 layer over a grid", () => {
    const inline = parse(
      v1(
        "  {}",
        `layers:
  - id: heat
    type: raster
    source:
      type: grid
      url: data/t.png
      encoding: scalar-r
      bounds: [-180, -90, 180, 90]
      range: [193, 328]`
      )
    );
    expect(inline.success).toBe(false);
    const error = inline.errors.find((e) => e.path === "layers.0.source");
    expect(error?.message).toContain('Layer "heat" has an inline grid source; no layer type draws a grid yet.');
    expect(error?.message).toContain("getGrid(id).sample(lngLat)");

    const two = parse(
      v2(
        `    temperature:
      type: grid
      url: data/t.png
      encoding: scalar-r
      bounds: [-180, -90, 180, 90]
      range: [193, 328]`,
        `  layers:
    - id: heat
      type: fill
      source: temperature`
      )
    );
    expect(two.success).toBe(false);
    expect(two.errors.map((e) => e.path)).toContain("style.layers.0.source");
  });
});
