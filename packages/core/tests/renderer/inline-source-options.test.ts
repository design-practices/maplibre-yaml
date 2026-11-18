/**
 * An inline layer `source:` reaches MapLibre with every option the author
 * wrote, like a named `sources:` entry does (ml-vwz).
 *
 * @remarks
 * The inline vector and raster branches copied a hand list of fields (url,
 * tiles, zoom range, bounds, attribution) onto the MapLibre spec, so a
 * schema-accepted option outside that list — `sparse`, `encoding`, `scheme`,
 * `promoteId`, `volatile` — validated, rendered nothing different, and left
 * no diagnostic. Named sources pass through `toMapLibreSourceSpec`, which
 * only strips this library's own keys. Both paths must agree, and what they
 * hand over must still be spec-valid.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { LayerManager } from "../../src/renderer/layer-manager";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

/** Validate a generated source inside a minimal style drawing from it. */
function validate(sourceSpec: any, layer: Record<string, unknown>) {
  return validateStyleMin({
    version: 8,
    name: "inline-source-options",
    sources: { s: sourceSpec },
    layers: [{ id: "l", source: "s", ...layer }],
  } as any).map((e: any) => e.message);
}

describe("inline sources forward every MapLibre option the schema accepts", () => {
  let mockMap: any;
  let manager: LayerManager;
  let added: Record<string, any>;

  beforeEach(() => {
    added = {};
    mockMap = {
      addSource: vi.fn((id: string, spec: any) => {
        added[id] = spec;
      }),
      addLayer: vi.fn(),
      getSource: vi.fn(() => undefined),
      getLayer: vi.fn(() => undefined),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
    manager = new LayerManager(mockMap);
  });

  const VECTOR = {
    type: "vector",
    tiles: ["https://example.com/{z}/{x}/{y}.mvt"],
    minzoom: 2,
    maxzoom: 12,
    bounds: [-10, -10, 10, 10],
    scheme: "tms",
    sparse: true,
    promoteId: { parcels: "apn" },
    volatile: true,
    encoding: "mlt",
    attribution: "Tiles by Example",
  };

  it("a vector source keeps sparse, encoding, scheme, promoteId and volatile", async () => {
    await manager.addLayer({
      id: "parcels",
      type: "fill",
      visible: true,
      toggleable: false,
      source: VECTOR,
      "source-layer": "parcels",
    } as any);

    const spec = added["parcels-source"];
    expect(spec).toMatchObject({
      type: "vector",
      tiles: VECTOR.tiles,
      minzoom: 2,
      maxzoom: 12,
      bounds: VECTOR.bounds,
      scheme: "tms",
      sparse: true,
      promoteId: { parcels: "apn" },
      volatile: true,
      encoding: "mlt",
    });
    expect(validate(spec, { type: "fill", "source-layer": "parcels" })).toEqual([]);
  });

  it("an inline vector source matches what the same named source hands MapLibre", async () => {
    manager.registerSources({ named: VECTOR });
    await manager.addLayer({
      id: "inline",
      type: "fill",
      visible: true,
      toggleable: false,
      source: VECTOR,
      "source-layer": "parcels",
    } as any);

    expect(added["inline-source"]).toEqual(added["named"]);
  });

  it("a vector source's library-only keys (format, load) stay out of the MapLibre spec", async () => {
    await manager.addLayer({
      id: "fmt",
      type: "line",
      visible: true,
      toggleable: false,
      source: { type: "vector", url: "https://example.com/tiles.json", format: "tilejson" },
      "source-layer": "roads",
    } as any);

    expect(added["fmt-source"]).not.toHaveProperty("format");
    expect(validate(added["fmt-source"], { type: "line", "source-layer": "roads" })).toEqual([]);
  });

  it("a raster source keeps scheme and volatile", async () => {
    await manager.addLayer({
      id: "imagery",
      type: "raster",
      visible: true,
      toggleable: false,
      source: {
        type: "raster",
        tiles: ["https://example.com/{z}/{x}/{y}.png"],
        tileSize: 256,
        scheme: "tms",
        volatile: true,
        bounds: [-10, -10, 10, 10],
        attribution: "Imagery by Example",
      },
    } as any);

    const spec = added["imagery-source"];
    expect(spec).toMatchObject({
      type: "raster",
      tileSize: 256,
      scheme: "tms",
      volatile: true,
      bounds: [-10, -10, 10, 10],
    });
    expect(validate(spec, { type: "raster" })).toEqual([]);
  });

  it("a raster source's colorRamp (a COG option of ours) stays out of the MapLibre spec", async () => {
    await manager.addLayer({
      id: "cog",
      type: "raster",
      visible: true,
      toggleable: false,
      source: {
        type: "raster",
        tiles: ["https://example.com/{z}/{x}/{y}.png"],
        colorRamp: { stops: [[0, "#000"], [1, "#fff"]] },
      },
    } as any);

    expect(added["cog-source"]).not.toHaveProperty("colorRamp");
    expect(validate(added["cog-source"], { type: "raster" })).toEqual([]);
  });
});
