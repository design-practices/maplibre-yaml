/**
 * @file Runtime feature re-sync, camera and the chunk entry (live documents, U4)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * `runUpdate(host, request)` — the engine chunk's entry — diffs, applies the
 * operations and then re-syncs every runtime feature whose inputs changed
 * (KTD6b), moves the camera by ownership (KTD13) and reports the summary.
 * The engine reaches the renderer only through `UpdateHost`, so the
 * renderer-owned features are asserted as calls on the host's `runtime`
 * surface; what those calls do on a real renderer is `update-renderer.test.ts`.
 * Each test maps to one bullet of the plan's U4 test scenarios
 * (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 */

import { describe, it, expect, vi } from "vitest";

const popupInstance = {
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  setDOMContent: vi.fn().mockReturnThis(),
  on: vi.fn(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => popupInstance);
  return { default: { Popup }, Popup };
});

import { runUpdate } from "../../src/renderer/update/index";
import type { AppliedDocument, DiffHints, UpdateHost } from "../../src/renderer/update/types";
import { LayerManager } from "../../src/renderer/layer-manager";
import { EventHandler } from "../../src/renderer/event-handler";
import type { Layer } from "../../src/schemas/layer.schema";

const EMPTY = { type: "FeatureCollection", features: [] } as const;
const POINT = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} }],
} as const;
const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

type StyleLayer = { id: string; type: string; source?: string; paint: Record<string, unknown>; layout: Record<string, unknown> };

/** A map double whose style keeps a real layer order and source table, plus the camera and option setters. */
function createMockMap() {
  const layers: StyleLayer[] = [{ id: "land", type: "fill", source: "basemap", paint: {}, layout: {} }];
  const sources: Record<string, any> = { basemap: { type: "vector" } };
  const find = (id: string) => layers.findIndex((l) => l.id === id);
  const mustFind = (id: string) => {
    const index = find(id);
    if (index < 0) throw new Error(`The layer '${id}' does not exist in the map's style.`);
    return index;
  };
  return {
    order: () => layers.map((l) => l.id),
    getStyle: vi.fn(() => ({ layers: layers.map((l) => ({ ...l })), sources: { ...sources } })),
    getLayer: vi.fn((id: string) => layers[find(id)]),
    addLayer: vi.fn((spec: any, before?: string) => {
      if (find(spec.id) >= 0) throw new Error(`Layer "${spec.id}" already exists on this map.`);
      const entry: StyleLayer = { paint: {}, layout: {}, ...spec, paint: { ...(spec.paint ?? {}) }, layout: { ...(spec.layout ?? {}) } };
      if (before === undefined) layers.push(entry);
      else layers.splice(mustFind(before), 0, entry);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.splice(mustFind(id), 1);
    }),
    moveLayer: vi.fn((id: string, before?: string) => {
      const [entry] = layers.splice(mustFind(id), 1);
      if (before === undefined) layers.push(entry!);
      else layers.splice(mustFind(before), 0, entry!);
    }),
    addSource: vi.fn((id: string, spec: any) => {
      if (sources[id]) throw new Error("There is already a source with this ID");
      sources[id] = { ...spec, setData: vi.fn() };
    }),
    removeSource: vi.fn((id: string) => {
      delete sources[id];
    }),
    getSource: vi.fn((id: string) => sources[id]),
    setPaintProperty: vi.fn((id: string, property: string, value: unknown) => {
      layers[mustFind(id)]!.paint[property] = value;
    }),
    setLayoutProperty: vi.fn((id: string, property: string, value: unknown) => {
      layers[mustFind(id)]!.layout[property] = value;
    }),
    setFilter: vi.fn(),
    setLayerZoomRange: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    setMinZoom: vi.fn(),
    setMaxZoom: vi.fn(),
    setMaxBounds: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  };
}

type MockMap = ReturnType<typeof createMockMap>;

