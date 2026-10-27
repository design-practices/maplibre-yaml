/**
 * @file The pure differ behind `MapRenderer.update` (live documents, U1)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * `diff(applied, next, hints)` turns two normalized documents into an ordered
 * operation list and a summary, with no map in sight. Each test maps to one
 * bullet of the plan's U1 test scenarios
 * (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 */

import { describe, it, expect, vi } from "vitest";
import { diff } from "../../src/renderer/update/diff";
import type { AppliedDocument, DiffHints, UpdateOp } from "../../src/renderer/update/types";
import type { Layer } from "../../src/schemas/layer.schema";
import type { LayerSource } from "../../src/schemas/source.schema";
import { YAMLParser } from "../../src/parser";

const EMPTY = { type: "FeatureCollection", features: [] } as const;
const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

/** A fill layer over an inline `url:` source, the common shape in the scenarios. */
function lotsLayer(overrides: Record<string, unknown> = {}): Layer {
  return {
    id: "lots",
    type: "fill",
    visible: true,
    toggleable: false,
    source: { type: "geojson", url: "/data/lots.geojson" },
    paint: { "fill-color": "#00f", "fill-opacity": 0.5 },
    ...overrides,
  } as unknown as Layer;
}

/** A circle layer over a named source. */
function namedLayer(id: string, source: string, overrides: Record<string, unknown> = {}): Layer {
  return {
    id,
    type: "circle",
    visible: true,
    toggleable: false,
    source,
    paint: { "circle-color": "#f00" },
    ...overrides,
  } as unknown as Layer;
}

function doc(partial: Partial<AppliedDocument> = {}): AppliedDocument {
  return {
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" } as AppliedDocument["config"],
    layers: [lotsLayer()],
    sources: {},
    options: {},
    ...partial,
  };
}

/** The same document with `config` keys overridden (or removed with `undefined`). */
function withConfig(base: AppliedDocument, config: Record<string, unknown>): AppliedDocument {
  const merged: Record<string, unknown> = { ...(base.config as Record<string, unknown>) };
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return { ...base, config: merged as AppliedDocument["config"] };
}

const opNames = (ops: readonly UpdateOp[]) => ops.map((op) => op.op);

describe("diff: identical documents", () => {
  it("with empty hints produce an empty list and changed: false", () => {
    const result = diff(doc(), doc(), NO_HINTS);
    expect(result.changed).toBe(false);
    expect(result.ops).toEqual([]);
    expect(result.summary).toEqual({
      added: [],
      removed: [],
      moved: [],
      replaced: [],
      propertiesSet: [],
      sourcesReplaced: [],
      cameraMoved: false,
      rebuild: false,
      failures: [],
    });
  });

  it("with failedSources = {'lots-source'} produce one retry operation for that source and nothing else", () => {
    const result = diff(doc(), doc(), { failedSources: new Set(["lots-source"]), urlsRebased: false });
    expect(result.changed).toBe(true);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "sourceSetUrl", sourceId: "lots-source" }),
    ]);
  });

  it("with urlsRebased = true produce one operation per URL-bearing source", () => {
    const sources: Record<string, LayerSource> = {
      roads: { type: "vector", tiles: ["/tiles/{z}/{x}/{y}.pbf"] } as LayerSource,
      parks: { type: "geojson", url: "/data/parks.geojson" } as LayerSource,
    };
    const layers = [
      lotsLayer(),
      namedLayer("roads-line", "roads", { type: "line", "source-layer": "roads" }),
      namedLayer("parks-dots", "parks"),
      // Inline data: nothing to rebase.
      lotsLayer({ id: "pins", type: "circle", source: { type: "geojson", data: EMPTY } }),
    ];
    const base = doc({ layers, sources });
    const result = diff(base, base, { failedSources: new Set(), urlsRebased: true });
    expect(result.ops).toHaveLength(3);
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "sourceSetUrl", sourceId: "lots-source" }),
        expect.objectContaining({ op: "sourceSetTiles", sourceId: "roads" }),
        expect.objectContaining({ op: "sourceSetUrl", sourceId: "parks" }),
      ])
    );
  });
});

