/**
 * @file `<ml-map>` routes a changed document to the running map (live documents, U6)
 * @module @maplibre-yaml/core/tests/components
 *
 * @description
 * The element half of live documents: a changed `config`, `src`, `base` or
 * `reload()` becomes `renderer.update()` on the running map; an invalid
 * document is refused with `ml-map:update-rejected` and the map untouched;
 * a `mapStyle` change is the two-map fallback rebuild (KTD8) that carries
 * camera and state across, keeps `mapReady()` honest, never has three maps
 * alive and keeps the old map when the new basemap never loads. Each test
 * maps to one bullet of the plan's U6 test scenarios
 * (docs/plans/2026-10-27-001-feat-live-documents-plan.md). The renderer is
 * a double, as in ml-map-config-lifecycle.test.ts: what it is constructed
 * with and asked to do is the contract under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({ on: vi.fn(), off: vi.fn(), remove: vi.fn() }));
  return { default: { Map }, Map };
});

// The TOML reader's download, held or failed per test (U4); the real chunk otherwise.
vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return { ...actual, getDecoder: vi.fn(actual.getDecoder) };
});

/** Whether author hints show on the page (the dev-only policy): toggled per test. */
let hintsOn = true;
vi.mock("../../src/components/author-hints", () => ({
  showAuthorHints: () => hintsOn,
  authorHintsDecision: () => ({ show: hintsOn, reason: "test" }),
}));

interface FakeMap {
  camera: { center: [number, number]; zoom: number; bearing: number; pitch: number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  jumpTo: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface FakeRenderer {
  container: HTMLElement;
  config: any;
  layers: any[];
  options: any;
  sources: any;
  map: FakeMap;
  destroyed: boolean;
  handlers: Map<string, Array<(payload?: any) => void>>;
  update: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  setCameraOwner: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  rebuildSeed: ReturnType<typeof vi.fn>;
  mountHostChrome: ReturnType<typeof vi.fn>;
  failedSources: ReturnType<typeof vi.fn>;
  getDocument(): any;
  getMap(): FakeMap;
  on(name: string, fn: (payload?: any) => void): void;
  emit(name: string, payload?: any): void;
  load(): void;
}

const renderers: FakeRenderer[] = [];

const emptySummary = () => ({
  added: [] as string[],
  removed: [] as string[],
  moved: [] as string[],
  replaced: [] as string[],
  propertiesSet: [] as { layerId: string; property: string }[],
  sourcesReplaced: [] as string[],
  cameraMoved: false,
  rebuild: false,
  failures: [] as { op: string; message: string }[],
});

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((container, config, layers, options, sources) => {
    const handlers = new Map<string, Array<(payload?: any) => void>>();
    const map: FakeMap = {
      camera: { center: [...(config.center as [number, number])] as [number, number], zoom: config.zoom, bearing: 0, pitch: 0 },
      getCenter() {
        return { lng: this.camera.center[0], lat: this.camera.center[1] };
      },
      getZoom() {
        return this.camera.zoom;
      },
      getBearing() {
        return this.camera.bearing;
      },
      getPitch() {
        return this.camera.pitch;
      },
      jumpTo: vi.fn(),
      resize: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      remove: vi.fn(),
    };
    let loaded = false;
    const r: FakeRenderer = {
      container,
      config,
      layers,
      options,
      sources,
      map,
      destroyed: false,
      handlers,
      // As the renderer: `update:applied` fires only when the document changed.
      update: vi.fn(async (next: any, hints?: { reload?: boolean }) => {
        const changed =
          JSON.stringify([next.config, next.layers, next.sources]) !== JSON.stringify([r.config, r.layers, r.sources ?? {}]);
        r.config = next.config;
        r.layers = next.layers;
        r.sources = next.sources;
        const summary = emptySummary();
        // ... or on a reload, which answers even when nothing changed (KTD11).
        if (changed || hints?.reload) r.emit("update:applied", { summary });
        return { outcome: "applied", summary };
      }),
      destroy: vi.fn(() => {
        r.destroyed = true;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      setCameraOwner: vi.fn(),
      setState: vi.fn(),
      getState: vi.fn(() => ({ year: 2020 })),
      rebuildSeed: vi.fn(() => ({ initialState: { year: 2020 }, initialVisibility: { pts: false } })),
      mountHostChrome: vi.fn(),
      failedSources: vi.fn(() => new Set<string>()),
      getDocument: () => ({ config: r.config, layers: r.layers, sources: r.sources ?? {}, options: r.options }),
      getMap: () => map,
      on(name, fn) {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      },
      emit(name, payload) {
        for (const fn of handlers.get(name) ?? []) fn(payload);
      },
      load() {
        loaded = true;
        r.emit("load");
      },
    };
    (r as any).isMapLoaded = () => loaded;
    renderers.push(r);
    return r;
  }),
}));

import { MLMap } from "../../src/components/ml-map";
import { MapRenderer } from "../../src/renderer/map-renderer";
import { getDecoder } from "../../src/formats/decoders";
import { FormatError } from "../../src/formats/errors";
import type { MLMapProps } from "../../src/react";

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const first = () => renderers[0]!;
const latest = () => renderers[renderers.length - 1]!;

const STYLE_A = "https://example.com/a.json";
const STYLE_B = "https://example.com/b.json";

const block = (over: Record<string, unknown> = {}, config: Record<string, unknown> = {}) => ({
  type: "map" as const,
  id: "m",
  config: { mapStyle: STYLE_A, center: [-74.5, 40] as [number, number], zoom: 9, ...config },
  sources: { pts: { type: "geojson", url: "/data/pts.geojson" } },
  layers: [{ id: "pts", type: "circle" as const, source: "pts", paint: { "circle-radius": 4 } }],
  state: { year: { default: 2010 } },
  ...over,
});

type Seen = { type: string; detail: any };
function record(el: HTMLElement, types: string[]): Seen[] {
  const seen: Seen[] = [];
  for (const type of types) el.addEventListener(type, (e) => seen.push({ type, detail: (e as CustomEvent).detail }));
  return seen;
}
const EVENTS = ["ml-map:load", "ml-map:error", "ml-map:loading", "ml-map:update-applied", "ml-map:update-rejected", "ml-map:state-change"];

/** An element with a loaded map over `doc`. */
async function mounted(doc: unknown = block(), attrs: Record<string, string> = {}): Promise<{ el: MLMap; seen: Seen[] }> {
  const el = document.createElement("ml-map") as MLMap;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.config = doc as any;
  document.body.appendChild(el);
  await settle();
  expect(renderers).toHaveLength(1);
  first().load();
  const seen = record(el, EVENTS);
  return { el, seen };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  document.body.innerHTML = "";
  renderers.length = 0;
  hintsOn = true;
  vi.mocked(MapRenderer).mockClear();
  if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  globalThis.fetch = realFetch;
});

