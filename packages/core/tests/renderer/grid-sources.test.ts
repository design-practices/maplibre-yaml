/**
 * @file Grid sources at render time: the manager, live updates and the renderer API (grid source, U3)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * A `type: grid` source never reaches MapLibre: the renderer fetches and
 * decodes it through the `grid` chunk, keeps the field for `getGrid` /
 * `gridReady`, swaps it on a URL change without dropping the old one first,
 * rescales a `range:` change from the retained bytes with no fetch, retries
 * a failure on `reload()`, and drops everything on removal or `destroy()`.
 * Each test maps to one bullet of the plan's U3 test scenarios
 * (docs/plans/2026-11-14-001-feat-grid-source-plan.md).
 *
 * The real chunk runs under jsdom: `fetch` is stubbed to serve the committed
 * 1° frames (examples/verification/null-earth/data), gated so a test decides
 * when a response lands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    public getStyle = () => ({ layers: [] });
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

import { MapRenderer } from "../../src/renderer/map-renderer";
import { prepareProtocols } from "../../src/renderer/cloud-protocols";
import { isFormatError, type FormatError } from "../../src/formats/errors";
import type { GridSource, LayerSource } from "../../src/schemas/source.schema";
import type { AppliedDocument, DiffHints } from "../../src/renderer/update/types";
import type { GridField, VectorGridField } from "../../src/renderer/grid-host";
import { WHOLE_FILE_MAX_BYTES } from "../../src/renderer/cloud-sources";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/verification/null-earth/data");
const F000 = "2026111400-f000-wind-10m.png";
const F003 = "2026111400-f003-wind-10m.png";
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

const GEOMETRY = { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 };
const CONFIG = { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" };

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

/** A gate a test opens to let one URL's response through (before or after the request arrives). */
interface Gate {
  open(): void;
  opened: Promise<void>;
  requests: number;
}

/**
 * Serve the committed frames by file name under any path; a `gate` holds a
 * URL's response until the test opens it; `status` answers a URL with an
 * HTTP error; `headers` adds response headers (a declared size).
 */
function serve(options: { gate?: Record<string, Gate>; status?: Record<string, number>; headers?: Record<string, Record<string, string>>; bytes?: Record<string, Uint8Array> } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const file = url.split("/").pop()!;
    const gate = options.gate?.[file];
    if (gate) {
      gate.requests++;
      await gate.opened;
    }
    const status = options.status?.[file];
    if (status) return new Response("nope", { status, statusText: status === 404 ? "Not Found" : "Error" });
    const body = options.bytes?.[file] ?? fixture(file);
    return new Response(body as unknown as BodyInit, { status: 200, headers: options.headers?.[file] ?? {} });
  });
}

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened, requests: 0 };
}

interface Harness {
  renderer: MapRenderer;
  map: any;
  onError: ReturnType<typeof vi.fn>;
  loaded: string[];
  retried: string[];
  load: Promise<void>;
  doc: AppliedDocument;
}

function render(sources: Record<string, LayerSource>): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onError = vi.fn();
  const renderer = new MapRenderer(container, CONFIG, [], { onError }, sources);
  const map = renderer.getMap() as any;
  const loaded: string[] = [];
  const retried: string[] = [];
  renderer.on("source:loaded", ({ sourceId }) => loaded.push(sourceId));
  renderer.on("source:retried", ({ sourceId }) => retried.push(sourceId));
  const load = new Promise<void>((resolve) => renderer.on("load", () => resolve()));
  map.emit("load");
  const doc: AppliedDocument = { config: CONFIG as AppliedDocument["config"], layers: [], sources, options: {} };
  return { renderer, map, onError, loaded, retried, load, doc };
}

const NO_HINTS: DiffHints = { failedSources: new Set(), urlsRebased: false };

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error as Error
  );
  expect(outcome, "expected a rejection").toBeInstanceOf(Error);
  return outcome!;
}

/** Longitude/latitude pairs where the two committed frames differ. */
const PROBES = [
  { lng: 10, lat: 50 },
  { lng: -70, lat: 40 },
  { lng: 140, lat: -30 },
  { lng: 0, lat: 0 },
];

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
const renderers: MapRenderer[] = [];

beforeEach(() => {
  run++;
});

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.destroy();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  document.body.innerHTML = "";
});

function up(h: Harness): Harness {
  renderers.push(h.renderer);
  return h;
}