describe("diff: layer order", () => {
  it("reordering a, b, c to c, a, b produces only layerMove operations and the summary counts moved layers (AE1)", () => {
    const a = namedLayer("a", "quakes");
    const b = namedLayer("b", "quakes");
    const c = namedLayer("c", "quakes");
    const sources: Record<string, LayerSource> = { quakes: { type: "geojson", data: EMPTY } as LayerSource };
    const result = diff(doc({ layers: [a, b, c], sources }), doc({ layers: [c, a, b], sources }), NO_HINTS);
    expect(result.changed).toBe(true);
    expect(new Set(opNames(result.ops))).toEqual(new Set(["layerMove"]));
    expect(result.summary.moved).toEqual(["c"]);
    expect(result.ops[0]).toMatchObject({ op: "layerMove", layerId: "c", beforeId: "a" });
  });

  it("a renamed layer yields layerRemove plus layerAdd, never a move", () => {
    const result = diff(doc({ layers: [lotsLayer()] }), doc({ layers: [lotsLayer({ id: "parcels" })] }), NO_HINTS);
    expect(opNames(result.ops)).not.toContain("layerMove");
    expect(result.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "layerRemove", layerId: "lots" }),
        expect.objectContaining({ op: "layerAdd", layerId: "parcels", position: { index: 0 } }),
      ])
    );
    expect(result.summary.removed).toEqual(["lots"]);
    expect(result.summary.added).toEqual(["parcels"]);
    expect(result.summary.moved).toEqual([]);
  });
});

describe("diff: layer properties", () => {
  it("changing one paint property produces one layerSetProperty naming layer and property", () => {
    const next = doc({ layers: [lotsLayer({ paint: { "fill-color": "#f00", "fill-opacity": 0.5 } })] });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([
      { op: "layerSetProperty", layerId: "lots", target: "paint", property: "fill-color", value: "#f00" },
    ]);
    expect(result.summary.propertiesSet).toEqual([{ layerId: "lots", property: "fill-color" }]);
  });
});

describe("diff: forced layer replacement", () => {
  const sources: Record<string, LayerSource> = {
    roads: { type: "vector", url: "https://example.com/roads.json" } as LayerSource,
    rails: { type: "vector", url: "https://example.com/rails.json" } as LayerSource,
  };
  const line = namedLayer("ways", "roads", { type: "line", "source-layer": "roads" });
  const base = doc({ layers: [lotsLayer(), line], sources });

  it("changing a layer type produces layerReplace carrying the document position", () => {
    const next = doc({ layers: [lotsLayer(), { ...line, type: "fill" } as Layer], sources });
    const result = diff(base, next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "layerReplace", layerId: "ways", reason: "type", position: { index: 1 } }),
    ]);
    expect(result.summary.replaced).toEqual(["ways"]);
  });

  it("changing a layer source produces layerReplace carrying the document position", () => {
    const next = doc({ layers: [{ ...line, source: "rails" } as Layer, lotsLayer()], sources });
    const result = diff(base, next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({
        op: "layerReplace",
        layerId: "ways",
        reason: "source",
        position: { index: 0, beforeId: "lots" },
      }),
    ]);
  });

  it("changing a layer source-layer produces layerReplace carrying the document position", () => {
    const next = doc({ layers: [lotsLayer(), { ...line, "source-layer": "paths" } as Layer], sources });
    const result = diff(base, next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "layerReplace", layerId: "ways", reason: "source-layer", position: { index: 1 } }),
    ]);
  });
});

describe("diff: forced source replacement", () => {
  it("changing promoteId on an inline source produces sourceReplace plus layerReplace for the dependent layer", () => {
    const next = doc({ layers: [lotsLayer({ source: { type: "geojson", url: "/data/lots.geojson", promoteId: "lot_id" } })] });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "sourceReplace", sourceId: "lots-source", reason: "promoteId" }),
      expect.objectContaining({ op: "layerReplace", layerId: "lots", reason: "source", position: { index: 0 } }),
    ]);
    expect(result.summary.sourcesReplaced).toEqual(["lots-source"]);
    expect(result.summary.replaced).toEqual(["lots"]);
  });

  it("adding cluster to a named source produces sourceReplace plus layerReplace for every dependent layer", () => {
    const applied = doc({
      layers: [namedLayer("dots", "quakes"), namedLayer("labels", "quakes", { type: "symbol" })],
      sources: { quakes: { type: "geojson", url: "/quakes.geojson" } as LayerSource },
    });
    const next = doc({
      layers: applied.layers,
      sources: { quakes: { type: "geojson", url: "/quakes.geojson", cluster: true } as LayerSource },
    });
    const result = diff(applied, next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "sourceReplace", sourceId: "quakes", reason: "cluster" }),
      expect.objectContaining({ op: "layerReplace", layerId: "dots", reason: "source", position: { index: 0, beforeId: "labels" } }),
      expect.objectContaining({ op: "layerReplace", layerId: "labels", reason: "source", position: { index: 1 } }),
    ]);
    expect(result.summary.replaced).toEqual(["dots", "labels"]);
  });

  it("adding hover: to a layer on an id-less inline source produces sourceReplace plus layerReplace", () => {
    const next = doc({ layers: [lotsLayer({ interactive: { hover: { highlight: true } } })] });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "sourceReplace", sourceId: "lots-source", reason: "generateId" }),
      expect.objectContaining({ op: "layerReplace", layerId: "lots", reason: "source" }),
    ]);
  });

  it("adding hover: to a layer whose source already has ids replaces only the layer", () => {
    const withIds = { type: "geojson", url: "/data/lots.geojson", promoteId: "lot_id" };
    const applied = doc({ layers: [lotsLayer({ source: withIds })] });
    const next = doc({ layers: [lotsLayer({ source: withIds, interactive: { hover: { highlight: true } } })] });
    const result = diff(applied, next, NO_HINTS);
    expect(opNames(result.ops)).toEqual(["layerReplace"]);
    expect(result.ops[0]).toMatchObject({ layerId: "lots", reason: "interactive" });
  });
});

