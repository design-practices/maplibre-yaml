/**
 * @file Applying layer operations on a live map (live documents, U2)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * `applyOps(host, request)` consumes the differ's operation list and drives
 * the map only through the injected `UpdateHost`: document-only reordering
 * (KTD3), existence reconciliation (KTD1), end-of-diff source reference
 * settlement (KTD4) and per-operation failures on both channels (KTD7).
 * Each test maps to one bullet of the plan's U2 test scenarios
 * (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 *
 * The map is a style-backed double: it keeps a layer order and a source
 * table, so ordering assertions read the resulting stack rather than the
 * calls that produced it. Where real MapLibre fires an error event, the
 * double throws, so a bug surfaces as a failure rather than a silent skip.
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

import { applyOps } from "../../src/renderer/update/apply";
import { diff } from "../../src/renderer/update/diff";
import type { AppliedDocument, DiffHints, UpdateHost } from "../../src/renderer/update/types";
import { LayerManager } from "../../src/renderer/layer-manager";
import { EventHandler } from "../../src/renderer/event-handler";
import type { Layer } from "../../src/schemas/layer.schema";
import type { LayerSource } from "../../src/schemas/source.schema";

const EMPTY = { type: "FeatureCollection", features: [] } as const;
const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

type StyleLayer = { id: string; type: string; source?: string; paint: Record<string, unknown>; layout: Record<string, unknown>; filter?: unknown; minzoom?: number; maxzoom?: number };

/** A map double whose style keeps a real layer order and source table. */
function createMockMap(basemap: string[] = ["land", "water"]) {
  const layers: StyleLayer[] = basemap.map((id) => ({ id, type: "fill", source: "basemap", paint: {}, layout: {} }));
  const sources: Record<string, any> = { basemap: { type: "vector" } };
  const find = (id: string) => layers.findIndex((l) => l.id === id);
  const mustFind = (id: string) => {
    const index = find(id);
    if (index < 0) throw new Error(`The layer '${id}' does not exist in the map's style.`);
    return index;
  };
  const map = {
    order: () => layers.map((l) => l.id),
    layer: (id: string) => layers[find(id)],
    getStyle: vi.fn(() => ({ layers: layers.map((l) => ({ ...l })), sources: { ...sources } })),
    getLayer: vi.fn((id: string) => layers[find(id)]),
    addLayer: vi.fn((spec: any, before?: string) => {
      if (find(spec.id) >= 0) throw new Error(`Layer "${spec.id}" already exists on this map.`);
      const entry: StyleLayer = { paint: {}, layout: {}, ...spec, paint: { ...(spec.paint ?? {}) }, layout: { ...(spec.layout ?? {}) } };
      if (before === undefined) layers.push(entry);
      else {
        const index = find(before);
        if (index < 0) throw new Error(`Layer with id "${before}" does not exist on this map.`);
        layers.splice(index, 0, entry);
      }
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
    setFilter: vi.fn((id: string, filter: unknown) => {
      layers[mustFind(id)]!.filter = filter;
    }),
    setLayerZoomRange: vi.fn((id: string, min: number | null, max: number | null) => {
      const entry = layers[mustFind(id)]!;
      if (min != null) entry.minzoom = min;
      if (max != null) entry.maxzoom = max;
    }),
    on: vi.fn(),
    off: vi.fn(),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  };
  return map;
}

type MockMap = ReturnType<typeof createMockMap>;

/** The host `MapRenderer.update` will build (U4), over real collaborators. */
function createHost(map: MockMap) {
  /** The renderer's `options.onError(error, fatal, context)` shape. */
  const onError = vi.fn();
  const layerManager = new LayerManager(map as any, {
    onLayerHint: (layerId, message) => onError(new Error(message), false, { kind: "layer-hint", layerId }),
  });
  const eventHandler = new EventHandler(map as any, {});
  const emit = vi.fn();
  const host: UpdateHost = {
    map: map as any,
    layerManager,
    eventHandler,
    controlsManager: {} as any,
    onError: (error, context) => onError(error, false, context),
    reattachEffects: vi.fn(),
    prepareLayer: (layer) => layer,
    emit,
  };
  return { host, map, layerManager, eventHandler, onError, emit };
}

type Host = ReturnType<typeof createHost>;

function layer(id: string, overrides: Record<string, unknown> = {}): Layer {
  return {
    id,
    type: "circle",
    visible: true,
    toggleable: false,
    source: { type: "geojson", data: EMPTY },
    paint: { "circle-color": "#f00" },
    ...overrides,
  } as unknown as Layer;
}

function doc(layers: Layer[], sources: Record<string, LayerSource> = {}): AppliedDocument {
  return {
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as AppliedDocument["config"],
    layers,
    sources,
    options: {},
  };
}

const named = (extra: Record<string, unknown> = {}): LayerSource =>
  ({ type: "geojson", data: EMPTY, ...extra }) as unknown as LayerSource;

/** First render, as `MapRenderer` does it: named sources, then each layer and its events. */
async function render(h: Host, document: AppliedDocument): Promise<void> {
  h.layerManager.registerSources(document.sources);
  for (const entry of document.layers) {
    await h.layerManager.addLayer(entry);
    h.eventHandler.attachEvents(entry);
  }
}

/** Diff and apply, the way `update()` will chain them. */
async function update(h: Host, applied: AppliedDocument, next: AppliedDocument) {
  const { ops, summary } = diff(applied, next, NO_HINTS);
  return applyOps(h.host, { applied, next, ops, summary });
}

/** A layer the host added behind the document's back. */
function hostAddsLayer(map: MockMap, id: string, before?: string, source = "basemap"): void {
  map.addLayer({ id, type: "line", source }, before);
  map.addLayer.mockClear();
}

describe("applyOps: ordering (KTD3)", () => {
  it("reorders a, b, c to c, a, b moving only document layers, and the stack ends c, a, b (AE1)", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b"), layer("c")]);
    await render(h, applied);
    expect(h.map.order()).toEqual(["land", "a", "b", "c"]);

    const summary = await update(h, applied, doc([layer("c"), layer("a"), layer("b")]));

    expect(h.map.order()).toEqual(["land", "c", "a", "b"]);
    const movedIds = h.map.moveLayer.mock.calls.map(([id]) => id);
    expect(movedIds.length).toBeGreaterThan(0);
    for (const id of movedIds) expect(["a", "b", "c"]).toContain(id);
    expect(summary.failures).toEqual([]);
    expect(h.map.addLayer).not.toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), expect.anything());
  });

  it("never moves a host layer sitting between document layers; it is still there after the reorder (AE5)", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b"), layer("c")]);
    await render(h, applied);
    hostAddsLayer(h.map, "h", "b");
    expect(h.map.order()).toEqual(["land", "a", "h", "b", "c"]);

    await update(h, applied, doc([layer("c"), layer("a"), layer("b")]));

    expect(h.map.moveLayer).not.toHaveBeenCalledWith("h", expect.anything());
    expect(h.map.moveLayer).not.toHaveBeenCalledWith("h");
    expect(h.map.removeLayer).not.toHaveBeenCalledWith("h");
    expect(h.map.order()).toEqual(["land", "c", "a", "h", "b"]);
  });

  it("places adjacent new layers in document position even though each anchors on the other", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a")]);
    await render(h, applied);

    const summary = await update(h, applied, doc([layer("x"), layer("y"), layer("a")]));

    expect(summary.failures).toEqual([]);
    expect(h.map.order()).toEqual(["land", "x", "y", "a"]);
  });

  it("moves a run of layers to the front in document order", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b"), layer("c"), layer("d")]);
    await render(h, applied);

    const summary = await update(h, applied, doc([layer("d"), layer("c"), layer("a"), layer("b")]));

    expect(summary.failures).toEqual([]);
    expect(h.map.order()).toEqual(["land", "d", "c", "a", "b"]);
  });

  it("honours before: naming a basemap layer; before: contradicting document order yields and hints once across two updates", async () => {
    const h = createHost(createMockMap(["land", "water"]));
    const applied = doc([layer("a"), layer("b"), layer("c")]);
    await render(h, applied);

    // `under` goes below the basemap's water; `c` claims a place before `a`
    // that document order contradicts.
    const next = doc([layer("under", { before: "water" }), layer("a"), layer("b"), layer("c", { before: "a" })]);
    const first = await update(h, applied, next);

    expect(first.failures).toEqual([]);
    expect(h.map.order()).toEqual(["land", "under", "water", "a", "b", "c"]);
    const hints = () => h.onError.mock.calls.filter(([, , context]) => context?.kind === "layer-hint");
    expect(hints()).toHaveLength(1);
    expect(hints()[0]![0].message).toMatch(/before: a/);
    expect(hints()[0]![2]).toEqual({ kind: "layer-hint", layerId: "c" });

    // The same contradiction on the next update: the hint is not re-spammed.
    const again = { ...next, layers: next.layers.map((l) => (l.id === "a" ? layer("a", { paint: { "circle-color": "#0f0" } }) : l)) };
    await update(h, next, again);
    expect(hints()).toHaveLength(1);
    expect(h.map.order()).toEqual(["land", "under", "water", "a", "b", "c"]);
  });
});