describe("a changed document reaches the running map", () => {
  it("a changed valid config calls update, constructs no renderer, and dispatches ml-map:update-applied (AE1)", async () => {
    const { el, seen } = await mounted();
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).toHaveBeenCalledTimes(1);
    const [next, hints] = first().update.mock.calls[0]!;
    expect(next.config.zoom).toBe(4);
    expect(next.layers[0].id).toBe("pts");
    expect(hints).toEqual({ failedSources: new Set(), urlsRebased: false });
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-applied"]);
    expect(seen[0]!.detail.summary.rebuild).toBe(false);
    expect(first().destroy).not.toHaveBeenCalled();
  });

  it("the config attribute takes the same path", async () => {
    const { el } = await mounted();
    el.setAttribute("config", JSON.stringify(block({}, { zoom: 5 })));
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update.mock.calls[0]![0].config.zoom).toBe(5);
  });

  it("an equal config dispatches nothing and calls neither (AE10)", async () => {
    const { el, seen } = await mounted();
    el.config = block() as any;
    el.config = JSON.stringify(block());
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("an equal document from inline YAML (no applied-config key held) is a no-op too: update runs, nothing changed, no event (R8, AE10)", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.innerHTML = `<script type="text/yaml">type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE_A}" }
layers: []
</script>`;
    document.body.appendChild(el);
    await settle();
    first().load();
    const seen = record(el, EVENTS);
    el.config = JSON.parse(JSON.stringify(el.getDocument()));
    await settle();
    // The element holds no key for a YAML document, so the renderer diffs it — and finds nothing.
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    const result = await el.update(JSON.parse(JSON.stringify(el.getDocument())));
    expect(result.outcome).toBe("applied");
    expect(seen).toEqual([]);
  });

  it("update(doc) is the method form: a MapBlock or JSON string, resolving with the outcome", async () => {
    const { el, seen } = await mounted();
    const result = await el.update(block({}, { zoom: 3 }));
    expect(result.outcome).toBe("applied");
    expect(first().update).toHaveBeenCalledTimes(1);
    const again = await el.update(JSON.stringify(block({}, { zoom: 2 })));
    expect(again.outcome).toBe("applied");
    expect(first().update).toHaveBeenCalledTimes(2);
    expect(seen.filter((e) => e.type === "ml-map:update-applied")).toHaveLength(2);
    // Equal to what is applied: nothing to do, nothing fired.
    const same = await el.update(block({}, { zoom: 2 }));
    expect(same.outcome).toBe("applied");
    expect(first().update).toHaveBeenCalledTimes(2);
  });

  it("el.getDocument() deep-equals el.config after an update", async () => {
    const { el } = await mounted();
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(el.getDocument()).toEqual(el.config);
    expect(el.getDocument()?.config.zoom).toBe(4);
  });

  it("a superseded update dispatches nothing; a rejected one forwards the renderer's errors", async () => {
    const { el, seen } = await mounted();
    first().update.mockResolvedValueOnce({ outcome: "superseded" });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(seen).toEqual([]);
    first().update.mockResolvedValueOnce({ outcome: "rejected", errors: [{ kind: "chunk", message: "could not download" }] });
    el.config = block({}, { zoom: 5 }) as any;
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(seen[0]!.detail).toEqual({ kind: "chunk", errors: [{ kind: "chunk", message: "could not download" }] });
  });

  it("an untrusted element updating to a document with {\"$html\": …} applies, no rejection (R19)", async () => {
    const { el, seen } = await mounted();
    const doc = block({
      layers: [{ id: "pts", type: "circle", source: "pts", popup: { template: { $html: "<b>{name}</b>" } } }],
    });
    el.config = doc as any;
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-applied"]);
    // The element never raises trust: the renderer escapes per its own
    // (absent) `capabilities`, which is what the popup builder tests prove.
    expect(first().options.capabilities).toBeUndefined();
  });
});

describe("an invalid update keeps the map and reports (AE3)", () => {
  it("dispatches ml-map:update-rejected with diagnostics, shows a hint, never the error card, and leaves the renderer untouched", async () => {
    const { el, seen } = await mounted();
    el.config = { ...block(), layers: [{ id: "bad", type: "nope" }] } as any;
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(seen[0]!.detail.kind).toBe("validation");
    expect(seen[0]!.detail.errors.length).toBeGreaterThan(0);
    expect(seen[0]!.detail.errors[0]).toMatchObject({ kind: "validation", message: expect.any(String) });
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.querySelector(".ml-map-notice")?.textContent).toMatch(/kept/i);
    expect(renderers).toHaveLength(1);
    expect(first().update).not.toHaveBeenCalled();
    expect(first().destroy).not.toHaveBeenCalled();
    expect(el.getRenderer()).toBe(first());
    // The previous document stays the element's.
    expect(el.config?.layers[0]?.id).toBe("pts");
    await expect(el.mapReady()).resolves.toBe(first().map);
  });

  it("the hint shows only while author hints are on; the event fires either way", async () => {
    hintsOn = false;
    const { el, seen } = await mounted();
    el.config = { ...block(), layers: [{ id: "bad", type: "nope" }] } as any;
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(el.querySelector(".ml-map-notice")).toBeNull();
  });

  it("a missing basemap is a validation rejection on a running map, not the card", async () => {
    const { el, seen } = await mounted();
    const { mapStyle: _drop, ...rest } = block().config;
    el.config = { ...block(), config: rest } as any;
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(seen[0]!.detail.errors[0].path).toBe("config.mapStyle");
    expect(el.querySelector(".ml-map-error")).toBeNull();
  });

  it("invalid JSON in the config property is rejected the same way", async () => {
    const { el, seen } = await mounted();
    el.config = "{not json";
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(el.querySelector(".ml-map-error")).toBeNull();
  });

  it("the rejection hint goes once a later valid update applies", async () => {
    const { el } = await mounted();
    el.config = { ...block(), layers: [{ id: "bad", type: "nope" }] } as any;
    await settle();
    expect(el.querySelector(".ml-map-notice")).not.toBeNull();
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(el.querySelector(".ml-map-notice")).toBeNull();
  });
});

