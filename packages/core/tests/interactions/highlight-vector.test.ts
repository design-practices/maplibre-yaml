/**
 * `hover.highlight` on vector tiles (PMTiles, `tiles:`) — ml-37r.15.
 *
 * @remarks
 * Feature-state on a vector source must name the source layer the feature is
 * in; without `sourceLayer` MapLibre rejects every write ("The sourceLayer
 * parameter must be provided for vector source types") and nothing lights.
 * The PLUTO benchmark logged that once per mouse move on every PMTiles run.
 * And tiles without ids can't be highlighted at all: the author is told,
 * once, to set `promoteId` (not `generateId`, which vector sources don't take).
 * The browser proof is e2e/highlight-vector.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn(), on: vi.fn() }));
  return { default: { Popup }, Popup };
});

import { attachInteractions } from "../../src/interactions/attach";
import { EventHandler } from "../../src/renderer/event-handler";

const LNGLAT = { lng: 1, lat: 2 } as any;

function mockMap() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    setFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  } as any;
}

function fire(map: any, event: string, feature: any) {
  const call = map.on.mock.calls.find((c: any[]) => c[0] === event);
  call?.[2]?.({ features: feature ? [feature] : [], lngLat: LNGLAT });
}

const highlight = { layers: { lots: { source: "parcels", interactive: { hover: { highlight: true } } as any } } };

/** A feature as MapLibre hands it to a vector layer's event. */
const tileFeature = (id: number | undefined, props: Record<string, unknown> = { BBL: 1 }) => ({
  ...(id !== undefined ? { id } : {}),
  properties: props,
  source: "parcels",
  sourceLayer: "pluto",
  layer: { id: "lots", source: "parcels", "source-layer": "pluto" },
});

afterEach(() => vi.restoreAllMocks());

describe("hover.highlight on a vector source", () => {
  it("names the source layer when it lights a feature, and when it unlights it", () => {
    const map = mockMap();
    attachInteractions(map, highlight);
    fire(map, "mousemove", tileFeature(7));
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: "parcels", sourceLayer: "pluto", id: 7 },
      { hover: true }
    );
    fire(map, "mousemove", tileFeature(8));
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "parcels", sourceLayer: "pluto", id: 7 },
      { hover: false }
    );
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: "parcels", sourceLayer: "pluto", id: 8 },
      { hover: true }
    );
    // mouseleave clears with the same address.
    map.setFeatureState.mockClear();
    fire(map, "mouseleave", null);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "parcels", sourceLayer: "pluto", id: 8 },
      { hover: false }
    );
  });

  it("falls back to the layer's own source-layer when the feature doesn't carry it", () => {
    const map = mockMap();
    attachInteractions(map, highlight);
    fire(map, "mousemove", { id: 3, properties: {}, layer: { id: "lots", "source-layer": "pluto" } });
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "parcels", sourceLayer: "pluto", id: 3 },
      { hover: true }
    );
  });

  it("leaves GeoJSON features addressed by source and id only", () => {
    const map = mockMap();
    attachInteractions(map, highlight);
    fire(map, "mousemove", { id: 4, properties: {}, source: "parcels", layer: { id: "lots" } });
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: "parcels", id: 4 }, { hover: true });
  });

  it("tiles without ids: one hint naming promoteId with the source layer, and no feature-state write", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const map = mockMap();
    attachInteractions(map, highlight);
    fire(map, "mousemove", tileFeature(undefined));
    fire(map, "mousemove", tileFeature(undefined));
    expect(map.setFeatureState).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('add "promoteId: { pluto: <property> }" to source "parcels"');
    expect(warn.mock.calls[0]![0]).not.toContain("generateId");
  });

  it("under the renderer, the hint goes to the host's hint channel (the page while developing)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onHint = vi.fn();
    const map = mockMap();
    const handler = new EventHandler(map, { onHint });
    handler.attachEvents({
      id: "lots",
      type: "fill",
      source: "parcels",
      "source-layer": "pluto",
      interactive: { hover: { highlight: true } },
    } as any);
    fire(map, "mousemove", tileFeature(undefined));
    fire(map, "mousemove", tileFeature(undefined));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(onHint.mock.calls[0]![0]).toBe("lots");
    expect(onHint.mock.calls[0]![1]).toContain("`promoteId: { pluto: <property> }`");
    expect(warn).not.toHaveBeenCalled();
  });
});