describe("applyOps: source reference settlement (KTD4)", () => {
  it("two layers swapping named sources never remove a source; the counts end where they started", async () => {
    const h = createHost(createMockMap(["land"]));
    const sources = { s1: named(), s2: named() };
    const applied = doc([layer("a", { source: "s1" }), layer("b", { source: "s2" })], sources);
    await render(h, applied);
    expect(h.layerManager.sourceRefCount("s1")).toBe(1);
    expect(h.layerManager.sourceRefCount("s2")).toBe(1);

    const summary = await update(h, applied, doc([layer("a", { source: "s2" }), layer("b", { source: "s1" })], sources));

    expect(summary.failures).toEqual([]);
    expect(summary.replaced).toEqual(["a", "b"]);
    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.layerManager.sourceRefCount("s1")).toBe(1);
    expect(h.layerManager.sourceRefCount("s2")).toBe(1);
    expect(h.map.layer("a")!.source).toBe("s2");
    expect(h.map.layer("b")!.source).toBe("s1");
    expect(h.map.order()).toEqual(["land", "a", "b"]);
  });

  it("a layerReplace that throws during a source swap leaves the counts consistent and the source alive", async () => {
    const h = createHost(createMockMap(["land"]));
    const sources = { s1: named(), s2: named() };
    const applied = doc([layer("a", { source: "s1" }), layer("b", { source: "s2" })], sources);
    await render(h, applied);
    const addLayer = h.map.addLayer.getMockImplementation()!;
    h.map.addLayer.mockImplementation((spec: any, before?: string) => {
      if (spec.id === "a") throw new Error("boom");
      return addLayer(spec, before);
    });

    const summary = await update(h, applied, doc([layer("a", { source: "s2" }), layer("b", { source: "s1" })], sources));

    expect(summary.failures).toEqual([{ op: "layerReplace", message: expect.stringContaining("boom"), layerId: "a" }]);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "layer", layerId: "a" });
    // `a` is gone, `b` draws s1: s1 has one reference, s2 none, both sources alive.
    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.map.getSource("s1")).toBeDefined();
    expect(h.map.getSource("s2")).toBeDefined();
    expect(h.layerManager.sourceRefCount("s1")).toBe(1);
    expect(h.layerManager.sourceRefCount("s2")).toBe(0);
    expect(h.layerManager.ownsLayer("a")).toBe(false);
    expect(h.map.order()).toEqual(["land", "b"]);
  });

  it("the last document layer on a source is removed while a host layer draws from it: the source stays and one failure is recorded", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { source: "s" })], { s: named() });
    await render(h, applied);
    hostAddsLayer(h.map, "h", undefined, "s");

    const summary = await update(h, applied, doc([]));

    expect(h.map.order()).toEqual(["land", "h"]);
    expect(h.map.removeSource).not.toHaveBeenCalled();
    expect(h.map.getSource("s")).toBeDefined();
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toEqual({ op: "sourceRemove", message: expect.stringContaining('"h"'), sourceId: "s" });
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "source", sourceId: "s" });
  });

  it("a named source nothing draws any more is removed after settlement", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { source: "s" })], { s: named() });
    await render(h, applied);

    const summary = await update(h, applied, doc([]));

    expect(summary.failures).toEqual([]);
    expect(h.map.removeSource).toHaveBeenCalledWith("s");
    expect(h.map.getSource("s")).toBeUndefined();
  });
});

