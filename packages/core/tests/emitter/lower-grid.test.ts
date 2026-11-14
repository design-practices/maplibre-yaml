/**
 * Grid sources on emit (ml-nb1.2, U5): a `type: grid` source is not a
 * MapLibre source, so the projection drops it from `style.sources` and keeps
 * its declaration under `metadata["maplibre-yaml:grid-sources"]`, with one
 * `contract` warning — nothing visible is lost while no layer can draw a
 * grid, so `--strict` passes. A layer over a grid (a model from older
 * tooling; the parser rejects it today) is dropped as `lossy`. Every emitted
 * style must pass MapLibre's own validator.
 */
import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { projectStyle, EmitError } from "../../src/emitter";
import { GRID_SOURCES_METADATA_KEY } from "../../src/emitter/lower-grid";
import { normalizeMapBlock, toModel } from "../../src/model";
import type { V1MapInput } from "../../src/model";
import { exportClasses } from "../../src/export/registrations";
import { YAMLParser } from "../../src/parser";

const emit = (input: unknown, mode?: "strict" | "with-fallbacks") =>
  projectStyle(normalizeMapBlock(input as V1MapInput), mode);

const base = { id: "m", config: { center: [10.2, 42.15], zoom: 2 } };

const field = {
  type: "grid",
  url: "data/field.png",
  encoding: "rg-uv",
  bounds: [-180, -90, 180, 90],
  range: [-30, 30],
  units: "m/s",
  attribution: "Field data",
};

type Stash = Record<string, Record<string, unknown>>;
const stashOf = (style: Record<string, unknown>): Stash | undefined =>
  (style["metadata"] as Record<string, Stash> | undefined)?.[GRID_SOURCES_METADATA_KEY];

describe("a grid-only document (Covers AE5)", () => {
  const parsed = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 2
  mapStyle: https://x.org/style.json
sources:
  field:
    type: grid
    url: data/field.png
    encoding: rg-uv
    bounds: [-180, -90, 180, 90]
    range: [-30, 30]
    units: m/s
    nodata: { channel: a, below: 1 }
    attribution: Field data
`);

  it("parses without errors or warnings (U1's contract, relied on here)", () => {
    expect(parsed.success).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("emits with --strict: the source is absent, the declaration is under metadata, one contract warning", () => {
    const { style, warnings } = projectStyle(normalizeMapBlock(parsed.data as never), "strict");
    expect(style["sources"]).toEqual({});
    expect(stashOf(style)).toEqual({
      field: {
        type: "grid",
        url: "data/field.png",
        encoding: "rg-uv",
        bounds: [-180, -90, 180, 90],
        range: [-30, 30],
        units: "m/s",
        nodata: { channel: "a", below: 1 },
        attribution: "Field data",
      },
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        path: "sources.field",
        kind: "contract",
        construct: "source.grid",
        exportClass: "no-export",
      }),
    ]);
    expect(warnings[0]!.message).toMatch(/grid source `field` is not a MapLibre source/);
    expect(warnings[0]!.message).toMatch(/kept under metadata for maplibre-yaml renderers/);
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe("the stash", () => {
  it("keys two grid sources by id, beside the ordinary sources", () => {
    const { style, warnings } = emit(
      {
        ...base,
        sources: {
          field,
          elevation: {
            type: "grid",
            url: "data/elevation.tif",
            encoding: "geotiff",
            bands: [0],
            nodata: -9999,
          },
          pts: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [{ id: "p", type: "circle", source: "pts" }],
      },
      "strict"
    );
    expect(Object.keys(style["sources"] as object)).toEqual(["pts"]);
    const stash = stashOf(style)!;
    expect(Object.keys(stash)).toEqual(["field", "elevation"]);
    expect(stash["elevation"]).toEqual({
      type: "grid",
      url: "data/elevation.tif",
      encoding: "geotiff",
      bands: [0],
      nodata: -9999,
    });
    expect(warnings.filter((w) => w.construct === "source.grid").map((w) => w.path)).toEqual([
      "sources.field",
      "sources.elevation",
    ]);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("keeps the grid: node-geometry form as written", () => {
    const grid = { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 };
    const { style } = emit({
      ...base,
      sources: { field: { type: "grid", url: "data/field.png", encoding: "scalar-r", grid, range: [0, 1] } },
    });
    expect(stashOf(style)!["field"]!["grid"]).toEqual(grid);
  });

  it("sits beside an authored metadata block and the description", () => {
    const parsed = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
description: A field
style:
  center: [10.2, 42.15]
  zoom: 2
  metadata: { "example:owner": "someone" }
  sources:
    field:
      type: grid
      url: data/field.png
      encoding: rg-uv
      bounds: [-180, -90, 180, 90]
      range: [-30, 30]
`);
    expect(parsed.success).toBe(true);
    const { style } = projectStyle(toModel(parsed.data as never), "strict");
    expect(style["metadata"]).toEqual({
      "maplibre-yaml:description": "A field",
      "example:owner": "someone",
      [GRID_SOURCES_METADATA_KEY]: {
        field: {
          type: "grid",
          url: "data/field.png",
          encoding: "rg-uv",
          bounds: [-180, -90, 180, 90],
          range: [-30, 30],
        },
      },
    });
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("sanitizes a grid's attribution the way emitted sources are (contract)", () => {
    const { style, warnings } = emit(
      {
        ...base,
        sources: {
          field: { ...field, attribution: 'Data <a href="javascript:alert(1)">here</a> <b>bold</b>' },
        },
      },
      "strict"
    );
    const attribution = stashOf(style)!["field"]!["attribution"] as string;
    expect(attribution).not.toMatch(/javascript:/);
    expect(attribution).not.toMatch(/<b>/);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        path: `metadata.${GRID_SOURCES_METADATA_KEY}.field.attribution`,
        kind: "contract",
      })
    );
  });
});

