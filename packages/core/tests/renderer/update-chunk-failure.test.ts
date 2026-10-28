/**
 * @file The update engine chunk can't be downloaded (live documents, U4)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * The update engine is an on-demand chunk on the ml-7qa.5 seam (KTD10).
 * When it can't be downloaded, `update()` resolves `rejected` with
 * `kind: 'chunk'`, `update:rejected` fires with the existing chunk wording,
 * and the running map and applied document are untouched; the next
 * `update()` asks for the file again (the seam evicts a failed load).
 * Modelled on protomaps-basemap-chunk.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { FormatError } from "../../src/formats/errors";

const chunkLoads = { attempts: 0, failing: true };

vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return {
    ...actual,
    getDecoder: (name: string) => {
      if (name !== "update") return actual.getDecoder(name as never);
      chunkLoads.attempts += 1;
      return chunkLoads.failing
        ? Promise.reject(new FormatError({ code: "chunk", format: name as never, url: "chunks/update.js", detail: "offline" }))
        : actual.getDecoder(name as never);
    },
    prefetchDecoder: () => undefined,
  };
});

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    private layers = new Map<string, any>();
    public ctorOptions: any;
    public addControl = vi.fn();
    public getSource = vi.fn();
    public addSource = vi.fn();
    public removeLayer = vi.fn((id: string) => this.layers.delete(id));
    public setPaintProperty = vi.fn();
    public addLayer = vi.fn((spec: any) => this.layers.set(spec.id, spec));
    public getLayer = vi.fn((id: string) => this.layers.get(id));
    public container: HTMLElement;
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
    }
    getContainer() {
      return this.container;
    }
    getCanvas() {
      return { style: { cursor: "" } };
    }
    on(event: string, cb: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(cb);
    }
    off(event: string, cb: Function) {
      this.events.get(event)?.delete(cb);
    }
    emit(event: string, data?: unknown) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  const Popup = vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), on: vi.fn(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() }));
  return { default: { Map: MockMap, AttributionControl, Popup }, Map: MockMap, AttributionControl, Popup };
});

import { MapRenderer } from "../../src/renderer/map-renderer";

const layer = (color: string) => ({
  id: "a",
  type: "circle" as const,
  source: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } },
  paint: { "circle-color": color },
});

describe("the update engine chunk can't be downloaded", () => {
  it("rejects the update with kind 'chunk', keeps the map and document, and a later update retries the import", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onError = vi.fn();
    const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };
    const renderer = new MapRenderer(container, config, [layer("#f00")], { onError });
    const loaded = new Promise<void>((resolve) => renderer.on("load", resolve));
    (renderer.getMap() as any).emit("load");
    await loaded;
    const rejected = vi.fn();
    const applied = vi.fn();
    renderer.on("update:rejected", rejected);
    renderer.on("update:applied", applied);
    const map = renderer.getMap() as any;
    const before = renderer.getDocument();

    const result = await renderer.update({ config, layers: [layer("#0f0")], sources: {}, options: {} });
    expect(result.outcome).toBe("rejected");
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.kind).toBe("chunk");
    expect(result.errors![0]!.message).toContain("couldn't be downloaded");
    expect(result.errors![0]!.message).toContain("chunks/update.js");
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0][0]).toMatchObject({ kind: "chunk" });
    expect(applied).not.toHaveBeenCalled();
    expect(renderer.getDocument()).toBe(before);
    expect(renderer.getDocument().layers[0]).toEqual(layer("#f00"));
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(chunkLoads.attempts).toBe(1);

    // A fallback is decided before the chunk is awaited (KTD7): with the
    // chunk still failing, a mapStyle change resolves `fallback`, not `rejected`.
    const fallback = await renderer.update({
      config: { ...config, mapStyle: "https://example.com/other.json" },
      layers: [layer("#0f0")],
      sources: {},
      options: {},
    });
    expect(fallback).toEqual({ outcome: "fallback", summary: expect.objectContaining({ rebuild: true }) });
    expect(chunkLoads.attempts).toBe(1);
    expect(renderer.getDocument()).toBe(before);

    chunkLoads.failing = false;
    const retry = await renderer.update({ config, layers: [layer("#0f0")], sources: {}, options: {} });
    expect(chunkLoads.attempts).toBe(2);
    expect(retry.outcome).toBe("applied");
    expect(retry.summary?.propertiesSet).toEqual([{ layerId: "a", property: "circle-color" }]);
    expect(map.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "#0f0");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(renderer.getDocument().layers[0]).toEqual(layer("#0f0"));
  });

  it("queues a second update behind a still-failing chunk, rejects it too, and a later update applies once the chunk recovers", async () => {
    // Fresh chunk-load counters: the previous test left them at
    // { attempts: 2, failing: false }.
    chunkLoads.attempts = 0;
    chunkLoads.failing = true;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const onError = vi.fn();
    const config = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };
    const renderer = new MapRenderer(container, config, [layer("#f00")], { onError });
    const loaded = new Promise<void>((resolve) => renderer.on("load", resolve));
    (renderer.getMap() as any).emit("load");
    await loaded;
    const rejected = vi.fn();
    const applied = vi.fn();
    renderer.on("update:rejected", rejected);
    renderer.on("update:applied", applied);
    const before = renderer.getDocument();

    const docA = { config, layers: [layer("#0f0")], sources: {}, options: {} };
    const docB = { config, layers: [layer("#00f")], sources: {}, options: {} };

    // Neither update is awaited before the next is issued (KTD5: one in
    // flight, at most one queued) — docB queues behind docA.
    const firstPromise = renderer.update(docA);
    const secondPromise = renderer.update(docB);

    const first = await firstPromise;
    expect(first.outcome).toBe("rejected");
    expect(first.errors).toHaveLength(1);
    expect(first.errors![0]!.kind).toBe("chunk");

    const second = await secondPromise;

    // Current behavior (map-renderer.ts startUpdate/performUpdate): when
    // the first update's run settles, `startUpdate`'s `.finally()` hands
    // the queued update to a fresh `startUpdate` call, which re-attempts
    // the chunk import via `performUpdate`. The chunk is still failing, so
    // the queued update is also rejected with kind 'chunk' rather than
    // being dropped as 'superseded'. If another change to the queue makes
    // this ambiguous, the invariants below (no applied event while the
    // chunk fails, document untouched, later update applies after
    // recovery) are what must hold regardless.
    expect(second.outcome).toBe("rejected");
    if (second.outcome === "rejected") {
      expect(second.errors).toHaveLength(1);
      expect(second.errors![0]!.kind).toBe("chunk");
    }
    expect(chunkLoads.attempts).toBe(2);
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(applied).not.toHaveBeenCalled();
    expect(renderer.getDocument()).toBe(before);
    expect(renderer.getDocument().layers[0]).toEqual(layer("#f00"));

    chunkLoads.failing = false;
    const retry = await renderer.update({ config, layers: [layer("#00f")], sources: {}, options: {} });
    expect(chunkLoads.attempts).toBe(3);
    expect(retry.outcome).toBe("applied");
    expect(applied).toHaveBeenCalledTimes(1);
    expect(renderer.getDocument().layers[0]).toEqual(layer("#00f"));
  });
});