describe("applyOps: replacement", () => {
  it("replacing a layer by type re-adds it before the same neighbour and re-attaches click and hover handlers", async () => {
    const h = createHost(createMockMap(["land"]));
    const interactive = { click: { popup: [{ p: [{ property: "name" }] }] }, hover: { cursor: "pointer" } };
    const applied = doc([layer("a", { interactive }), layer("b"), layer("c")]);
    await render(h, applied);
    h.map.on.mockClear();
    h.map.off.mockClear();

    const summary = await update(h, applied, doc([layer("a", { type: "fill", interactive, paint: { "fill-color": "#0f0" } }), layer("b"), layer("c")]));

    expect(summary.failures).toEqual([]);
    expect(summary.replaced).toEqual(["a"]);
    expect(h.map.order()).toEqual(["land", "a", "b", "c"]);
    expect(h.map.layer("a")!.type).toBe("fill");
    expect(h.map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "a", type: "fill" }), "b");
    const offEvents = h.map.off.mock.calls.filter(([, id]) => id === "a").map(([event]) => event);
    expect(offEvents).toEqual(expect.arrayContaining(["click", "mouseenter", "mouseleave"]));
    const onEvents = h.map.on.mock.calls.filter(([, id]) => id === "a").map(([event]) => event);
    expect(onEvents).toEqual(expect.arrayContaining(["click", "mouseenter", "mouseleave"]));
    expect(h.emit).toHaveBeenCalledWith("layer:removed", { layerId: "a" });
    expect(h.emit).toHaveBeenCalledWith("layer:added", { layerId: "a" });
  });

  it("a replaced last layer stays below a host layer above it", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b")]);
    await render(h, applied);
    hostAddsLayer(h.map, "h");

    await update(h, applied, doc([layer("a"), layer("b", { type: "fill", paint: {} })]));

    expect(h.map.order()).toEqual(["land", "a", "b", "h"]);
  });

  it("adding hover.highlight replaces the layer through the claim path: wrapped paint and generated ids (ml-aot.142)", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b")]);
    await render(h, applied);
    h.map.addSource.mockClear();

    const summary = await update(h, applied, doc([layer("a", { interactive: { hover: { highlight: true } } }), layer("b")]));

    expect(summary.failures).toEqual([]);
    expect(h.map.addSource).toHaveBeenCalledWith("a-source", expect.objectContaining({ generateId: true }));
    expect(h.map.layer("a")!.paint["circle-color"]).toEqual(["case", ["boolean", ["feature-state", "hover"], false], expect.anything(), "#f00"]);
    expect(h.map.order()).toEqual(["land", "a", "b"]);
    expect(h.layerManager.ownsLayer("a")).toBe(true);
  });
});