describe("a v2 document behaves identically", () => {
  it("runtime: keys (cache) are reported as contract, never lossy; the stash is the spec half", () => {
    const parsed = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [10.2, 42.15]
  zoom: 2
  basemap: https://x.org/style.json
  sources:
    field:
      type: grid
      url: data/field.png
      encoding: rg-uv
      bounds: [-180, -90, 180, 90]
      range: [-30, 30]
      runtime:
        cache: { ttl: 60000 }
`);
    expect(parsed.success).toBe(true);
    expect(parsed.warnings).toEqual([]);
    const { style, warnings } = projectStyle(toModel(parsed.data as never), "strict");
    expect(style["sources"]).toEqual({});
    expect(stashOf(style)).toEqual({
      field: {
        type: "grid",
        url: "data/field.png",
        encoding: "rg-uv",
        bounds: [-180, -90, 180, 90],
        range: [-30, 30],
      },
    });
    expect(warnings.every((w) => w.kind === "contract")).toBe(true);
    expect(warnings.map((w) => w.construct).sort()).toEqual(["source.cache", "source.grid"]);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("v1 flat cache:/loading: give the same report", () => {
    const { warnings } = emit(
      { ...base, sources: { field: { ...field, cache: { ttl: 60000 }, loading: { message: "Loading field" } } } },
      "strict"
    );
    expect(warnings.every((w) => w.kind === "contract")).toBe(true);
    expect(warnings.map((w) => w.construct).sort()).toEqual(["source.cache", "source.grid", "source.loading"]);
  });
});

describe("a layer over a grid (a model the parser no longer produces)", () => {
  // The parser rejects a layer whose source is a grid, so these models are
  // hand-built: what older tooling or a direct toModel caller might hand us.
  const layered = () => {
    const model = normalizeMapBlock({
      ...base,
      sources: { field, pts: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [
        { id: "p", type: "circle", source: "pts" },
        { id: "r", type: "raster", source: "pts" },
      ],
    } as V1MapInput);
    (model.style.layers[1]!.spec as Record<string, unknown>)["source"] = "field";
    return model;
  };

  it("drops the layer with a lossy warning; the rest of the style emits and validates", () => {
    const { style, warnings } = projectStyle(layered());
    expect((style["layers"] as { id: string }[]).map((l) => l.id)).toEqual(["p"]);
    expect(style["sources"]).toEqual({ pts: { type: "geojson", data: { type: "FeatureCollection", features: [] } } });
    expect(stashOf(style)).toHaveProperty("field");
    expect(warnings).toContainEqual(
      expect.objectContaining({
        path: "layers.r.source",
        kind: "lossy",
        construct: "source.grid",
        exportClass: "no-export",
      })
    );
    expect(warnings.find((w) => w.path === "layers.r.source")!.message).toMatch(/`r`.*`field`/);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("--strict refuses it", () => {
    expect(() => projectStyle(layered(), "strict")).toThrow(EmitError);
  });

  it("an inline grid source on a layer is dropped the same way", () => {
    const model = normalizeMapBlock({
      ...base,
      sources: { pts: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "p", type: "circle", source: "pts" }],
    } as V1MapInput);
    model.style.layers.push({
      spec: { id: "r", type: "raster", source: { ...field } },
      runtime: {},
    } as never);
    const { style, warnings } = projectStyle(model);
    expect((style["layers"] as { id: string }[]).map((l) => l.id)).toEqual(["p"]);
    expect(Object.keys(style["sources"] as object)).toEqual(["pts"]);
    expect(stashOf(style)).toBeUndefined();
    expect(warnings).toContainEqual(
      expect.objectContaining({ path: "layers.r.source", kind: "lossy", construct: "source.grid" })
    );
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(() => projectStyle(model, "strict")).toThrow(EmitError);
  });
});

describe("registration", () => {
  it("declares source.grid as no-export", () => {
    expect(exportClasses.require("source.grid").class).toBe("no-export");
  });
});
