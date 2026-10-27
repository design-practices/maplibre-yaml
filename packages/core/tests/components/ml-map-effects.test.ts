/**
 * @file `<ml-map>` auto-attaches registered effects (U13′, experimental)
 *
 * @description
 * Core never imports @maplibre-yaml/effects; the element reads the effects
 * host hook. These pin the lifecycle: attach after the document loads,
 * re-attach from the next document when an update touches an effect layer
 * (live documents, KTD6b), detach and attach to the new map across a basemap
 * rebuild (KTD8), detach on the error card and on removal, late host
 * registration still attaches, and a document without `effect:` never
 * touches the hook.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn(), Popup: vi.fn() }));

/** Renderers the mock created, with their captured `on()` handlers. */
const renderers: Array<{
  handlers: Record<string, Array<() => void>>;
  map: object;
  destroyed: boolean;
  options: any;
  update: ReturnType<typeof vi.fn>;
}> = [];

const SUMMARY = { added: [], removed: [], moved: [], replaced: [], propertiesSet: [], sourcesReplaced: [], cameraMoved: false, rebuild: false, failures: [] };

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, config, layers, options, sources) => {
    const r = {
      handlers: {} as Record<string, Array<() => void>>,
      map: {
        id: renderers.length,
        getCenter: () => ({ lng: 0, lat: 0 }),
        getZoom: () => 15,
        getBearing: () => 0,
        getPitch: () => 0,
        jumpTo: vi.fn(),
        resize: vi.fn(),
      },
      destroyed: false,
      config,
      layers,
      options,
      getMap() {
        return r.destroyed ? null : r.map;
      },
      on(event: string, cb: () => void) {
        (r.handlers[event] ??= []).push(cb);
      },
      destroy() {
        r.destroyed = true;
      },
      isMapLoaded: () => true,
      getDocument: () => ({ config: r.config, layers: r.layers, sources: sources ?? {}, options: r.options }),
      // An update that changed an effect block asks the host to re-attach (KTD6b), as the engine does.
      update: vi.fn(async (next: any) => {
        r.config = next.config;
        r.layers = next.layers;
        options.onReattachEffects?.();
        return { outcome: "applied", summary: SUMMARY };
      }),
      pause: vi.fn(),
      rebuildSeed: () => ({ initialState: {}, initialVisibility: {} }),
      failedSources: () => new Set<string>(),
    };
    renderers.push(r);
    return r;
  }),
}));

import { MLMap } from "../../src/components/ml-map";
import {
  registerEffectsHost,
  resetEffectsHostForTests,
  type EffectsHost,
} from "../../src/effects-host";

const DOC = (effect: boolean) =>
  JSON.stringify({
    type: "map",
    id: "fx",
    config: { mapStyle: "https://example.com/style.json", center: [0, 0], zoom: 15 },
    sources: { omt: { type: "vector", tiles: ["https://example.com/{z}/{x}/{y}.pbf"] } },
    layers: [
      {
        id: "buildings",
        type: "fill-extrusion",
        source: "omt",
        "source-layer": "building",
        paint: { "fill-extrusion-height": 10 },
        ...(effect ? { effect: { type: "tonal-hatch", gain: 0.5 } } : {}),
      },
    ],
  });

function spyHost() {
  const calls = { attach: [] as unknown[][], detach: 0 };
  const host: EffectsHost = {
    apiVersion: 1,
    types: () => ["tonal-hatch"],
    validate: () => [],
    attach(map, layers) {
      calls.attach.push([map, layers]);
      return { detach: () => void calls.detach++ };
    },
    lower: (_e, l) => l,
  };
  return { host, calls };
}

const fireLoad = (i: number) => renderers[i]!.handlers["load"]?.forEach((cb) => cb());

async function mount(effect: boolean): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  el.setAttribute("config", DOC(effect));
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

describe("<ml-map> effects auto-attach", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  });
  afterEach(() => {
    resetEffectsHostForTests();
  });

  it("attaches after the document loads, with the effect layers, and detaches on removal", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    expect(calls.attach).toHaveLength(0); // not before load
    fireLoad(0);
    expect(calls.attach).toHaveLength(1);
    expect(calls.attach[0]![0]).toBe(renderers[0]!.map);
    expect(calls.attach[0]![1]).toEqual([
      { layerId: "buildings", effect: { type: "tonal-hatch", gain: 0.5 } },
    ]);
    el.remove();
    expect(calls.detach).toBe(1);
  });

  it("an update that changes an effect block re-attaches on the same map, from the next document (KTD6b)", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    fireLoad(0);
    el.setAttribute("config", DOC(true).replace('"gain":0.5', '"gain":0.6'));
    await new Promise((r) => setTimeout(r, 10));
    expect(renderers).toHaveLength(1);
    expect(renderers[0]!.update).toHaveBeenCalledTimes(1);
    expect(calls.detach).toBe(1);
    expect(calls.attach).toHaveLength(2);
    expect(calls.attach[1]![0]).toBe(renderers[0]!.map);
    // The re-attach reads the NEXT document's effect refs, not the first one's.
    expect(calls.attach[1]![1]).toEqual([{ layerId: "buildings", effect: { type: "tonal-hatch", gain: 0.6 } }]);
  });

  it("a basemap change rebuilds: detaches from the old map once it is replaced, then attaches to the new one (KTD8)", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    fireLoad(0);
    el.setAttribute("config", DOC(true).replace("style.json", "other.json"));
    expect(renderers).toHaveLength(2);
    // The old map still shows (and keeps its effects) until the new one loads.
    expect(calls.detach).toBe(0);
    fireLoad(1);
    expect(calls.detach).toBe(1);
    expect(renderers[0]!.destroyed).toBe(true);
    expect(calls.attach).toHaveLength(2);
    expect(calls.attach[1]![0]).toBe(renderers[1]!.map);
  });

  it("an invalid document keeps the map and its effects (live documents, R2)", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    fireLoad(0);
    expect(calls.attach).toHaveLength(1);
    (el as unknown as { applyValidatedConfig(c: unknown): void }).applyValidatedConfig({ type: "map" });
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(calls.detach).toBe(0);
    expect(renderers[0]!.destroyed).toBe(false);
  });

  it("an error card detaches effects too (every teardown path goes through teardownRenderer)", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    fireLoad(0);
    expect(calls.attach).toHaveLength(1);
    // A map whose worker cannot start is replaced by the error card (ml-aot.2).
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderers[0]!.options.onError(new Error("Worker failed to load maplibre-gl 6"), false);
    await new Promise((r) => setTimeout(r, 10));
    err.mockRestore();
    expect(el.querySelector(".ml-map-error")).not.toBeNull();
    expect(calls.detach).toBe(1);
    expect(renderers[0]!.destroyed).toBe(true);
  });

  it("a host registered after load still attaches; without one the layers stay static and it says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = await mount(true);
    fireLoad(0);
    expect(warn.mock.calls.some((c) => /@maplibre-yaml\/effects is not loaded/.test(String(c[0])))).toBe(true);
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    expect(calls.attach).toHaveLength(1);
    el.remove();
    expect(calls.detach).toBe(1);
    warn.mockRestore();
  });

  it("a document without effect: never reaches the hook", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    await mount(false);
    fireLoad(0);
    expect(calls.attach).toHaveLength(0);
    expect(renderers[0]!.handlers["load"]?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