describe("applyOps: property sets (R10)", () => {
  it("leaves a paint value the host changed on an unchanged key alone; a changed document value overwrites it", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { paint: { "circle-color": "#f00", "circle-opacity": 0.5 } })]);
    await render(h, applied);
    h.map.setPaintProperty("a", "circle-opacity", 0.9);
    h.map.setPaintProperty.mockClear();

    const next = doc([layer("a", { paint: { "circle-color": "#00f", "circle-opacity": 0.5 } })]);
    await update(h, applied, next);

    expect(h.map.setPaintProperty).toHaveBeenCalledTimes(1);
    expect(h.map.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "#00f");
    expect(h.map.layer("a")!.paint).toEqual({ "circle-color": "#00f", "circle-opacity": 0.9 });

    await update(h, next, doc([layer("a", { paint: { "circle-color": "#00f", "circle-opacity": 0.2 } })]));
    expect(h.map.layer("a")!.paint["circle-opacity"]).toBe(0.2);
  });

  it("routes layout, filter, zoom and visibility through their setters and skips runtime keys", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { layout: { "circle-sort-key": 1 }, minzoom: 2, filter: ["==", "a", 1] })]);
    await render(h, applied);

    const summary = await update(
      h,
      applied,
      doc([layer("a", { layout: { "circle-sort-key": 2 }, minzoom: 4, maxzoom: 12, filter: ["==", "a", 2], visible: false, label: "Points" })])
    );

    expect(summary.failures).toEqual([]);
    expect(h.map.setLayoutProperty).toHaveBeenCalledWith("a", "circle-sort-key", 2);
    expect(h.map.setLayoutProperty).toHaveBeenCalledWith("a", "visibility", "none");
    expect(h.map.setFilter).toHaveBeenCalledWith("a", ["==", "a", 2]);
    expect(h.map.layer("a")).toMatchObject({ minzoom: 4, maxzoom: 12, filter: ["==", "a", 2] });
    expect(summary.propertiesSet).toContainEqual({ layerId: "a", property: "label" });
  });

  it("a changed interactive: block re-binds the layer's events without replacing the layer", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { interactive: { click: { popup: [{ p: [{ property: "name" }] }] } } })]);
    await render(h, applied);
    h.map.on.mockClear();
    h.map.off.mockClear();
    h.map.addLayer.mockClear();

    const summary = await update(h, applied, doc([layer("a", { interactive: { click: { popup: [{ p: [{ property: "title" }] }] }, hover: { cursor: "pointer" } } })]));

    expect(summary.failures).toEqual([]);
    expect(summary.propertiesSet).toEqual([{ layerId: "a", property: "interactive" }]);
    expect(h.map.addLayer).not.toHaveBeenCalled();
    expect(h.map.off).toHaveBeenCalledWith("click", "a", expect.any(Function));
    expect(h.map.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(["click", "mouseenter", "mouseleave"]));
  });

  it("a setter that throws records one failure, calls onError once non-fatally, and the remaining operations still apply", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a", { paint: { "circle-color": "#f00", "circle-radius": 2 } }), layer("b")]);
    await render(h, applied);
    const setPaintProperty = h.map.setPaintProperty.getMockImplementation()!;
    h.map.setPaintProperty.mockImplementation((id: string, property: string, value: unknown) => {
      if (property === "circle-color") throw new Error("bad colour");
      return setPaintProperty(id, property, value);
    });

    const summary = await update(
      h,
      applied,
      doc([layer("a", { paint: { "circle-color": "#00f", "circle-radius": 6 } }), layer("b", { layout: { "circle-sort-key": 3 } })])
    );

    expect(summary.failures).toEqual([{ op: "layerSetProperty", message: expect.stringContaining("bad colour"), layerId: "a" }]);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "layer", layerId: "a" });
    expect(h.map.layer("a")!.paint["circle-radius"]).toBe(6);
    expect(h.map.layer("b")!.layout["circle-sort-key"]).toBe(3);
  });
});