describe("a mapStyle change is a fallback rebuild (AE4, KTD8)", () => {
  it("constructs a new renderer seeded with camera and state, fires update-applied with rebuild: true and ml-map:load again, removes the old map after the swap", async () => {
    const { el, seen } = await mounted();
    const order: string[] = [];
    first().destroy.mockImplementation(() => {
      first().destroyed = true;
      order.push("destroy");
    });
    el.addEventListener("ml-map:load", () => order.push(`load:${el.getMap() === latest().map ? "new" : "old"}`));
    el.addEventListener("ml-map:update-applied", () => order.push("applied"));

    first().map.camera = { center: [1, 2], zoom: 7, bearing: 30, pitch: 10 };
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    // Synchronously: the new renderer is built, the old one is paused, nothing is torn down yet.
    expect(renderers).toHaveLength(2);
    expect(first().pause).toHaveBeenCalledTimes(1);
    expect(first().update).not.toHaveBeenCalled();
    expect(first().destroy).not.toHaveBeenCalled();
    expect(el.getRenderer()).toBe(first());
    expect(latest().config.mapStyle).toBe(STYLE_B);
    expect(latest().options.initialCamera).toEqual({ center: [1, 2], zoom: 7, bearing: 30, pitch: 10 });
    expect(latest().options.initialState).toEqual({ year: 2020 });
    expect(latest().options.initialVisibility).toEqual({ pts: false });
    expect(latest().options.camera).toBe("document");
    // The new container is not on the page until the swap.
    expect(latest().container.isConnected).toBe(false);

    latest().load();
    await settle();
    expect(order).toEqual(["destroy", "load:new", "applied"]);
    expect(el.getRenderer()).toBe(latest());
    expect(latest().container.isConnected).toBe(true);
    expect(first().container.isConnected).toBe(false);
    expect(latest().map.resize).toHaveBeenCalled();
    const applied = seen.find((e) => e.type === "ml-map:update-applied")!;
    expect(applied.detail.summary.rebuild).toBe(true);
    expect(el.config?.config.mapStyle).toBe(STYLE_B);
    expect(seen.filter((e) => e.type === "ml-map:error")).toEqual([]);
  });

  it("mapReady() called synchronously after a mapStyle change resolves the new map, not the old one", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    const ready = el.mapReady();
    expect(renderers).toHaveLength(2);
    latest().load();
    await expect(ready).resolves.toBe(latest().map);
    expect(latest().map).not.toBe(first().map);
  });

  it("a slider override and a panel-hidden layer survive the fallback: the new renderer is seeded from rebuildSeed()", async () => {
    const { el } = await mounted();
    first().rebuildSeed.mockReturnValue({ initialState: { year: 2025 }, initialVisibility: { pts: false } });
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    expect(latest().options.initialState).toEqual({ year: 2025 });
    expect(latest().options.initialVisibility).toEqual({ pts: false });
    latest().load();
    await settle();
    expect(el.getState()).toEqual(latest().getState());
  });

  it("the camera moved on the old map during the swap: the new map appears at the moved camera", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    first().map.camera = { center: [5, 6], zoom: 3, bearing: 0, pitch: 0 };
    latest().load();
    await settle();
    expect(latest().map.jumpTo).toHaveBeenCalledWith({ center: [5, 6], zoom: 3, bearing: 0, pitch: 0 });
  });

  it("a changed document camera is not overridden by the old map's (camera is the document's)", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B, center: [10, 10], zoom: 2 }) as any;
    expect(latest().options.initialCamera).toBeUndefined();
    expect(latest().config.center).toEqual([10, 10]);
    latest().load();
    await settle();
    expect(latest().map.jumpTo).not.toHaveBeenCalled();
  });

  it("two mapStyle changes in quick succession never have three maps alive; the second waits for the first swap", async () => {
    const { el, seen } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    el.config = block({}, { mapStyle: "https://example.com/c.json" }) as any;
    await settle();
    expect(renderers).toHaveLength(2);
    expect(latest().config.mapStyle).toBe(STYLE_B);

    renderers[1]!.load();
    await settle();
    // The first swap committed; the queued one starts against the new map.
    expect(renderers).toHaveLength(3);
    expect(renderers[1]!.destroyed).toBe(false);
    expect(renderers[2]!.config.mapStyle).toBe("https://example.com/c.json");
    expect(first().destroyed).toBe(true);
    renderers[2]!.load();
    await settle();
    expect(renderers[1]!.destroyed).toBe(true);
    expect(el.getRenderer()).toBe(renderers[2]);
    expect(seen.filter((e) => e.type === "ml-map:update-applied")).toHaveLength(2);
    expect(seen.filter((e) => e.type === "ml-map:load")).toHaveLength(2);
  });

  it("an in-place update requested during a swap waits for the swap and applies to the new map", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    el.config = block({}, { mapStyle: STYLE_B, zoom: 3 }) as any;
    await settle();
    expect(first().update).not.toHaveBeenCalled();
    expect(latest().update).not.toHaveBeenCalled();
    latest().load();
    await settle();
    expect(latest().update).toHaveBeenCalledTimes(1);
    expect(latest().update.mock.calls[0]![0].config.zoom).toBe(3);
  });

  it("a fallback to an unreachable basemap keeps the old map, rejects with kind 'style', fires one non-fatal ml-map:error, and a later valid update applies", async () => {
    const { el, seen } = await mounted();
    const ready = el.mapReady();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    const fresh = latest();
    const failure = new Error("Failed to fetch b.json: 404");
    // MapLibre fires one error per problem, all in one task; the renderer classifies them as the style failing (fatal).
    fresh.options.onError(failure, true, { kind: "style", url: STYLE_B });
    fresh.options.onError(new Error("and again"), true, { kind: "style", url: STYLE_B });
    await settle();

    expect(fresh.destroyed).toBe(true);
    expect(first().destroyed).toBe(false);
    expect(el.getRenderer()).toBe(first());
    expect(el.getMap()).toBe(first().map);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    const errors = seen.filter((e) => e.type === "ml-map:error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.detail).toEqual({ error: failure, fatal: false });
    const rejected = seen.filter((e) => e.type === "ml-map:update-rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.detail.kind).toBe("style");
    expect(rejected[0]!.detail.errors[0]).toMatchObject({ kind: "style", message: failure.message });
    // The element's document is the one still on the map.
    expect(el.config?.config.mapStyle).toBe(STYLE_A);
    // A mapReady() that waited through the failed swap gets the surviving map.
    await expect(ready).resolves.toBe(first().map);
    expect(el.querySelector(".ml-map-notice")?.textContent).toMatch(/basemap/i);

    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(seen.filter((e) => e.type === "ml-map:update-applied")).toHaveLength(1);
  });

  it("a failed basemap swap resumes the old map's pipelines", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    expect(first().pause).toHaveBeenCalledTimes(1);
    expect(first().resume).not.toHaveBeenCalled();
    latest().options.onError(new Error("Failed to fetch b.json: 404"), true, { kind: "style", url: STYLE_B });
    await settle();
    expect(first().resume).toHaveBeenCalledTimes(1);
    expect(first().pause.mock.invocationCallOrder[0]).toBeLessThan(first().resume.mock.invocationCallOrder[0]!);
    // A swap that commits never resumes the old map: it is torn down instead.
    el.config = block({}, { mapStyle: "https://example.com/c.json" }) as any;
    latest().load();
    await settle();
    expect(first().resume).toHaveBeenCalledTimes(1);
    expect(first().destroyed).toBe(true);
  });

  it("a failed basemap swap keeps the old map's slot children in place", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.innerHTML = '<div slot="top-right" id="tr">tr</div>';
    el.config = block() as any;
    document.body.appendChild(el);
    await settle();
    first().load();
    const child = el.querySelector("#tr")!;
    expect(first().options.chrome[0].element).toBe(child);
    // The renderer double mounts no chrome; put the child where the real corner system would.
    const corner = document.createElement("div");
    corner.className = "ml-map-chrome ml-map-chrome-top-right";
    first().container.appendChild(corner);
    corner.appendChild(child);

    el.config = block({}, { mapStyle: STYLE_B }) as any;
    // Collected for the next map from the old map's chrome, not moved yet.
    expect(latest().options.chrome[0].element).toBe(child);
    expect(child.parentElement).toBe(corner);
    expect(first().container.isConnected).toBe(true);

    latest().options.onError(new Error("Failed to fetch b.json: 404"), true, { kind: "style", url: STYLE_B });
    await settle();
    expect(el.getRenderer()).toBe(first());
    expect(child.parentElement).toBe(corner);
    expect(child.closest(".ml-map-container")).toBe(first().container);
  });

  it("a worker that cannot start on the new map fails the swap the same way, never the card", async () => {
    const { el, seen } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    const fresh = latest();
    fresh.options.onError(new Error("Worker failed to load maplibre-gl 6"), false);
    await settle();
    expect(fresh.destroyed).toBe(true);
    expect(el.getRenderer()).toBe(first());
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(seen.filter((e) => e.type === "ml-map:update-rejected")).toHaveLength(1);
    expect(seen.filter((e) => e.type === "ml-map:error" && e.detail.fatal)).toEqual([]);
  });

  it("an unsettable construction option (interaction handler) is a rebuild too", async () => {
    const { el } = await mounted();
    el.config = block({}, { scrollZoom: false }) as any;
    expect(renderers).toHaveLength(2);
    expect(latest().config.scrollZoom).toBe(false);
  });

  it("removing the element mid-swap destroys both renderers", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    el.remove();
    expect(first().destroyed).toBe(true);
    expect(latest().destroyed).toBe(true);
  });
});