/** The host `MapRenderer.update` builds, over real layer and event collaborators and a spied runtime surface. */
function createHost(map: MockMap, camera: "document" | "host" = "document") {
  const onError = vi.fn();
  const layerManager = new LayerManager(map as any, {
    onLayerHint: (layerId, message) => onError(new Error(message), false, { kind: "layer-hint", layerId }),
  });
  const eventHandler = new EventHandler(map as any, {});
  const controlsManager = { removeAllControls: vi.fn(), addControls: vi.fn() };
  const runtime = {
    syncLegend: vi.fn(),
    syncParamsPanel: vi.fn(),
    syncMarkers: vi.fn(),
    syncPopups: vi.fn(),
    syncClassify: vi.fn(),
    syncState: vi.fn(),
    setTitle: vi.fn(),
    loadImages: vi.fn(async () => undefined),
    applyScene: vi.fn(),
    fitTo: vi.fn(),
  };
  const host: UpdateHost = {
    map: map as any,
    layerManager,
    eventHandler,
    controlsManager: controlsManager as any,
    camera,
    runtime,
    onError: (error, context) => onError(error, false, context),
    reattachEffects: vi.fn(),
    prepareLayer: (layer) => layer,
    emit: vi.fn(),
  };
  return { host, map, layerManager, onError, controlsManager, runtime };
}

function circle(id: string, extra: Record<string, unknown> = {}, data: unknown = EMPTY): Layer {
  return { id, type: "circle", source: { type: "geojson", data }, paint: { "circle-color": "#f00", "circle-radius": 4 }, ...extra } as Layer;
}

function doc(layers: Layer[], extra: Partial<AppliedDocument> = {}): AppliedDocument {
  return {
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as AppliedDocument["config"],
    layers,
    sources: {},
    options: {},
    ...extra,
  };
}

/** Put the applied document's layers on the map the way first render does. */
async function seed(host: { layerManager: LayerManager }, applied: AppliedDocument) {
  for (const layer of applied.layers) await host.layerManager.addLayer(layer);
}

async function update(applied: AppliedDocument, next: AppliedDocument, camera: "document" | "host" = "document") {
  const h = createHost(createMockMap(), camera);
  await seed(h, applied);
  const result = await runUpdate(h.host, { applied, next, hints: NO_HINTS });
  return { ...h, result };
}

