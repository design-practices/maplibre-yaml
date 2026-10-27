/**
 * @file Diff-and-apply timing for a sizeable document (live documents, U4)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * The differ is pure over data and the apply step touches only what
 * changed, so an edit to a large document must cost in proportion to the
 * edit, not to the document. A 50-layer, 10-source document with five paint
 * changes is diffed and applied against the style-backed map double; the
 * time is printed for the PR body and held under a generous budget so a
 * quadratic regression fails here rather than in a reader's editor.
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
import { diff } from "../../src/renderer/update/diff";
import type { AppliedDocument, DiffHints, UpdateHost } from "../../src/renderer/update/types";
import { LayerManager } from "../../src/renderer/layer-manager";
import { EventHandler } from "../../src/renderer/event-handler";
import type { Layer } from "../../src/schemas/layer.schema";
import type { LayerSource } from "../../src/schemas/source.schema";

const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

/** The budget on the mock map: generous (CI boxes vary), still an order below a quadratic blow-up. */
const BUDGET_MS = 250;

const LAYERS = 50;
const SOURCES = 10;
const CHANGES = 5;

type StyleLayer = { id: string; type: string; source?: string; paint: Record<string, unknown>; layout: Record<string, unknown> };

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
    getStyle: () => ({ layers: layers.map((l) => ({ ...l })), sources: { ...sources } }),
    getLayer: (id: string) => layers[find(id)],
    addLayer: (spec: any, before?: string) => {
      if (find(spec.id) >= 0) throw new Error(`Layer "${spec.id}" already exists on this map.`);
      const entry: StyleLayer = { paint: {}, layout: {}, ...spec, paint: { ...(spec.paint ?? {}) }, layout: { ...(spec.layout ?? {}) } };
      if (before === undefined) layers.push(entry);
      else layers.splice(mustFind(before), 0, entry);
    },
    removeLayer: (id: string) => {
      layers.splice(mustFind(id), 1);
    },
    moveLayer: (id: string, before?: string) => {
      const [entry] = layers.splice(mustFind(id), 1);
      if (before === undefined) layers.push(entry!);
      else layers.splice(mustFind(before), 0, entry!);
    },
    addSource: (id: string, spec: any) => {
      if (sources[id]) throw new Error("There is already a source with this ID");
      sources[id] = { ...spec, setData: () => undefined };
    },
    removeSource: (id: string) => {
      delete sources[id];
    },
    getSource: (id: string) => sources[id],
    setPaintProperty: (id: string, property: string, value: unknown) => {
      layers[mustFind(id)]!.paint[property] = value;
    },
    setLayoutProperty: (id: string, property: string, value: unknown) => {
      layers[mustFind(id)]!.layout[property] = value;
    },
    setFilter: () => undefined,
    setLayerZoomRange: () => undefined,
    easeTo: () => undefined,
    on: () => undefined,
    off: () => undefined,
    setFeatureState: () => undefined,
    removeFeatureState: () => undefined,
    getCanvas: () => ({ style: { cursor: "" } }),
  };
}

function createHost(map: ReturnType<typeof createMockMap>) {
  const layerManager = new LayerManager(map as any, {});
  const eventHandler = new EventHandler(map as any, {});
  const noop = () => undefined;
  const host: UpdateHost = {
    map: map as any,
    layerManager,
    eventHandler,
    controlsManager: { removeAllControls: noop, addControls: noop } as any,
    camera: "document",
    runtime: {
      syncLegend: noop,
      syncParamsPanel: noop,
      syncMarkers: noop,
      syncPopups: noop,
      syncClassify: noop,
      syncState: noop,
      setTitle: noop,
      loadImages: async () => undefined,
      applyScene: noop,
      fitTo: noop,
    },
    onError: noop,
    reattachEffects: noop,
    prepareLayer: (layer) => layer,
    emit: noop,
  };
  return { host, layerManager };
}

function bigDocument(colorOf: (index: number) => string): AppliedDocument {
  const sources: Record<string, LayerSource> = {};
  for (let s = 0; s < SOURCES; s++) {
    sources[`src-${s}`] = { type: "geojson", data: { type: "FeatureCollection", features: [] } } as never;
  }
  const layers: Layer[] = [];
  for (let i = 0; i < LAYERS; i++) {
    layers.push({
      id: `layer-${i}`,
      type: "circle",
      source: `src-${i % SOURCES}`,
      paint: { "circle-color": colorOf(i), "circle-radius": 3 + (i % 5) },
      label: `Layer ${i}`,
    } as Layer);
  }
  return {
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as AppliedDocument["config"],
    layers,
    sources,
    options: {},
  };
}

describe(`diff and apply: ${LAYERS} layers, ${SOURCES} sources, ${CHANGES} property changes`, () => {
  it(`completes under ${BUDGET_MS} ms against the mock map`, async () => {
    const applied = bigDocument(() => "#f00");
    const next = bigDocument((i) => (i % 10 === 0 && i < CHANGES * 10 ? "#0f0" : "#f00"));
    const { host, layerManager } = createHost(createMockMap());
    layerManager.registerSources(applied.sources as never);
    for (const layer of applied.layers) await layerManager.addLayer(layer);

    const start = performance.now();
    const diffed = diff(applied, next, NO_HINTS);
    const diffMs = performance.now() - start;
    const result = await runUpdate(host, { applied, next, hints: NO_HINTS });
    const totalMs = performance.now() - start;

    expect(diffed.summary.propertiesSet).toHaveLength(CHANGES);
    expect(result.summary.propertiesSet).toHaveLength(CHANGES);
    expect(result.summary.added).toEqual([]);
    expect(result.summary.moved).toEqual([]);
    expect(result.summary.failures).toEqual([]);
    // Always printed: the number goes in the PR body.
    console.log(`[update-bench] ${LAYERS} layers / ${SOURCES} sources / ${CHANGES} changes: diff ${diffMs.toFixed(2)} ms, diff+apply+resync ${totalMs.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
    expect(totalMs).toBeLessThan(BUDGET_MS);
  });
});