describe("camera ownership (KTD13)", () => {
  it("camera=\"host\" is passed to the renderer, reflects as a property, and a changed center is still an in-place update", async () => {
    const { el } = await mounted(block(), { camera: "host" });
    expect(el.camera).toBe("host");
    expect(first().options.camera).toBe("host");
    el.config = block({}, { center: [10, 10] }) as any;
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(first().map.jumpTo).not.toHaveBeenCalled();
  });

  it("under camera=\"host\" a fallback keeps the current camera even when the document's camera changed", async () => {
    const { el } = await mounted(block(), { camera: "host" });
    first().map.camera = { center: [1, 1], zoom: 5, bearing: 0, pitch: 0 };
    el.config = block({}, { mapStyle: STYLE_B, center: [10, 10], zoom: 2 }) as any;
    expect(latest().options.initialCamera).toEqual({ center: [1, 1], zoom: 5, bearing: 0, pitch: 0 });
    expect(latest().options.camera).toBe("host");
    latest().load();
    await settle();
    expect(latest().map.jumpTo).toHaveBeenCalledWith({ center: [1, 1], zoom: 5, bearing: 0, pitch: 0 });
  });

  it("the property writes the attribute, defaults to document, and reaches a running renderer", async () => {
    const { el } = await mounted();
    expect(el.camera).toBe("document");
    el.camera = "host";
    expect(el.getAttribute("camera")).toBe("host");
    expect(first().setCameraOwner).toHaveBeenCalledWith("host");
    el.camera = "document";
    expect(el.hasAttribute("camera")).toBe(false);
    expect(first().setCameraOwner).toHaveBeenLastCalledWith("document");
  });

  it("MLMapProps accepts camera", () => {
    const props: MLMapProps = { camera: "host" };
    expect(props.camera).toBe("host");
  });
});

