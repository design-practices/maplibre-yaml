/**
 * @file `<ml-map>` exposes a grid source's field (grid source, U4)
 * @module @maplibre-yaml/core/tests/components
 *
 * @description
 * The element half of grid sources: `getGrid`, `hasGrid` and `gridReady`
 * forward to the renderer, `ml-map:source-loaded` announces a decoded field, a failed load
 * lands on the per-source notice and leaves with a successful `reload()`.
 * Each test maps to one bullet of the plan's U4 test scenarios
 * (docs/plans/2026-11-14-001-feat-grid-source-plan.md).
 *
 * Unlike the other element tests this one runs the REAL renderer over the
 * mocked `maplibre-gl` (as tests/renderer/grid-sources.test.ts does), so the
 * committed 1° frames (examples/verification/null-earth/data) are decoded by
 * the real chunk and the field page code gets is the real one. `fetch` is
 * stubbed to serve them, gated so a test decides when a response lands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Every MapLibre map built, in order: a rebuild's next map is `maps[1]`. */
const { maps } = vi.hoisted(() => ({ maps: [] as any[] }));

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public removeLayer = vi.fn();
    public removeSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public setLayoutProperty = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();
    public jumpTo = vi.fn();
    public resize = vi.fn();
    public getStyle = () => ({ layers: [] });
    constructor() {
      maps.push(this);
    }
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    getZoom() {
      return 2;
    }
    getBearing() {
      return 0;
    }
    getPitch() {
      return 0;
    }
    getCanvas() {
      return { style: { cursor: "" } };
    }
    getContainer() {
      return document.createElement("div");
    }
    on(event: string, callback: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(callback);
    }
    once(event: string, callback: Function) {
      const wrapped = (data?: unknown) => {
        this.off(event, wrapped);
        callback(data);
      };
      this.on(event, wrapped);
    }
    off(event: string, callback: Function) {
      this.events.get(event)?.delete(callback);
    }
    emit(event: string, data?: unknown) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const control = (type: string) => vi.fn(() => ({ type }));
  const exports = {
    getVersion: () => undefined,
    Map: MockMap,
    NavigationControl: control("navigation"),
    GeolocateControl: control("geolocate"),
    ScaleControl: control("scale"),
    FullscreenControl: control("fullscreen"),
    AttributionControl: control("attribution"),
    Popup: vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), on: vi.fn(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
  };
  return { ...exports, default: exports };
});

import { MLMap } from "../../src/components/ml-map";
import { isFormatError } from "../../src/formats/errors";
import type { GridSource } from "../../src/schemas/source.schema";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/verification/null-earth/data");
const F000 = "2026111400-f000-wind-10m.png";
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

const GEOMETRY = { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 };
const STYLE_A = "https://example.com/a.json";
const STYLE_B = "https://example.com/b.json";

/** A test's own URL space, so the chunk's module-level cache never carries one test's bytes into another. */
let run = 0;
const wind = (file: string, overrides: Partial<GridSource> = {}): GridSource => ({
  type: "grid",
  url: `data/${run}/${file}`,
  encoding: "rg-uv",
  range: [-40, 40],
  grid: GEOMETRY,
  units: "m/s",
  nodata: { channel: "b", below: 128 },
  ...overrides,
});

const doc = (sources: Record<string, GridSource>, mapStyle = STYLE_A) => ({
  type: "map",
  id: "m",
  config: { center: [0, 0], zoom: 2, mapStyle },
  sources,
  layers: [],
});

interface Gate {
  open(): void;
  opened: Promise<void>;
  requests: number;
}

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened, requests: 0 };
}