describe("diff: sources applied in place", () => {
  it("changing a GeoJSON source url produces sourceSetUrl on the source and no layer operations (AE2)", () => {
    const applied = doc({
      layers: [namedLayer("dots", "quakes")],
      sources: { quakes: { type: "geojson", url: "/quakes-2024.geojson" } as LayerSource },
    });
    const next = doc({
      layers: applied.layers,
      sources: { quakes: { type: "geojson", url: "/quakes-2025.geojson" } as LayerSource },
    });
    const result = diff(applied, next, NO_HINTS);
    expect(result.ops).toEqual([
      expect.objectContaining({ op: "sourceSetUrl", sourceId: "quakes", source: next.sources["quakes"] }),
    ]);
    expect(result.summary.sourcesReplaced).toEqual([]);
    expect(result.summary.replaced).toEqual([]);
  });
});

describe("diff: fallback and map options", () => {
  it("changing mapStyle produces a single fallback('mapStyle') and no other operations", () => {
    // A paint change rides along: still one operation.
    const next = withConfig(doc({ layers: [lotsLayer({ paint: { "fill-color": "#f00" } })] }), {
      mapStyle: "https://example.com/other.json",
    });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([{ op: "fallback", reason: "mapStyle" }]);
    expect(result.summary.rebuild).toBe(true);
  });

  it("changing interactive produces a single fallback('interactive')", () => {
    const result = diff(doc(), withConfig(doc(), { interactive: false }), NO_HINTS);
    expect(result.ops).toEqual([{ op: "fallback", reason: "interactive" }]);
  });

  it("changing projection produces optionSet", () => {
    const next = doc({ options: { projection: { type: "globe" } } as AppliedDocument["options"] });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([{ op: "optionSet", option: "projection", value: { type: "globe" } }]);
    expect(result.summary.rebuild).toBe(false);
  });
});

describe("diff: camera (KTD13)", () => {
  it("center unchanged yields no cameraSet", () => {
    const result = diff(doc(), withConfig(doc(), { zoom: 2 }), NO_HINTS);
    expect(opNames(result.ops)).not.toContain("cameraSet");
    expect(result.summary.cameraMoved).toBe(false);
  });

  it("center changed yields one cameraSet", () => {
    const result = diff(doc(), withConfig(doc(), { center: [10, 20] }), NO_HINTS);
    expect(result.ops).toEqual([{ op: "cameraSet", camera: { center: [10, 20] } }]);
    expect(result.summary.cameraMoved).toBe(true);
  });

  it("a camera key removed yields none", () => {
    const applied = withConfig(doc(), { bearing: 30 });
    const result = diff(applied, doc(), NO_HINTS);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(false);
  });
});

describe("diff: fitTo", () => {
  const sources = (features: unknown[]): Record<string, LayerSource> => ({
    quakes: { type: "geojson", data: { type: "FeatureCollection", features } } as LayerSource,
  });

  it("fitTo added yields fitTo", () => {
    const applied = doc({ layers: [namedLayer("dots", "quakes")], sources: sources([]) });
    const next = withConfig(applied, { fitTo: { source: "quakes" } });
    const result = diff(applied, next, NO_HINTS);
    expect(result.ops).toEqual([{ op: "fitTo", fitTo: { source: "quakes" } }]);
    expect(result.summary.cameraMoved).toBe(true);
  });

  it("the same fitTo with changed source data yields none", () => {
    const point = { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: {} };
    const applied = withConfig(doc({ layers: [namedLayer("dots", "quakes")], sources: sources([]) }), {
      fitTo: { source: "quakes" },
    });
    const next = { ...applied, sources: sources([point]) };
    const result = diff(applied, next, NO_HINTS);
    expect(result.ops).toEqual([expect.objectContaining({ op: "sourceSetData", sourceId: "quakes" })]);
    expect(result.summary.cameraMoved).toBe(false);
  });
});