describe("src, reload() and base become updates (KTD11, KTD12)", () => {
  const YAML = (zoom = 9, mapStyle = STYLE_A) => `type: map
id: from-src
config:
  center: [0, 0]
  zoom: ${zoom}
  mapStyle: "${mapStyle}"
sources:
  pts: { type: geojson, url: "/data/pts.geojson" }
layers:
  - { id: pts, type: circle, source: pts }
`;
  const ok = (body: string) => ({ ok: true, status: 200, headers: { get: () => "text/yaml" }, text: async () => body });

  it("src set to a 404 on a running map: ml-map:loading then update-rejected with kind 'fetch'; renderer untouched", async () => {
    const { el, seen } = await mounted();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as any;
    el.setAttribute("src", "missing.yaml");
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:loading", "ml-map:update-rejected"]);
    expect(seen[1]!.detail.kind).toBe("fetch");
    expect(seen[1]!.detail.errors[0]).toMatchObject({ kind: "fetch", message: expect.stringContaining("404") });
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getRenderer()).toBe(first());
    expect(first().update).not.toHaveBeenCalled();
    expect(el.querySelector(".ml-map-notice")?.textContent).toMatch(/missing\.yaml/);
  });

  it("a network failure is a fetch rejection too", async () => {
    const { el, seen } = await mounted();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as any;
    el.setAttribute("src", "map.yaml");
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:loading", "ml-map:update-rejected"]);
    expect(seen[1]!.detail.kind).toBe("fetch");
    expect(el.getRenderer()).toBe(first());
  });

  it("the same 404 on a fresh element shows the error card as today", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as any;
    const el = document.createElement("ml-map") as MLMap;
    const seen = record(el, EVENTS);
    el.setAttribute("src", "missing.yaml");
    document.body.appendChild(el);
    await settle();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:loading", "ml-map:error"]);
    expect(el.querySelector(".ml-map-error")).not.toBeNull();
  });

  it("a fetched document that changed updates in place", async () => {
    const { el } = await mounted();
    globalThis.fetch = vi.fn(async () => ok(YAML(3))) as any;
    el.setAttribute("src", "map.yaml");
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(first().update.mock.calls[0]![0].config.zoom).toBe(3);
  });

  it("reload() with unchanged inline YAML and a source whose chunk failed retries that source (R22)", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.innerHTML = `<script type="text/yaml">${YAML()}</script>`;
    document.body.appendChild(el);
    await settle();
    first().load();
    first().failedSources.mockReturnValue(new Set(["pts"]));
    await el.reload();
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).toHaveBeenCalledTimes(1);
    const [, hints] = first().update.mock.calls[0]!;
    expect([...hints.failedSources]).toEqual(["pts"]);
    expect(hints.urlsRebased).toBe(false);
  });

  it("a data notice is withdrawn when reload() retries the source and it loads; an untouched layer's notice stays", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.innerHTML = `<script type="text/yaml">${YAML()}  - { id: roads, type: line, source: pts }\n</script>`;
    document.body.appendChild(el);
    await settle();
    first().load();
    // Two readers failed: one line each on the notice (always shown: a failure, not a hint).
    first().emit("layer:data-error", { layerId: "pts", error: new Error("The FlatGeobuf reader couldn't be downloaded") });
    first().emit("layer:data-error", { layerId: "roads", error: new Error("The FlatGeobuf reader couldn't be downloaded") });
    const notice = () => el.querySelector(".ml-map-notice")?.textContent ?? "";
    expect(notice()).toContain("layer pts");
    expect(notice()).toContain("layer roads");

    // reload() retries the failed source; the attempt alone withdraws nothing.
    first().failedSources.mockReturnValue(new Set(["pts"]));
    await el.reload();
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(notice()).toContain("layer pts");

    // Its data lands: that layer's line goes; the other layer's stays.
    first().emit("layer:data-loaded", { layerId: "pts", featureCount: 3 });
    expect(notice()).not.toContain("layer pts");
    expect(notice()).toContain("layer roads");
    first().emit("layer:data-loaded", { layerId: "roads", featureCount: 1 });
    expect(el.querySelector(".ml-map-notice")).toBeNull();
  });

  it("an applied update's added, replaced and replaced-source lines are withdrawn; others stay", async () => {
    const { el } = await mounted();
    first().options.onError(new Error("layers.pts: color expected"), false, { kind: "layer", layerId: "pts" });
    first().options.onError(new Error("tiles 404"), false, { kind: "source", sourceId: "pts" });
    first().options.onError(new Error("layers.other: bad"), false, { kind: "layer", layerId: "other" });
    const notice = () => el.querySelector(".ml-map-notice")?.textContent ?? "";
    expect(notice()).toContain("Layer pts");
    expect(notice()).toContain("Source pts");
    expect(notice()).toContain("Layer other");
    first().update.mockImplementationOnce(async () => {
      const summary = { ...emptySummary(), replaced: ["pts"], sourcesReplaced: ["pts"] };
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(notice()).not.toContain("Layer pts");
    expect(notice()).not.toContain("Source pts");
    expect(notice()).toContain("Layer other");
  });

  it("reload() of a src document carries the failed sources too", async () => {
    globalThis.fetch = vi.fn(async () => ok(YAML())) as any;
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute("src", "map.yaml");
    document.body.appendChild(el);
    await settle();
    first().load();
    first().failedSources.mockReturnValue(new Set(["pts"]));
    await el.reload();
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
    expect([...first().update.mock.calls[0]![1].failedSources]).toEqual(["pts"]);
  });

  it("a base change with the same document re-resolves URLs and applies as an update with urlsRebased", async () => {
    const { el } = await mounted();
    el.base = "/my-repo/";
    await settle();
    expect(renderers).toHaveLength(1);
    expect(first().update).toHaveBeenCalledTimes(1);
    const [next, hints] = first().update.mock.calls[0]!;
    expect(next.sources.pts.url).toBe("/my-repo/data/pts.geojson");
    expect(hints.urlsRebased).toBe(true);
    // An equivalent spelling is not a change.
    el.setAttribute("base", "/my-repo");
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
  });

  it("a valid config after an error card renders fresh and fires ml-map:load", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const seen = record(el, EVENTS);
    el.config = { type: "map", id: "x", layers: [{ id: "bad", type: "nope" }] } as any;
    document.body.appendChild(el);
    await settle();
    expect(el.querySelector(".ml-map-error")).not.toBeNull();
    expect(renderers).toHaveLength(0);

    el.config = block() as any;
    await settle();
    expect(renderers).toHaveLength(1);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    first().load();
    expect(seen.map((e) => e.type)).toEqual(["ml-map:error", "ml-map:load"]);
  });
});