/** Serve the committed frames by file name under any path; a `gate` holds a URL's response; `status` answers with an HTTP error. */
function serve(options: { gate?: Record<string, Gate>; status?: Record<string, number> } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const file = url.split("/").pop()!;
    const g = options.gate?.[file];
    if (g) {
      g.requests++;
      await g.opened;
    }
    const status = options.status?.[file];
    if (status) return new Response("nope", { status, statusText: status === 404 ? "Not Found" : "Error" });
    return new Response(fixture(file) as unknown as BodyInit, { status: 200 });
  });
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const latestMap = () => maps[maps.length - 1]!;
const noticeText = (el: MLMap) => el.querySelector(".ml-map-notice")?.textContent?.replace(/\s+/g, " ").trim();

interface Seen {
  type: string;
  detail: any;
  bubbles: boolean;
}

function record(el: HTMLElement, types: string[]): Seen[] {
  const seen: Seen[] = [];
  for (const type of types) el.addEventListener(type, (e) => seen.push({ type, detail: (e as CustomEvent).detail, bubbles: e.bubbles }));
  return seen;
}

/** An element over `document` (the `config` attribute, so `reload()` has it to re-read), its renderer built; the map has not loaded yet. */
async function mount(document_: unknown): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  el.setAttribute("config", JSON.stringify(document_));
  document.body.appendChild(el);
  await tick();
  expect(el.getRenderer(), "the renderer was built").not.toBeNull();
  return el;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error as Error
  );
  expect(outcome, "expected a rejection").toBeInstanceOf(Error);
  return outcome!;
}

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  run++;
  maps.length = 0;
  document.body.innerHTML = "";
  if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.querySelector("base")?.remove();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("<ml-map> getGrid / gridReady / ml-map:source-loaded (R14, R15)", () => {
  it("happy path: gridReady resolves with the field; getGrid is undefined before and the field after; ml-map:source-loaded bubbles with the source id; the map loads without waiting", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F000]: g } });
    const el = await mount(doc({ field: wind(F000) }));
    const seen = record(el, ["ml-map:source-loaded"]);
    expect(el.getGrid("field")).toBeUndefined();
    // Nothing is registered before the style loads: hasGrid is false, as for any unknown id.
    expect(el.hasGrid("field")).toBe(false);
    const ready = el.gridReady("field");
    latestMap().emit("load");
    // mapReady() does not wait for the grid: the response is still held.
    await el.mapReady();
    expect(el.getGrid("field")).toBeUndefined();
    // Declared and registered, not yet decoded: hasGrid tells this apart from "no such source".
    expect(el.hasGrid("field")).toBe(true);
    expect(el.getRenderer()!.hasGrid("field")).toBe(true);
    expect(el.hasGrid("nope")).toBe(false);
    expect(seen).toEqual([]);
    g.open();
    const field = await ready;
    expect(field.kind).toBe("vector");
    expect(field.units).toBe("m/s");
    expect(el.getGrid("field")).toBe(field);
    expect(el.getRenderer()!.getGrid("field")).toBe(field);
    expect(el.hasGrid("field")).toBe(true);
    expect(el.hasGrid("nope")).toBe(false);
    expect(seen).toEqual([{ type: "ml-map:source-loaded", detail: { sourceId: "field" }, bubbles: true }]);
    // A grid never reaches MapLibre.
    expect(latestMap().addSource).not.toHaveBeenCalled();
  });

  it("gridReady for an id the document has no grid source for rejects naming the id", async () => {
    fetchSpy = serve();
    const el = await mount(doc({ field: wind(F000) }));
    latestMap().emit("load");
    const error = await rejection(el.gridReady("nope"));
    expect(error.message).toContain("nope");
    expect(isFormatError(error)).toBe(false);
  });

  it("gridReady called before the map exists (the element not yet on the page) resolves once the map has loaded", async () => {
    fetchSpy = serve();
    const el = document.createElement("ml-map") as MLMap;
    const ready = el.gridReady("field");
    expect(el.getRenderer()).toBeNull();
    expect(el.getGrid("field")).toBeUndefined();
    // No map yet: nothing is declared as far as the element can tell.
    expect(el.hasGrid("field")).toBe(false);
    el.config = doc({ field: wind(F000) }) as any;
    document.body.appendChild(el);
    await tick();
    latestMap().emit("load");
    const field = await ready;
    expect(field.kind).toBe("vector");
    expect(el.getGrid("field")).toBe(field);
    expect(el.hasGrid("field")).toBe(true);
  });

  it("hasGrid is false for a non-grid source and for a grid the applied document no longer declares", async () => {
    fetchSpy = serve();
    const document_ = doc({ field: wind(F000) }) as any;
    document_.sources.points = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const el = await mount(document_);
    latestMap().emit("load");
    await el.mapReady();
    expect(el.hasGrid("field")).toBe(true);
    expect(el.hasGrid("points"), "a MapLibre source is not a grid").toBe(false);
    // A live update that drops the grid: hasGrid follows the applied document.
    const applied = new Promise<void>((resolve) => el.addEventListener("ml-map:update-applied", () => resolve(), { once: true }));
    el.config = doc({}) as any;
    await applied;
    expect(el.hasGrid("field")).toBe(false);
    expect(el.getGrid("field")).toBeUndefined();
  });

  it("a mapStyle change while the field is awaited: gridReady resolves against the rebuilt renderer, not the one torn down", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F000]: g } });
    const el = await mount(doc({ field: wind(F000) }));
    latestMap().emit("load");
    await el.mapReady();
    const first = el.getRenderer()!;
    const ready = el.gridReady("field");
    // The basemap change is a fallback rebuild (KTD8): a second map is built off the page.
    el.config = doc({ field: wind(F000) }, STYLE_B) as any;
    expect(maps).toHaveLength(2);
    expect(el.getRenderer()).toBe(first);
    maps[1].emit("load");
    await el.mapReady();
    const next = el.getRenderer()!;
    expect(next).not.toBe(first);
    g.open();
    const field = await ready;
    expect(field.kind).toBe("vector");
    expect(next.getGrid("field")).toBe(field);
    expect(el.getGrid("field")).toBe(field);
  });

  it("a grid that 404s shows the per-source notice with the base hint; a successful reload() clears it", async () => {
    // A page published under a subpath, with a site-rooted URL: the notice says what `base` to add.
    const base = document.createElement("base");
    base.href = "http://localhost:3000/my-repo/page.html";
    document.head.appendChild(base);
    const status: Record<string, number> = { [F000]: 404 };
    fetchSpy = serve({ status });
    const el = await mount(doc({ field: wind(F000, { url: `/data/${run}/${F000}` }) }));
    const seen = record(el, ["ml-map:source-loaded", "ml-map:error"]);
    latestMap().emit("load");
    const error = await rejection(el.gridReady("field"));
    expect(isFormatError(error)).toBe(true);
    await tick();
    expect(el.querySelector(".ml-map-error"), "no card: the map keeps working").toBeNull();
    const text = noticeText(el)!;
    expect(text).toContain("Part of this map couldn't load");
    expect(text).toContain("Source field didn't load");
    expect(text).toContain(`/data/${run}/${F000}`);
    expect(text).toContain("404");
    expect(text).toContain(`The browser looked for http://localhost:3000/data/${run}/${F000}`);
    expect(text).toContain('add base="/my-repo/"');
    expect(seen.find((e) => e.type === "ml-map:error")?.detail.fatal).toBe(false);
    expect(el.getGrid("field")).toBeUndefined();

    // The file appears; reload() retries the failed source (one more fetch) and the notice goes.
    // reload() resolves once the document is routed; the retry is the update it routes to.
    delete status[F000];
    const applied = new Promise<void>((resolve) => el.addEventListener("ml-map:update-applied", () => resolve(), { once: true }));
    await el.reload();
    await applied;
    const field = await el.gridReady("field");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(field.kind).toBe("vector");
    expect(el.getGrid("field")).toBe(field);
    await tick();
    expect(el.querySelector(".ml-map-notice")).toBeNull();
    expect(seen.filter((e) => e.type === "ml-map:source-loaded").map((e) => e.detail)).toEqual([{ sourceId: "field" }]);
  });
});