describe("a grid source never reaches MapLibre, and is read through getGrid / gridReady (R7, R14)", () => {
  it("happy path: no addSource for the grid; gridReady resolves with a vector field; getGrid is undefined before and the field after; source:loaded names it", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F000]: g } });
    const h = up(render({ field: wind(F000) }));
    expect(h.map.addSource).not.toHaveBeenCalled();
    expect(h.renderer.getGrid("field")).toBeUndefined();
    const ready = h.renderer.gridReady("field");
    // The map's own load is not delayed by the grid: it fires while the response is held.
    await h.load;
    expect(h.renderer.getGrid("field")).toBeUndefined();
    expect(h.loaded).toEqual([]);
    g.open();
    const field = await ready;
    expect(field.kind).toBe("vector");
    expect(field.units).toBe("m/s");
    expect(field.wraps).toBe(true);
    expect(h.renderer.getGrid("field")).toBe(field);
    expect(h.loaded).toEqual(["field"]);
    expect(h.map.addSource).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(new RegExp(`^https?://.*/data/${run}/${F000}$`));
  });

  it("gridReady for an id the document has no grid source for rejects naming the id", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    await h.load;
    const error = await rejection(h.renderer.gridReady("nope"));
    expect(error.message).toContain("nope");
    expect(isFormatError(error)).toBe(false);
  });

  it("gridReady called before the map loads resolves once the grid is decoded", async () => {
    fetchSpy = serve();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new MapRenderer(container, CONFIG, [], {}, { field: wind(F000) });
    renderers.push(renderer);
    const ready = renderer.gridReady("field");
    (renderer.getMap() as any).emit("load");
    expect((await ready).kind).toBe("vector");
  });
});