describe("applyOps: existence reconciliation (KTD1)", () => {
  it("a document layer the host removed through getMap() is re-added in position and listed under added", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("b"), layer("c")]);
    await render(h, applied);
    h.map.removeLayer("b");
    h.map.removeLayer.mockClear();
    h.map.setPaintProperty.mockClear();
    expect(h.map.order()).toEqual(["land", "a", "c"]);

    const next = doc([layer("a"), layer("b", { paint: { "circle-color": "#0f0" } }), layer("c", { paint: { "circle-color": "#00f" } })]);
    const summary = await update(h, applied, next);

    expect(summary.failures).toEqual([]);
    expect(summary.added).toEqual(["b"]);
    expect(h.map.order()).toEqual(["land", "a", "b", "c"]);
    expect(h.map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "b", paint: { "circle-color": "#0f0" } }), "c");
    // The re-added layer carries its next paint; no setter runs against a layer that was absent.
    expect(h.map.setPaintProperty).not.toHaveBeenCalledWith("b", expect.anything(), expect.anything());
    expect(h.map.setPaintProperty).toHaveBeenCalledWith("c", "circle-color", "#00f");
    expect(h.layerManager.ownsLayer("b")).toBe(true);
  });

  it("a layerAdd colliding with a host layer id records a failure with a hint and does not remove the host layer", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a")]);
    await render(h, applied);
    hostAddsLayer(h.map, "x");

    const summary = await update(h, applied, doc([layer("a"), layer("x")]));

    expect(summary.failures).toEqual([{ op: "layerAdd", message: expect.stringMatching(/not declared by the document/), layerId: "x" }]);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "layer", layerId: "x", reason: "host-layer-collision" });
    expect(h.map.removeLayer).not.toHaveBeenCalledWith("x");
    expect(h.map.layer("x")!.type).toBe("line");
    expect(h.layerManager.ownsLayer("x")).toBe(false);
  });

  it("after a collision, the document's paint, visibility and interactive changes never reach the host's layer: one failure per update, its setters and events untouched (KTD1)", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a")]);
    await render(h, applied);
    hostAddsLayer(h.map, "x");
    // The renderer records the colliding document as applied, failures and all.
    const collided = doc([layer("a"), layer("x")]);
    await update(h, applied, collided);
    h.onError.mockClear();
    h.map.on.mockClear();
    h.map.setPaintProperty.mockClear();
    h.map.setLayoutProperty.mockClear();
    h.map.setFilter.mockClear();

    const next = doc([
      layer("a"),
      layer("x", {
        paint: { "circle-color": "#000" },
        visible: false,
        filter: ["==", "x", 1],
        interactive: { click: { popup: [{ p: [{ property: "title" }] }] }, hover: { cursor: "pointer" } },
      }),
    ]);
    const summary = await update(h, collided, next);

    expect(summary.failures).toEqual([{ op: "layerSetProperty", message: expect.stringMatching(/"x".*not declared by the document/), layerId: "x" }]);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.any(Error), false, { kind: "layer", layerId: "x", reason: "host-layer-collision" });
    expect(h.map.setPaintProperty).not.toHaveBeenCalled();
    expect(h.map.setLayoutProperty).not.toHaveBeenCalled();
    expect(h.map.setFilter).not.toHaveBeenCalled();
    expect(h.map.on).not.toHaveBeenCalledWith(expect.anything(), "x", expect.any(Function));
    expect(h.map.layer("x")).toMatchObject({ type: "line", paint: {}, layout: {} });
    expect(h.map.layer("x")!.filter).toBeUndefined();
    expect(h.map.removeLayer).not.toHaveBeenCalledWith("x");
  });

  it("removing a layer stops its polling, detaches its events and drops its inline source", async () => {
    // Prefetched data: the first load is skipped, the refresh pipeline still starts; a tick never gets to run.
    const h = createHost(createMockMap(["land"]));
    const applied = doc([
      layer("a", {
        source: { type: "geojson", url: "https://example.com/a.geojson", prefetchedData: EMPTY, refresh: { refreshInterval: 60_000, updateStrategy: "replace" } },
        interactive: { hover: { cursor: "pointer" } },
      }),
      layer("b"),
    ]);
    await render(h, applied);
    const stop = vi.spyOn((h.layerManager as any).pollingManager, "stop");
    h.map.off.mockClear();

    const summary = await update(h, applied, doc([layer("b")]));

    expect(summary.failures).toEqual([]);
    expect(summary.removed).toEqual(["a"]);
    expect(stop).toHaveBeenCalledWith("a");
    expect(h.map.off).toHaveBeenCalledWith("mouseenter", "a", expect.any(Function));
    expect(h.map.removeLayer).toHaveBeenCalledWith("a");
    expect(h.map.removeSource).toHaveBeenCalledWith("a-source");
    expect(h.emit).toHaveBeenCalledWith("layer:removed", { layerId: "a" });
    expect(h.map.order()).toEqual(["land", "b"]);
  });

  it("a layerRemove for a layer the document never managed to add touches nothing", async () => {
    const h = createHost(createMockMap(["land"]));
    const applied = doc([layer("a"), layer("ghost")]);
    // Only `a` made it onto the map on first render.
    await render(h, doc([layer("a")]));
    hostAddsLayer(h.map, "ghost");

    const summary = await update(h, applied, doc([layer("a")]));

    expect(summary.failures).toEqual([]);
    expect(h.map.removeLayer).not.toHaveBeenCalled();
    expect(h.map.order()).toEqual(["land", "a", "ghost"]);
  });
});