describe("diff: effects", () => {
  it("adding an effect: block on a layer yields optionSet('effects') so re-sync knows to re-attach", () => {
    const next = doc({ layers: [lotsLayer({ effect: { type: "tonal-hatch" } })] });
    const result = diff(doc(), next, NO_HINTS);
    expect(result.ops).toEqual([{ op: "optionSet", option: "effects", value: { lots: { type: "tonal-hatch" } } }]);
  });

  it("removing an effect: block on a layer yields optionSet('effects')", () => {
    const applied = doc({ layers: [lotsLayer({ effect: { type: "tonal-hatch" } })] });
    const result = diff(applied, doc(), NO_HINTS);
    expect(result.ops).toEqual([{ op: "optionSet", option: "effects", value: {} }]);
  });
});

describe("diff: parity with first render", () => {
  it("a named source dropped while a layer still names it is a validation error from the parser, not a differ case", () => {
    const result = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      sources: {},
      layers: [{ id: "dots", type: "circle", source: "quakes" }],
    });
    expect(result.success).toBe(false);
    expect(result.errors.find((e) => e.path === "layers.0.source")?.message).toContain('uses source "quakes"');
  });
});

describe("diff: cost is proportional to the edit, never to an inline payload", () => {
  /** A FeatureCollection big enough that serialising it would dominate the diff. */
  const bigData = () => ({
    type: "FeatureCollection",
    features: Array.from({ length: 20_000 }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [i % 360, (i % 180) - 90] },
      properties: { id: i, name: `feature ${i}`, value: i * 1.5 },
    })),
  });
  const over = (data: unknown, overrides: Record<string, unknown> = {}) =>
    lotsLayer({ id: "pins", type: "circle", source: { type: "geojson", data }, ...overrides });

  it("a paint-only edit on a layer over a shared 20k-feature payload never serialises the payload", () => {
    const data = bigData();
    const applied = doc({ layers: [over(data)] });
    const next = doc({ layers: [over(data, { paint: { "fill-color": "#f00", "fill-opacity": 0.5 } })] });
    const stringify = vi.spyOn(JSON, "stringify");

    const started = performance.now();
    const result = diff(applied, next, NO_HINTS);
    const elapsed = performance.now() - started;

    expect(result.ops).toEqual([expect.objectContaining({ op: "layerSetProperty", layerId: "pins", property: "fill-color", value: "#f00" })]);
    const serialisedPayload = stringify.mock.calls.some(([value]) => {
      const seen = new Set<unknown>();
      const walk = (v: unknown): boolean => {
        if (v === data) return true;
        if (typeof v !== "object" || v === null || seen.has(v)) return false;
        seen.add(v);
        return Object.values(v as object).some(walk);
      };
      return walk(value);
    });
    expect(serialisedPayload).toBe(false);
    // Generous for CI; serialising 20k features twice over would take an order more.
    expect(elapsed).toBeLessThan(50);
    stringify.mockRestore();
  });

  it("equal documents over a shared payload yield no operations without a whole-document serialisation", () => {
    const data = bigData();
    const applied = doc({ layers: [over(data)] });
    const next = doc({ layers: [over(data)] });
    const stringify = vi.spyOn(JSON, "stringify");
    const result = diff(applied, next, NO_HINTS);
    expect(result.changed).toBe(false);
    expect(result.ops).toEqual([]);
    expect(stringify.mock.calls.some(([value]) => value === applied || value === next || value === data)).toBe(false);
    stringify.mockRestore();
  });

  it("an inline data edit is still detected, as sourceSetData, and a constructor-only key change never looks at the payload", () => {
    const before = bigData();
    const after = bigData();
    after.features[0]!.properties.name = "renamed";
    const edited = diff(doc({ layers: [over(before)] }), doc({ layers: [over(after)] }), NO_HINTS);
    expect(edited.ops).toEqual([expect.objectContaining({ op: "sourceSetData", sourceId: "pins-source" })]);

    const stringify = vi.spyOn(JSON, "stringify");
    const clustered = diff(
      doc({ layers: [over(before)] }),
      doc({ layers: [lotsLayer({ id: "pins", type: "circle", source: { type: "geojson", data: after, cluster: true } })] }),
      NO_HINTS
    );
    expect(clustered.ops).toEqual([
      expect.objectContaining({ op: "sourceReplace", sourceId: "pins-source", reason: "cluster" }),
      expect.objectContaining({ op: "layerReplace", layerId: "pins", reason: "source" }),
    ]);
    expect(stringify.mock.calls.some(([value]) => value === before || value === after)).toBe(false);
    stringify.mockRestore();
  });
});