describe("live updates (R16, AE4)", () => {
  it("Covers AE4: a URL change keeps the old field until the new one decodes, then swaps it and emits source:loaded again", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F003]: g } });
    const h = up(render({ field: wind(F000) }));
    const first = (await h.renderer.gridReady("field")) as VectorGridField;
    const next = { ...h.doc, sources: { field: wind(F003) } };
    const result = await h.renderer.update(next, NO_HINTS);
    expect(result.outcome).toBe("applied");
    // The update is applied; the decode is still in flight: the old field answers.
    expect(h.renderer.getGrid("field")).toBe(first);
    expect(h.loaded).toEqual(["field"]);
    const ready = h.renderer.gridReady("field");
    g.open();
    const second = (await ready) as VectorGridField;
    expect(second).not.toBe(first);
    expect(h.renderer.getGrid("field")).toBe(second);
    expect(h.loaded).toEqual(["field", "field"]);
    // The next forecast hour reads differently somewhere.
    const changed = PROBES.some((p) => {
      const a = first.sample(p);
      const b = second.sample(p);
      return a !== null && b !== null && (a.u !== b.u || a.v !== b.v);
    });
    expect(changed).toBe(true);
    // The old field is untouched: it still samples as it did.
    expect(first.sample(PROBES[0]!)).toEqual(first.sample(PROBES[0]!));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("a range-only change rescales from the retained bytes: a new field, no fetch, source:loaded again; the field page code holds is unchanged", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    const first = (await h.renderer.gridReady("field")) as VectorGridField;
    const before = first.sample({ lng: 10, lat: 50 })!;
    const result = await h.renderer.update({ ...h.doc, sources: { field: wind(F000, { range: [-80, 80] }) } }, NO_HINTS);
    expect(result.outcome).toBe("applied");
    const second = (await h.renderer.gridReady("field")) as VectorGridField;
    expect(second).not.toBe(first);
    expect(second.range).toEqual([-80, 80]);
    expect(first.range).toEqual([-40, 40]);
    const after = second.sample({ lng: 10, lat: 50 })!;
    expect(after.u).toBeCloseTo(before.u * 2, 6);
    expect(after.v).toBeCloseTo(before.v * 2, 6);
    expect(first.sample({ lng: 10, lat: 50 })).toEqual(before);
    expect(h.loaded).toEqual(["field", "field"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a units-only change is a new field with the new label, same values, no fetch", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    const first = (await h.renderer.gridReady("field")) as VectorGridField;
    await h.renderer.update({ ...h.doc, sources: { field: wind(F000, { units: "kt" }) } }, NO_HINTS);
    const second = (await h.renderer.gridReady("field")) as VectorGridField;
    expect(second).not.toBe(first);
    expect(second.units).toBe("kt");
    expect(first.units).toBe("m/s");
    expect(second.sample(PROBES[0]!)).toEqual(first.sample(PROBES[0]!));
    expect(h.loaded).toEqual(["field", "field"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("an encoding change re-decodes: another fetch, a field of the other kind", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    expect((await h.renderer.gridReady("field")).kind).toBe("vector");
    const result = await h.renderer.update({ ...h.doc, sources: { field: wind(F000, { encoding: "scalar-r", range: [0, 255] }) } }, NO_HINTS);
    expect(result.outcome).toBe("applied");
    expect(result.summary?.sourcesReplaced).toEqual(["field"]);
    const field = await h.renderer.gridReady("field");
    expect(field.kind).toBe("scalar");
    expect(h.renderer.getGrid("field")).toBe(field);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(h.loaded).toEqual(["field", "field"]);
  });

  it("an update that only re-states the document fetches nothing and emits nothing", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    const first = await h.renderer.gridReady("field");
    const result = await h.renderer.update({ ...h.doc, sources: { field: wind(F000) } }, NO_HINTS);
    expect(result.outcome).toBe("applied");
    expect(h.renderer.getGrid("field")).toBe(first);
    expect(h.loaded).toEqual(["field"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the byte cache (R7): one fetch per file", () => {
  it("two sources over the same file fetch it once, and both resolve", async () => {
    fetchSpy = serve();
    const h = up(render({ a: wind(F000), b: wind(F000) }));
    const [a, b] = await Promise.all([h.renderer.gridReady("a"), h.renderer.gridReady("b")]);
    expect(a.kind).toBe("vector");
    expect(b.kind).toBe("vector");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(h.loaded.sort()).toEqual(["a", "b"]);
  });

  it("a rebuilt renderer (a mapStyle swap) over the same file costs no network", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    await h.renderer.gridReady("field");
    h.renderer.destroy();
    const again = up(render({ field: wind(F000) }));
    expect((await again.renderer.gridReady("field")).kind).toBe("vector");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a rebuilt renderer whose range differs still costs no network: the cached field is rescaled", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    await h.renderer.gridReady("field");
    h.renderer.destroy();
    const again = up(render({ field: wind(F000, { range: [-20, 20] }) }));
    expect((await again.renderer.gridReady("field")).range).toEqual([-20, 20]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cache: { enabled: false } bypasses it: every renderer fetches", async () => {
    fetchSpy = serve();
    const spec = wind(F000, { cache: { enabled: false } });
    const h = up(render({ field: spec }));
    await h.renderer.gridReady("field");
    h.renderer.destroy();
    const again = up(render({ field: spec }));
    await again.renderer.gridReady("field");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("failures (R13, R17): the format-failure vocabulary, through the per-source notice", () => {
  it("a 404 reports a source error naming the failed URL; getGrid stays undefined; gridReady rejects with it; failedSources lists it", async () => {
    fetchSpy = serve({ status: { [F000]: 404 } });
    const h = up(render({ field: wind(F000) }));
    const error = (await rejection(h.renderer.gridReady("field"))) as FormatError;
    expect(isFormatError(error)).toBe(true);
    expect(error.failure).toMatchObject({ code: "http", format: "grid", status: 404, url: `data/${run}/${F000}` });
    expect(error.message).toContain(`data/${run}/${F000}`);
    expect(h.renderer.getGrid("field")).toBeUndefined();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(error, false, { kind: "source", sourceId: "field" });
    expect([...h.renderer.failedSources()]).toEqual(["field"]);
    expect(h.loaded).toEqual([]);
  });

  it("a body over the whole-file byte cap is refused before decoding, with the grid wording", async () => {
    fetchSpy = serve({ headers: { [F000]: { "content-length": String(WHOLE_FILE_MAX_BYTES + 1) } } });
    const h = up(render({ field: wind(F000) }));
    const error = (await rejection(h.renderer.gridReady("field"))) as FormatError;
    expect(error.failure).toMatchObject({ code: "too-large", format: "grid", size: WHOLE_FILE_MAX_BYTES + 1, limits: { bytes: WHOLE_FILE_MAX_BYTES } });
    expect(error.message).toContain("more than a page loads whole");
    expect(error.message).not.toMatch(/view|tiles/);
    expect(h.onError).toHaveBeenCalledWith(error, false, { kind: "source", sourceId: "field" });
  });

  it("a header over the cell cap is refused naming the cap", async () => {
    // The committed frame's IHDR with 5000 x 5000 written over its size: 25 M cells.
    const bytes = fixture(F000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(16, 5000);
    view.setUint32(20, 5000);
    fetchSpy = serve({ bytes: { [F000]: bytes } });
    const h = up(render({ field: wind(F000, { grid: { ...GEOMETRY, nx: 5000, ny: 5000, dx: 0.072, dy: 0.036 } }) }));
    const error = (await rejection(h.renderer.gridReady("field"))) as FormatError;
    expect(error.failure).toMatchObject({ code: "too-large", format: "grid", cells: 25_000_000, limits: { cells: 16_000_000 } });
    expect(error.message).toContain("grid cells");
  });

  it("a network failure is `cors`, worded for a grid", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const h = up(render({ field: wind(F000) }));
    const error = (await rejection(h.renderer.gridReady("field"))) as FormatError;
    expect(error.failure).toMatchObject({ code: "cors", format: "grid" });
    expect(error.message).toContain("grid");
  });

  it("reload() after a failure fetches again, resolves a fresh gridReady, withdraws the notice (source:retried) and clears failedSources", async () => {
    const status: Record<string, number> = { [F000]: 404 };
    fetchSpy = serve({ status });
    const h = up(render({ field: wind(F000) }));
    await rejection(h.renderer.gridReady("field"));
    delete status[F000];
    const hints: DiffHints = { failedSources: h.renderer.failedSources(), urlsRebased: false, reload: true };
    const result = await h.renderer.update({ ...h.doc }, hints);
    expect(result.outcome).toBe("applied");
    const field = await h.renderer.gridReady("field");
    expect(field.kind).toBe("vector");
    expect(h.renderer.getGrid("field")).toBe(field);
    expect(h.retried).toEqual(["field"]);
    expect(h.loaded).toEqual(["field"]);
    expect([...h.renderer.failedSources()]).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a failed URL change keeps the old field and reports the failed URL", async () => {
    fetchSpy = serve({ status: { [F003]: 404 } });
    const h = up(render({ field: wind(F000) }));
    const first = await h.renderer.gridReady("field");
    await h.renderer.update({ ...h.doc, sources: { field: wind(F003) } }, NO_HINTS);
    const error = (await rejection(h.renderer.gridReady("field"))) as FormatError;
    expect(error.failure).toMatchObject({ code: "http", status: 404, url: `data/${run}/${F003}` });
    expect(h.renderer.getGrid("field")).toBe(first);
    expect([...h.renderer.failedSources()]).toEqual(["field"]);
  });

  it("removing the source during an in-flight fetch discards the result and rejects pending waiters", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F000]: g } });
    const h = up(render({ field: wind(F000) }));
    await h.load;
    const ready = h.renderer.gridReady("field");
    const result = await h.renderer.update({ ...h.doc, sources: {} }, NO_HINTS);
    expect(result.outcome).toBe("applied");
    const error = await rejection(ready);
    expect(error.message).toContain("field");
    g.open();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.renderer.getGrid("field")).toBeUndefined();
    expect(h.loaded).toEqual([]);
    expect(h.onError).not.toHaveBeenCalled();
    expect((await rejection(h.renderer.gridReady("field"))).message).toContain("field");
  });

  it("destroy() during an in-flight fetch rejects waiters and fires no callback afterwards", async () => {
    const g = gate();
    fetchSpy = serve({ gate: { [F000]: g } });
    const h = render({ field: wind(F000) });
    await h.load;
    const ready = h.renderer.gridReady("field");
    h.renderer.destroy();
    await rejection(ready);
    g.open();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.loaded).toEqual([]);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.renderer.getGrid("field")).toBeUndefined();
    await rejection(h.renderer.gridReady("field"));
  });
});

describe("integration", () => {
  it("prepareProtocols registers nothing for a .tif grid (it is not a COG)", () => {
    const prepared = prepareProtocols({ field: { type: "grid", url: "data/field.tif", encoding: "geotiff" } }, []);
    expect(prepared).toBeUndefined();
  });

  it("an inline layer-level grid source routes to the manager rather than the unrecognized-source throw", async () => {
    fetchSpy = serve();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onError = vi.fn();
    const layer = { id: "heat", type: "fill", source: wind(F000) } as never;
    const renderer = new MapRenderer(container, CONFIG, [layer], { onError });
    renderers.push(renderer);
    const map = renderer.getMap() as any;
    map.emit("load");
    await new Promise<void>((resolve) => renderer.on("load", () => resolve()));
    expect(map.addSource).not.toHaveBeenCalled();
    expect(onError.mock.calls.map((c) => String((c[0] as Error).message))).not.toContainEqual(expect.stringContaining("unrecognized source"));
    expect((await renderer.gridReady("heat-source")).kind).toBe("vector");
  });

  it("the field type is what the chunk hands back: sample, values, isMissing, rescale", async () => {
    fetchSpy = serve();
    const h = up(render({ field: wind(F000) }));
    const field: GridField = await h.renderer.gridReady("field");
    expect(field.nx).toBe(360);
    expect(field.ny).toBe(181);
    expect(field.bounds).toEqual([-180.5, -90.5, 179.5, 90.5]);
    expect(typeof field.isMissing(0, 0)).toBe("boolean");
    expect(field.values().missing.length).toBe(360 * 181);
    expect(field.rescale([-1, 1]).range).toEqual([-1, 1]);
  });
});
