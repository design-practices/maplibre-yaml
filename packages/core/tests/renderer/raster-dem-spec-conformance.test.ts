/**
 * Conformance: the raster-dem source we hand MapLibre is valid MapLibre.
 *
 * @remarks
 * The layer-manager suite asserts against a mocked map, which proves we called
 * `addSource` with a given object — not that MapLibre would accept it. A wrong
 * field name or an unsupported `encoding` passes those tests and then fails at
 * runtime with no hillshading and no diagnostic, which is the "accepted but
 * doesn't work" defect this source type exists to fix. So the generated spec is
 * checked against MapLibre's own style-spec validator.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { LayerManager } from "../../src/renderer/layer-manager";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

/** Validate a generated source inside a minimal hillshade style. */
function validate(sourceSpec: any) {
  return validateStyleMin({
    version: 8,
    name: "conformance",
    sources: { terrain: sourceSpec },
    layers: [
      {
        id: "hills",
        type: "hillshade",
        source: "terrain",
        paint: { "hillshade-exaggeration": 0.6 },
      },
    ],
  } as any).map((e: any) => e.message);
}

describe("generated raster-dem source is spec-valid", () => {
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

  const hillshade = (source: any) => ({
    id: "terrain",
    type: "hillshade" as const,
    visible: true,
    toggleable: false,
    source,
  });

  it("accepts a terrarium tiles source with a real XYZ template", async () => {
    await manager.addLayer(
      hillshade({
        type: "raster-dem",
        tiles: ["https://example.com/dem/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 14,
        attribution: "Elevation © Example",
      }) as any
    );

    expect(validate(added["terrain-source"])).toEqual([]);
  });

  it("accepts a mapbox-encoded TileJSON source", async () => {
    await manager.addLayer(
      hillshade({
        type: "raster-dem",
        url: "https://example.com/terrain.json",
        encoding: "mapbox",
      }) as any
    );

    expect(validate(added["terrain-source"])).toEqual([]);
  });

  it("accepts custom-encoding factors — the fields a whitelist would drop", async () => {
    await manager.addLayer(
      hillshade({
        type: "raster-dem",
        url: "https://example.com/terrain.json",
        encoding: "custom",
        redFactor: 256,
        greenFactor: 1,
        blueFactor: 1 / 256,
        baseShift: 32768,
      }) as any
    );

    const spec = added["terrain-source"];
    // Both halves matter: MapLibre must accept the spec, and the factors that
    // make `custom` mean anything must actually be in it.
    expect(validate(spec)).toEqual([]);
    expect(spec).toMatchObject({
      encoding: "custom",
      redFactor: 256,
      baseShift: 32768,
    });
  });
});