describe("runUpdate: the summary and the legend", () => {
  it("a paint change yields one propertiesSet record and no legend rebuild when legend inputs are unchanged", async () => {
    const applied = doc([circle("a")]);
    const next = doc([circle("a", { paint: { "circle-color": "#f00", "circle-radius": 8 } })]);
    const { result, runtime, map } = await update(applied, next);
    expect(result.changed).toBe(true);
    expect(result.summary.propertiesSet).toEqual([{ layerId: "a", property: "circle-radius" }]);
    expect(map.setPaintProperty).toHaveBeenCalledWith("a", "circle-radius", 8);
    expect(runtime.syncLegend).not.toHaveBeenCalled();
    expect(runtime.syncParamsPanel).not.toHaveBeenCalled();
    expect(runtime.syncClassify).not.toHaveBeenCalled();
  });

  it("a colour change redraws the legend over the next layers", async () => {
    const next = doc([circle("a", { paint: { "circle-color": "#0f0", "circle-radius": 4 } })]);
    const { runtime } = await update(doc([circle("a")]), next);
    expect(runtime.syncLegend).toHaveBeenCalledTimes(1);
    expect(runtime.syncLegend).toHaveBeenCalledWith(next.layers, undefined);
  });

  it("a legend block change redraws it, even with the layers unchanged", async () => {
    const next = doc([circle("a")], { options: { legend: { position: "bottom-left" } as never } });
    const { runtime } = await update(doc([circle("a")]), next);
    expect(runtime.syncLegend).toHaveBeenCalledWith(next.layers, { position: "bottom-left" });
  });

  it("changing classify.field re-seeds classify for that layer and redraws the legend (AE11)", async () => {
    const record = (field: string) => ({ field, method: "quantile", classes: 3, breaks: [1, 2], colors: ["#a", "#b", "#c"] });
    const applied = doc([circle("a", { metadata: { "maplibre-yaml:classify": record("pop") } }), circle("b")]);
    const next = doc([circle("a", { metadata: { "maplibre-yaml:classify": record("area") } }), circle("b")]);
    const { runtime } = await update(applied, next);
    expect(runtime.syncClassify).toHaveBeenCalledTimes(1);
    expect(runtime.syncClassify).toHaveBeenCalledWith(next.layers, next.sources, ["a"]);
    expect(runtime.syncLegend).toHaveBeenCalledWith(next.layers, undefined);
  });

  it("equal documents change nothing and touch no feature", async () => {
    const { result, runtime, map } = await update(doc([circle("a")]), doc([circle("a")]));
    expect(result.changed).toBe(false);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    for (const fn of Object.values(runtime)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("runUpdate: camera ownership (KTD13, AE6)", () => {
  it("center unchanged: no easeTo", async () => {
    const { map, result } = await update(doc([circle("a")]), doc([circle("a", { paint: { "circle-color": "#00f" } })]));
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(result.summary.cameraMoved).toBe(false);
  });

  it("center changed: one easeTo with the 300 ms feel", async () => {
    const next = doc([circle("a")]);
    next.config = { ...next.config, center: [10, 20] };
    const { map, result } = await update(doc([circle("a")]), next);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [10, 20], duration: 300 });
    expect(result.summary.cameraMoved).toBe(true);
  });

  it("camera: 'host': never moves the camera, and says so in the summary", async () => {
    const next = doc([circle("a")]);
    next.config = { ...next.config, center: [10, 20], zoom: 9, fitTo: { source: "pts" } } as never;
    next.sources = { pts: { type: "geojson", data: POINT } as never };
    const applied = doc([circle("a")]);
    applied.sources = { pts: { type: "geojson", data: POINT } as never };
    const { map, runtime, result } = await update(applied, next, "host");
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(runtime.fitTo).not.toHaveBeenCalled();
    expect(result.summary.cameraMoved).toBe(false);
  });

  it("a fitTo added in the next document fits once; the same fitTo over new data does not fit again", async () => {
    const withData = (data: unknown, fitTo?: unknown) => {
      const d = doc([{ id: "a", type: "circle", source: "pts", paint: {} } as Layer]);
      d.sources = { pts: { type: "geojson", data } as never };
      if (fitTo) d.config = { ...d.config, fitTo } as never;
      return d;
    };
    const first = withData(EMPTY);
    const second = withData(EMPTY, { source: "pts" });
    const third = withData(POINT, { source: "pts" });
    const h = createHost(createMockMap());
    h.layerManager.registerSources(first.sources as never);
    await seed(h, first);
    await runUpdate(h.host, { applied: first, next: second, hints: NO_HINTS });
    expect(h.runtime.fitTo).toHaveBeenCalledTimes(1);
    expect(h.runtime.fitTo).toHaveBeenCalledWith({ source: "pts" }, second.sources);
    const result = await runUpdate(h.host, { applied: second, next: third, hints: NO_HINTS });
    expect(h.runtime.fitTo).toHaveBeenCalledTimes(1);
    expect(result.summary.cameraMoved).toBe(false);
    expect(result.changed).toBe(true); // the data change itself applied
  });

  it("settable config keys go through the map's setters", async () => {
    const next = doc([circle("a")]);
    next.config = { ...next.config, minZoom: 3, maxZoom: 12 } as never;
    const { map } = await update(doc([circle("a")]), next);
    expect(map.setMinZoom).toHaveBeenCalledWith(3);
    expect(map.setMaxZoom).toHaveBeenCalledWith(12);
  });
});

describe("runUpdate: runtime features (KTD6b)", () => {
  it("adding a markers block creates markers; removing popups destroys them", async () => {
    const applied = doc([circle("a")], { options: { popups: [{ at: [0, 0], content: "hi" }] as never } });
    const next = doc([circle("a")], { options: { markers: [{ at: [1, 1] }] as never } });
    const { runtime } = await update(applied, next);
    expect(runtime.syncMarkers).toHaveBeenCalledWith([{ at: [1, 1] }]);
    expect(runtime.syncPopups).toHaveBeenCalledWith(undefined);
  });

  it("a controls change removes every control and adds the next block's", async () => {
    const next = doc([circle("a")], { options: { controls: { navigation: true } as never } });
    const { controlsManager } = await update(doc([circle("a")]), next);
    expect(controlsManager.removeAllControls).toHaveBeenCalledTimes(1);
    expect(controlsManager.addControls).toHaveBeenCalledWith({ navigation: true });
    expect(controlsManager.removeAllControls.mock.invocationCallOrder[0]).toBeLessThan(
      controlsManager.addControls.mock.invocationCallOrder[0]!
    );
  });

  it("removing the controls block removes them and adds none", async () => {
    const applied = doc([circle("a")], { options: { controls: { navigation: true } as never } });
    const { controlsManager } = await update(applied, doc([circle("a")]));
    expect(controlsManager.removeAllControls).toHaveBeenCalledTimes(1);
    expect(controlsManager.addControls).not.toHaveBeenCalled();
  });

  it("title and description changes rename the map", async () => {
    const next = doc([circle("a")], { options: { title: "Parks", description: "Every park" } });
    const { runtime } = await update(doc([circle("a")]), next);
    expect(runtime.setTitle).toHaveBeenCalledTimes(1);
    expect(runtime.setTitle).toHaveBeenCalledWith("Parks", "Every park");
  });

  it("only newly referenced images load, before the layers that use them are placed", async () => {
    const applied = doc([circle("a")], { options: { images: { pin: "pin.png" } as never } });
    const next = doc([circle("a"), circle("b", { layout: { "icon-image": "star" } })], {
      options: { images: { pin: "pin.png", star: { url: "star.png" } } as never },
    });
    const h = createHost(createMockMap());
    await seed(h, applied);
    await runUpdate(h.host, { applied, next, hints: NO_HINTS });
    expect(h.runtime.loadImages).toHaveBeenCalledTimes(1);
    expect(h.runtime.loadImages).toHaveBeenCalledWith({ star: { url: "star.png" } });
    expect(h.runtime.loadImages.mock.invocationCallOrder[0]).toBeLessThan(h.map.addLayer.mock.invocationCallOrder.at(-1)!);
  });

  it("3D and projection options go through the scene helpers", async () => {
    const applied = doc([circle("a")], { options: { terrain: { source: "dem" } as never } });
    const next = doc([circle("a")], { options: { projection: { type: "globe" } as never, sky: { "sky-color": "#88c" } as never } });
    const { runtime } = await update(applied, next);
    expect(runtime.applyScene).toHaveBeenCalledWith("projection", { type: "globe" });
    expect(runtime.applyScene).toHaveBeenCalledWith("sky", { "sky-color": "#88c" });
    expect(runtime.applyScene).toHaveBeenCalledWith("terrain", undefined);
    expect(runtime.applyScene).not.toHaveBeenCalledWith("light", expect.anything());
  });

  it("the params panel rebuilds when parameters, state keys or the toggleable-layer set change", async () => {
    const base = doc([circle("a")], { options: { state: { k: { default: 1 } } } });
    // A changed default, same keys: no panel rebuild, the state re-syncs.
    let h = await update(base, doc([circle("a")], { options: { state: { k: { default: 2 } } } }));
    expect(h.runtime.syncParamsPanel).not.toHaveBeenCalled();
    expect(h.runtime.syncState).toHaveBeenCalledWith({ k: { default: 2 } }, ["k"]);
    // A new key.
    h = await update(base, doc([circle("a")], { options: { state: { k: { default: 1 }, j: { default: 0 } } } }));
    expect(h.runtime.syncParamsPanel).toHaveBeenCalledTimes(1);
    // Parameters metadata.
    h = await update(base, doc([circle("a")], { options: { state: { k: { default: 1 } }, parameters: { k: { label: "K" } } } }));
    expect(h.runtime.syncParamsPanel).toHaveBeenCalledTimes(1);
    // A layer gains a label, so it joins the toggles.
    const labelled = doc([circle("a", { label: "Points" })], { options: { state: { k: { default: 1 } } } });
    h = await update(base, labelled);
    expect(h.runtime.syncParamsPanel).toHaveBeenCalledWith(labelled.layers, labelled.options);
    // A paint change alone leaves the panel alone.
    h = await update(base, doc([circle("a", { paint: { "circle-color": "#00f" } })], { options: { state: { k: { default: 1 } } } }));
    expect(h.runtime.syncParamsPanel).not.toHaveBeenCalled();
  });
});

describe("runUpdate: effects (KTD6b)", () => {
  const fx = { type: "tonal-hatch", gain: 0.5 };

  it("adding an effect: block re-attaches effects once", async () => {
    const { host } = await update(doc([circle("a")]), doc([circle("a", { effect: fx })]));
    expect(host.reattachEffects).toHaveBeenCalledTimes(1);
  });

  it("a paint-only change on an effect-bearing layer does not", async () => {
    const applied = doc([circle("a", { effect: fx })]);
    const next = doc([circle("a", { effect: fx, paint: { "circle-color": "#00f", "circle-radius": 4 } })]);
    const { host } = await update(applied, next);
    expect(host.reattachEffects).not.toHaveBeenCalled();
  });

  it("moving or replacing an effect-bearing layer does, so its ::fx- layer follows it", async () => {
    const applied = doc([circle("a", { effect: fx }), circle("b"), circle("c")]);
    // The differ moves the fewest layers: `a` to the top, `b` and `c` stay.
    const moved = doc([circle("b"), circle("c"), circle("a", { effect: fx })]);
    let h = await update(applied, moved);
    expect(h.result.summary.moved).toEqual(["a"]);
    expect(h.host.reattachEffects).toHaveBeenCalledTimes(1);
    const replaced = doc([{ ...circle("a", { effect: fx }), type: "symbol" } as Layer, circle("b"), circle("c")]);
    h = await update(applied, replaced);
    expect(h.result.summary.replaced).toEqual(["a"]);
    expect(h.host.reattachEffects).toHaveBeenCalledTimes(1);
  });

  it("a move that leaves every effect-bearing layer in place does not", async () => {
    const applied = doc([circle("a", { effect: fx }), circle("b"), circle("c")]);
    const { host, result } = await update(applied, doc([circle("a", { effect: fx }), circle("c"), circle("b")]));
    expect(result.summary.moved).not.toContain("a");
    expect(host.reattachEffects).not.toHaveBeenCalled();
  });

  it("removing the effect: block re-attaches too (the ::fx- layer goes)", async () => {
    const { host } = await update(doc([circle("a", { effect: fx })]), doc([circle("a")]));
    expect(host.reattachEffects).toHaveBeenCalledTimes(1);
  });
});

describe("runUpdate: fallback and failures", () => {
  it("a fallback diff applies nothing and reports the rebuild", async () => {
    const next = doc([circle("a", { paint: { "circle-color": "#00f" } })]);
    next.config = { ...next.config, mapStyle: "https://example.com/other.json" };
    const { result, map } = await update(doc([circle("a")]), next);
    expect(result.summary.rebuild).toBe(true);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("a throwing setter in the re-sync is a recorded failure, not an abort", async () => {
    const next = doc([circle("a")]);
    next.config = { ...next.config, minZoom: 3, center: [5, 5] } as never;
    const h = createHost(createMockMap());
    h.map.setMinZoom.mockImplementation(() => {
      throw new Error("bad zoom");
    });
    await seed(h, doc([circle("a")]));
    const result = await runUpdate(h.host, { applied: doc([circle("a")]), next, hints: NO_HINTS });
    expect(result.summary.failures).toEqual([{ op: "optionSet", message: "bad zoom" }]);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.map.easeTo).toHaveBeenCalledTimes(1); // the camera still moved
  });
});
