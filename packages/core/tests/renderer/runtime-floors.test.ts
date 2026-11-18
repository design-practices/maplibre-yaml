/**
 * Keys MapLibre refuses as unknown below a release are dropped with a notice
 * on an older runtime, and forwarded untouched at or above the floor
 * (ml-vwz): `*-layer-blend` paint (maplibre-gl 6.18) and the `sparse`
 * vector-source option (6.17).
 *
 * @remarks
 * An unknown paint property or source option is not ignored by MapLibre: its
 * style validation refuses the whole layer (or source, and then every layer
 * over it). So the renderer's declared-absence posture for `color-relief`
 * applies — drop the key, say so once, keep the document rendering. The
 * version comes off `Map#version`; a map that reports none makes no claim and
 * the key is attempted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LayerManager } from "../../src/renderer/layer-manager";
import {
  LAYER_BLEND_RUNTIME_FLOOR,
  SPARSE_SOURCE_RUNTIME_FLOOR,
} from "../../src/capabilities";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

function mockMap(version?: string) {
  const added: { sources: Record<string, any>; layers: any[] } = { sources: {}, layers: [] };
  const map: any = {
    addSource: vi.fn((id: string, spec: any) => {
      added.sources[id] = spec;
    }),
    addLayer: vi.fn((spec: any) => {
      added.layers.push(spec);
    }),
    getSource: vi.fn((id: string) => added.sources[id]),
    getLayer: vi.fn(() => undefined),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    setLayoutProperty: vi.fn(),
  };
  if (version !== undefined) map.version = version;
  return { map, added };
}

const BLENDED_FILL = {
  id: "shade",
  type: "fill",
  visible: true,
  toggleable: false,
  source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  paint: { "fill-color": "#3366cc", "fill-opacity": 0.8, "fill-layer-blend": "multiply" },
};

const SPARSE_VECTOR = {
  type: "vector",
  tiles: ["https://example.com/{z}/{x}/{y}.mvt"],
  sparse: true,
  maxzoom: 10,
};

describe("*-layer-blend below maplibre-gl 6.18", () => {
  let hints: Array<[string, string]>;
  beforeEach(() => {
    hints = [];
  });

  it("drops the key, keeps the rest of paint, and hints once naming the floor", async () => {
    const { map, added } = mockMap("6.12.0");
    const manager = new LayerManager(map, { onLayerHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer(BLENDED_FILL as any);

    expect(added.layers[0].paint).toEqual({ "fill-color": "#3366cc", "fill-opacity": 0.8 });
    expect(hints).toHaveLength(1);
    expect(hints[0]![0]).toBe("shade");
    expect(hints[0]![1]).toContain("fill-layer-blend");
    expect(hints[0]![1]).toContain(LAYER_BLEND_RUNTIME_FLOOR);
    expect(hints[0]![1]).toContain("6.12.0");
    // The document's own layer object is not modified.
    expect(BLENDED_FILL.paint["fill-layer-blend"]).toBe("multiply");
  });

  it("hints once per layer across re-adds", async () => {
    const { map } = mockMap("6.12.0");
    const manager = new LayerManager(map, { onLayerHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer(BLENDED_FILL as any);
    manager.removeLayer("shade");
    await manager.addLayer(BLENDED_FILL as any);
    expect(hints).toHaveLength(1);
  });

  it("forwards the key at the floor", async () => {
    const { map, added } = mockMap(LAYER_BLEND_RUNTIME_FLOOR);
    const manager = new LayerManager(map, { onLayerHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer(BLENDED_FILL as any);
    expect(added.layers[0].paint["fill-layer-blend"]).toBe("multiply");
    expect(hints).toEqual([]);
  });

  it("forwards the key above the floor, for line and raster too", async () => {
    const { map, added } = mockMap("6.19.0");
    const manager = new LayerManager(map, { onLayerHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer({
      ...BLENDED_FILL,
      id: "roads",
      type: "line",
      paint: { "line-color": "#000", "line-layer-blend": "screen" },
    } as any);
    await manager.addLayer({
      id: "imagery",
      type: "raster",
      visible: true,
      toggleable: false,
      source: { type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"] },
      paint: { "raster-layer-blend": "overlay" },
    } as any);
    expect(added.layers[0].paint["line-layer-blend"]).toBe("screen");
    expect(added.layers[1].paint["raster-layer-blend"]).toBe("overlay");
    expect(hints).toEqual([]);
  });

  it("makes no claim when the map reports no version", async () => {
    const { map, added } = mockMap();
    const manager = new LayerManager(map, { onLayerHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer(BLENDED_FILL as any);
    expect(added.layers[0].paint["fill-layer-blend"]).toBe("multiply");
    expect(hints).toEqual([]);
  });
});

describe("sparse vector sources below maplibre-gl 6.17", () => {
  let hints: Array<[string, string]>;
  beforeEach(() => {
    hints = [];
  });

  it("drops sparse from an inline source and hints once naming the floor", async () => {
    const { map, added } = mockMap("6.12.0");
    const manager = new LayerManager(map, { onSourceHint: (id, m) => hints.push([id, m]) });
    await manager.addLayer({
      id: "parcels",
      type: "fill",
      visible: true,
      toggleable: false,
      source: SPARSE_VECTOR,
      "source-layer": "parcels",
    } as any);

    expect(added.sources["parcels-source"]).not.toHaveProperty("sparse");
    expect(added.sources["parcels-source"].maxzoom).toBe(10);
    expect(hints).toHaveLength(1);
    expect(hints[0]![0]).toBe("parcels-source");
    expect(hints[0]![1]).toContain("sparse");
    expect(hints[0]![1]).toContain(SPARSE_SOURCE_RUNTIME_FLOOR);
  });

  it("drops sparse from a named source too", () => {
    const { map, added } = mockMap("6.16.0");
    const manager = new LayerManager(map, { onSourceHint: (id, m) => hints.push([id, m]) });
    manager.registerSources({ tiles: SPARSE_VECTOR });
    expect(added.sources["tiles"]).not.toHaveProperty("sparse");
    expect(hints.map(([id]) => id)).toEqual(["tiles"]);
  });

  it("forwards sparse at and above the floor", () => {
    for (const version of [SPARSE_SOURCE_RUNTIME_FLOOR, "6.19.0"]) {
      const { map, added } = mockMap(version);
      const manager = new LayerManager(map, { onSourceHint: (id, m) => hints.push([id, m]) });
      manager.registerSources({ tiles: SPARSE_VECTOR });
      expect(added.sources["tiles"].sparse).toBe(true);
    }
    expect(hints).toEqual([]);
  });

  it("makes no claim when the map reports no version", () => {
    const { map, added } = mockMap();
    const manager = new LayerManager(map, { onSourceHint: (id, m) => hints.push([id, m]) });
    manager.registerSources({ tiles: SPARSE_VECTOR });
    expect(added.sources["tiles"].sparse).toBe(true);
    expect(hints).toEqual([]);
  });
});