describe("state and errors through the element", () => {
  it("setState / getState forward to the renderer, and state:change becomes ml-map:state-change", async () => {
    const { el, seen } = await mounted();
    el.setState({ year: 2015 });
    expect(first().setState).toHaveBeenCalledWith({ year: 2015 });
    expect(el.getState()).toEqual({ year: 2020 });
    first().emit("state:change", { values: { year: 2015 }, changed: ["year"] });
    expect(seen.map((e) => e.type)).toEqual(["ml-map:state-change"]);
    expect(seen[0]!.detail).toEqual({ values: { year: 2015 }, changed: ["year"] });
  });

  it("without a running map, setState throws and getState is empty", () => {
    const el = document.createElement("ml-map") as MLMap;
    expect(() => el.setState({ year: 1 })).toThrow(/no map/i);
    expect(el.getState()).toEqual({});
    expect(el.getDocument()).toBeNull();
  });

  it("a per-operation failure dispatches ml-map:error with fatal: false, and no update path ever dispatches fatal: true", async () => {
    const { el, seen } = await mounted();
    first().update.mockImplementationOnce(async () => {
      first().options.onError(new Error('layers.pts: color expected, "bleu" found'), false, { kind: "layer", layerId: "pts" });
      const summary = { ...emptySummary(), failures: [{ op: "layerSetProperty", message: "bad colour" }] };
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    const errors = seen.filter((e) => e.type === "ml-map:error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.detail.fatal).toBe(false);
    expect(el.querySelector(".ml-map-notice")?.textContent).toContain("didn't draw");
    expect(seen.filter((e) => e.type === "ml-map:update-applied")).toHaveLength(1);
    await expect(el.mapReady()).resolves.toBe(first().map);
  });

  it("a host-layer collision reported by the engine is an author hint naming both owners", async () => {
    const { el } = await mounted();
    first().update.mockImplementationOnce(async () => {
      first().options.onError(
        new Error('Layer "pts" is on the map but was not declared by the document (a host added it), so the document\'s layer is skipped.'),
        false,
        { kind: "layer", layerId: "pts", reason: "host-layer-collision" }
      );
      return { outcome: "applied", summary: emptySummary() };
    });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(el.querySelector(".ml-map-notice")?.textContent).toMatch(/page.*pts|pts.*page/);
  });
});

describe("the notice is settled when an update applies, never before (review sweep)", () => {
  const notice = (el: MLMap) => el.querySelector(".ml-map-notice")?.textContent ?? "";
  const failPts = (message: string) => first().options.onError(new Error(message), false, { kind: "layer", layerId: "pts" });

  it("a failure the update itself reports for a layer it added survives; the line from before the update goes", async () => {
    const { el } = await mounted();
    failPts("layers.pts: old failure");
    expect(notice(el)).toContain("old failure");
    first().update.mockImplementationOnce(async () => {
      failPts("layers.pts: new failure");
      const summary = { ...emptySummary(), added: ["pts"] };
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(notice(el)).toContain("new failure");
    expect(notice(el)).not.toContain("old failure");
  });

  it("the same failure reported again during the update stays on the notice", async () => {
    const { el } = await mounted();
    failPts("layers.pts: bad colour");
    first().update.mockImplementationOnce(async () => {
      failPts("layers.pts: bad colour");
      const summary = { ...emptySummary(), replaced: ["pts"] };
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(notice(el)).toContain("bad colour");
  });

  it("a removed layer's line goes with it", async () => {
    const { el } = await mounted();
    failPts("layers.pts: bad colour");
    expect(notice(el)).toContain("Layer pts");
    first().update.mockImplementationOnce(async () => {
      const summary = { ...emptySummary(), removed: ["pts"] };
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    el.config = block({ layers: [] }) as any;
    await settle();
    expect(el.querySelector(".ml-map-notice")).toBeNull();
  });

  it("a document's on-page warning goes when a clean document replaces it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The reserved `=` prefix in a style value: an author hint on the page (and an in-place change, not a rebuild).
    const reserved = { id: "pts", type: "symbol", source: "pts", layout: { "text-field": "=upper({name})" } };
    const { el } = await mounted(block({ layers: [reserved] }));
    expect(notice(el)).toContain("=upper({name})");
    el.config = block({}, { zoom: 4 }) as any;
    await settle();
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    warn.mockRestore();
  });
});

describe("a refused update never clobbers a later one (KTD5)", () => {
  it("A rejected (chunk) while B is in flight: the document is B's", async () => {
    const { el } = await mounted();
    let settleA!: (result: unknown) => void;
    first().update.mockImplementationOnce(() => new Promise((resolve) => (settleA = resolve)));
    el.config = block({}, { zoom: 4 }) as any;
    el.config = block({}, { zoom: 5 }) as any;
    await settle();
    expect(el.getDocument()?.config.zoom).toBe(5);
    settleA({ outcome: "rejected", errors: [{ kind: "chunk", message: "offline" }] });
    await settle();
    expect(el.getDocument()?.config.zoom).toBe(5);
    expect(el.config?.config.zoom).toBe(5);
  });

  it("A applied while B is in flight, then B rejected: the document goes back to A's, not to the one before A", async () => {
    const { el } = await mounted();
    let settleB!: (result: unknown) => void;
    first()
      .update.mockImplementationOnce(async (next: any) => {
        first().config = next.config;
        return { outcome: "applied", summary: emptySummary() };
      })
      .mockImplementationOnce(() => new Promise((resolve) => (settleB = resolve)));
    el.config = block({}, { zoom: 4 }) as any;
    el.config = block({}, { zoom: 5 }) as any;
    await settle();
    settleB({ outcome: "rejected", errors: [{ kind: "chunk", message: "offline" }] });
    await settle();
    expect(el.getDocument()?.config.zoom).toBe(4);
  });
});

describe("the swap: a base change, the next map's notices, state written meanwhile (KTD8 review sweep)", () => {
  it("a base change during a swap applies to the document the swap builds, once it is up: no third map", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    el.base = "/my-repo/";
    await settle();
    expect(renderers).toHaveLength(2);
    latest().load();
    await settle();
    expect(renderers).toHaveLength(2);
    expect(first().update).not.toHaveBeenCalled();
    expect(latest().update).toHaveBeenCalledTimes(1);
    const [next, hints] = latest().update.mock.calls[0]!;
    expect(next.config.mapStyle).toBe(STYLE_B);
    expect(next.sources.pts.url).toBe("/my-repo/data/pts.geojson");
    expect(hints.urlsRebased).toBe(true);
    expect(el.getDocument()?.config.mapStyle).toBe(STYLE_B);
  });

  it("what the next map reports while it loads goes on the notice when it takes the old map's place", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    latest().options.onError(new Error("layers.pts: bad colour"), false, { kind: "layer", layerId: "pts" });
    // Not the old map's problem: nothing on the page yet.
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    latest().load();
    await settle();
    expect(el.querySelector(".ml-map-notice")?.textContent).toContain("Layer pts");
  });

  it("... and is dropped when the swap fails", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    latest().options.onError(new Error("layers.pts: bad colour"), false, { kind: "layer", layerId: "pts" });
    latest().options.onError(new Error("Failed to fetch b.json: 404"), true, { kind: "style", url: STYLE_B });
    await settle();
    expect(el.getRenderer()).toBe(first());
    expect(el.querySelector(".ml-map-notice")?.textContent ?? "").not.toContain("Layer pts");
  });

  it("the slot children are mounted on the new map at commit, not before", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    expect(latest().options.deferChrome).toBe(true);
    expect(first().options.deferChrome).toBeUndefined();
    expect(latest().mountHostChrome).not.toHaveBeenCalled();
    latest().load();
    await settle();
    expect(latest().mountHostChrome).toHaveBeenCalledTimes(1);
    expect(latest().mountHostChrome.mock.invocationCallOrder[0]).toBeLessThan(latest().map.resize.mock.invocationCallOrder[0]!);
  });

  it("setState during a swap that then fails lands on the map that stays; getState() reads it back meanwhile", async () => {
    const { el } = await mounted();
    el.config = block({}, { mapStyle: STYLE_B }) as any;
    latest().rebuildSeed.mockReturnValue({ initialState: { year: 2025, other: 1 }, initialVisibility: {} });
    el.setState({ year: 2025 });
    expect(latest().setState).toHaveBeenCalledWith({ year: 2025 });
    // The old document declares `year`, not `other`.
    expect(el.getState()).toEqual({ year: 2025 });
    latest().options.onError(new Error("Failed to fetch b.json: 404"), true, { kind: "style", url: STYLE_B });
    await settle();
    expect(first().setState).toHaveBeenCalledWith({ year: 2025 });
  });
});

describe("update() before connect and reload() of an unchanged document (review sweep)", () => {
  it("update() before the element connects resolves with the first render's outcome, not a fabricated 'applied'", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const result = el.update(block());
    document.body.appendChild(el);
    await settle();
    first().load();
    await expect(result).resolves.toMatchObject({ outcome: "fallback", summary: { rebuild: true } });
  });

  it("... or 'rejected' when that first render is the error card", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const { mapStyle: _drop, ...rest } = block().config;
    const result = el.update({ ...block(), config: rest } as any);
    document.body.appendChild(el);
    await settle();
    await expect(result).resolves.toMatchObject({ outcome: "rejected" });
    expect(el.querySelector(".ml-map-error")).not.toBeNull();
  });

  it("reload() of an unchanged inline document still answers with ml-map:update-applied (rebuild false, no failures); an equal config still dispatches nothing", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.innerHTML = `<script type="text/yaml">type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE_A}" }
layers: []
</script>`;
    document.body.appendChild(el);
    await settle();
    first().load();
    const seen = record(el, EVENTS);
    await el.reload();
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(first().update.mock.calls[0]![1].reload).toBe(true);
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-applied"]);
    expect(seen[0]!.detail.summary).toMatchObject({ rebuild: false, failures: [] });
    el.config = JSON.parse(JSON.stringify(el.getDocument()));
    await settle();
    expect(first().update).toHaveBeenCalledTimes(2);
    expect(first().update.mock.calls[1]![1].reload).toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});

describe("documents in any format: one ingest path, the newest wins (JSON and TOML, U4)", () => {
  const realGetDecoder = vi.mocked(getDecoder).getMockImplementation()!;
  afterEach(() => vi.mocked(getDecoder).mockImplementation(realGetDecoder));

  /** Hold the TOML reader's download until `release()`. */
  function holdTomlReader(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(getDecoder).mockImplementation(((name: string) =>
      name === "toml" ? gate.then(() => realGetDecoder(name as never)) : realGetDecoder(name as never)) as never);
    return release;
  }
  /** The TOML reader can't be downloaded. */
  function blockTomlReader(): void {
    vi.mocked(getDecoder).mockImplementation(((name: string) =>
      name === "toml"
        ? Promise.reject(new FormatError({ code: "chunk", format: name as never, url: "chunks/toml.js", detail: "offline" }))
        : realGetDecoder(name as never)) as never);
  }

  const TOML = (id: string, zoom = 9) => `type = "map"
id = "${id}"

[config]
center = [-74.5, 40]
zoom = ${zoom}
mapStyle = "${STYLE_A}"

[sources.pts]
type = "geojson"
url = "/data/pts.geojson"

[[layers]]
id = "pts"
type = "circle"
source = "pts"
`;
  const YAML = (id: string, zoom = 9) => `type: map
id: ${id}
config:
  center: [-74.5, 40]
  zoom: ${zoom}
  mapStyle: "${STYLE_A}"
sources:
  pts: { type: geojson, url: "/data/pts.geojson" }
layers:
  - { id: pts, type: circle, source: pts }
`;
  const response = (body: string, type = "application/toml") => ({
    ok: true,
    status: 200,
    url: "",
    headers: { get: () => type },
    text: async () => body,
  });

  it("race: src=a.toml waits for the TOML reader, update(yaml) arrives: the YAML applies and a.toml is dropped (sequence diagram)", async () => {
    const { el, seen } = await mounted();
    const release = holdTomlReader();
    globalThis.fetch = vi.fn(async () => response(TOML("a", 3))) as any;
    el.setAttribute("src", "a.toml");
    await settle();
    const result = await el.update(YAML("b", 5));
    expect(result.outcome).toBe("applied");
    expect(first().update).toHaveBeenCalledTimes(1);
    release();
    await settle();
    // a.toml was read after b applied: dropped, never handed to the map.
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(el.getDocument()?.id).toBe("b");
    expect(seen.map((e) => e.type)).toEqual(["ml-map:loading", "ml-map:update-applied"]);
  });

  it("race: update(tomlText) waiting for its reader is overtaken by update(yaml): it resolves superseded, the YAML applies", async () => {
    const { el } = await mounted();
    const release = holdTomlReader();
    const slow = el.update(TOML("a", 3));
    const fast = await el.update(YAML("b", 5));
    expect(fast.outcome).toBe("applied");
    release();
    await expect(slow).resolves.toEqual({ outcome: "superseded" });
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(el.getDocument()?.id).toBe("b");
  });

  it("update(tomlText) on a running map resolves with the real outcome and summary, not an empty applied", async () => {
    const { el, seen } = await mounted();
    const summary = { ...emptySummary(), propertiesSet: [{ layerId: "pts", property: "circle-radius" }] };
    first().update.mockImplementationOnce(async (next: any) => {
      first().config = next.config;
      first().emit("update:applied", { summary });
      return { outcome: "applied", summary };
    });
    const result = await el.update(TOML("m", 4));
    expect(result).toEqual({ outcome: "applied", summary });
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(first().update.mock.calls[0]![0].config.zoom).toBe(4);
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-applied"]);
    // An invalid TOML document is refused, with its TOML line.
    const refused = await el.update(TOML("m", 4).replace("zoom = 4", 'zoom = "far"'));
    expect(refused.outcome).toBe("rejected");
    expect(seen.at(-1)!.type).toBe("ml-map:update-rejected");
    expect(first().update).toHaveBeenCalledTimes(1);
  });

  it("the TOML reader can't be downloaded: update(tomlText) on a running map is refused with kind 'chunk', the map untouched, no card", async () => {
    const { el, seen } = await mounted();
    blockTomlReader();
    const result = await el.update(TOML("m", 4));
    expect(result.outcome).toBe("rejected");
    expect(result.errors?.[0]).toMatchObject({ kind: "chunk", message: expect.stringContaining("TOML reader") });
    expect(seen.map((e) => e.type)).toEqual(["ml-map:update-rejected"]);
    expect(seen[0]!.detail.kind).toBe("chunk");
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getRenderer()).toBe(first());
    expect(first().update).not.toHaveBeenCalled();
    // The same text again is tried again (the reader may download now).
    vi.mocked(getDecoder).mockImplementation(realGetDecoder);
    await expect(el.update(TOML("m", 4))).resolves.toMatchObject({ outcome: "applied" });
    expect(first().update).toHaveBeenCalledTimes(1);
  });

  it("the TOML reader can't be downloaded on a first render: the TOML-reader card; reload() re-reads the config attribute and renders", async () => {
    blockTomlReader();
    const el = document.createElement("ml-map") as MLMap;
    const seen = record(el, EVENTS);
    el.setAttribute("config", TOML("first"));
    document.body.appendChild(el);
    await settle();
    expect(renderers).toHaveLength(0);
    const card = el.querySelector(".ml-map-error")!.textContent!;
    expect(card).toContain("Couldn't read the TOML document");
    expect(card).toContain("the TOML reader (chunks/toml.js) couldn't be downloaded");
    expect(card).toContain("reload()");
    expect(card).not.toContain("Other layers are unaffected");
    expect(seen.map((e) => e.type)).toEqual(["ml-map:error"]);
    vi.mocked(getDecoder).mockImplementation(realGetDecoder);
    await el.reload();
    await settle();
    expect(renderers).toHaveLength(1);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.config?.id).toBe("first");
  });

  it("the empty-document check does not fire while the TOML reader downloads", async () => {
    const release = holdTomlReader();
    const el = document.createElement("ml-map") as MLMap;
    const seen = record(el, EVENTS);
    el.innerHTML = `<script type="application/toml">${TOML("inline")}</script>`;
    document.body.appendChild(el);
    // Past the check's 500 ms bound.
    await settle(700);
    expect(seen).toEqual([]);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    release();
    await settle();
    expect(renderers).toHaveLength(1);
    expect(el.config?.id).toBe("inline");
  });

  it("a TOML src downloads the reader alongside the fetch, not after it", async () => {
    const release = holdTomlReader();
    let fetched = false;
    globalThis.fetch = vi.fn(async () => {
      fetched = true;
      return response(TOML("from-src"));
    }) as any;
    vi.mocked(getDecoder).mockClear();
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute("src", "maps/a.toml?v=3");
    document.body.appendChild(el);
    // Asked for in the same turn as the fetch, before the response arrived.
    expect(vi.mocked(getDecoder).mock.calls.map((c) => c[0])).toEqual(["toml"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(fetched).toBe(true);
    expect(renderers).toHaveLength(1);
    expect(el.config?.id).toBe("from-src");
  });

  it("while TOML text is being read, el.config is the last applied document; the same text twice starts one read", async () => {
    const { el } = await mounted();
    const release = holdTomlReader();
    vi.mocked(getDecoder).mockClear();
    const text = TOML("next", 4);
    el.config = text;
    expect(el.config?.id).toBe("m");
    el.config = text;
    const joined = el.update(text);
    await settle();
    expect(el.config?.id).toBe("m");
    expect(vi.mocked(getDecoder).mock.calls.filter((c) => c[0] === "toml")).toHaveLength(1);
    release();
    await expect(joined).resolves.toMatchObject({ outcome: "applied" });
    expect(first().update).toHaveBeenCalledTimes(1);
    expect(el.config?.id).toBe("next");
    // And once applied, the same text again is a no-op too (a React re-render).
    el.setAttribute("config", text);
    await settle();
    expect(first().update).toHaveBeenCalledTimes(1);
  });
});
