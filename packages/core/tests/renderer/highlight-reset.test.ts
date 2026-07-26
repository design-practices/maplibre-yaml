/**
 * Highlight state is dropped whenever a layer's data is replaced.
 *
 * @remarks
 * Feature-state is keyed by feature id and survives `setData`. Ids are only
 * meaningful within one dataset, so a highlight id retained across a refresh
 * lights up whichever feature now holds that id — a different one. Both paths
 * that replace data have to clear it: the polling/stream refresh, and the
 * public `updateLayerData`.
 *
 * The refresh path is covered here rather than in the integration suite
 * because it fires from inside `LayerManager`'s polling pipeline; mocking the
 * manager is the only way to invoke the callback without standing up a real
 * fetch loop.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const layerCallbacks: { current: any } = { current: null };

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    getSource: vi.fn(),
    addLayer: vi.fn(),
    getLayer: vi.fn(),
    setFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  }));
  return { default: { Map }, Map };
});

// Capture the callbacks MapRenderer hands the manager, so the refresh
// notification can be fired directly.
vi.mock("../../src/renderer/layer-manager", () => ({
  LayerManager: vi.fn().mockImplementation((_map, callbacks) => {
    layerCallbacks.current = callbacks;
    return {
      addLayer: vi.fn().mockResolvedValue(undefined),
      removeLayer: vi.fn(),
      updateData: vi.fn(),
      setVisibility: vi.fn(),
      registerSources: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

import { MapRenderer } from "../../src/renderer/map-renderer";

describe("highlight is cleared when layer data is replaced", () => {
  let container: HTMLElement;
  let resetSpy: ReturnType<typeof vi.spyOn>;
  let renderer: MapRenderer;

  const config = {
    center: [0, 0] as [number, number],
    zoom: 1,
    mapStyle: "https://demotiles.maplibre.org/style.json",
  };

  beforeEach(() => {
    layerCallbacks.current = null;
    container = document.createElement("div");
    document.body.appendChild(container);

    renderer = new MapRenderer(container, config);
    resetSpy = vi.spyOn(
      (renderer as any).eventHandler,
      "resetFeatureState"
    );
  });

  it("clears on a refresh that delivered new data", () => {
    expect(layerCallbacks.current?.onDataLoaded).toBeTypeOf("function");

    layerCallbacks.current.onDataLoaded("pts", 12);

    // This is the bead's scenario: polling replaced the features underneath a
    // hovered layer.
    expect(resetSpy).toHaveBeenCalledWith("pts");
  });

  it("clears on a programmatic data update", () => {
    renderer.updateLayerData("pts", {
      type: "FeatureCollection",
      features: [],
    } as any);

    expect(resetSpy).toHaveBeenCalledWith("pts");
  });

  it("does not clear on an unrelated lifecycle event", () => {
    layerCallbacks.current.onDataLoading?.("pts");

    // Loading has not replaced anything yet; dropping the highlight here would
    // make it flicker on every poll rather than only when data actually lands.
    expect(resetSpy).not.toHaveBeenCalled();
  });
});
