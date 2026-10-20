/**
 * `fitTo` on a `url:` source (ml-aot.75): `<ml-map>` starts fetching the
 * data before it builds the map, and builds it already framed — the data
 * rides in as the source's `prefetchedData`. Past `fitToWaitMs` the map is
 * built at the authored camera and the renderer is handed the load still in
 * flight (one request). Documents without such a `fitTo` are untouched:
 * still built synchronously.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

interface Built {
  config: any;
  options: any;
  sources: any;
}
const built: Built[] = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, config, _layers, options, sources) => {
    built.push({ config, options, sources });
    return {
      getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      destroy: vi.fn(),
      isMapLoaded: vi.fn(() => false),
      on: vi.fn(),
    };
  }),
}));

import { MLMap } from "../../src/components/ml-map";

const PARKS = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-73.97, 40.66] } }],
};

const doc = (source: Record<string, unknown>, fitTo: Record<string, unknown> | null = { source: "parks" }) => ({
  type: "map",
  id: "m",
  config: {
    center: [0, 0],
    zoom: 1,
    mapStyle: "https://example.com/style.json",
    ...(fitTo ? { fitTo } : {}),
  },
  sources: { parks: { type: "geojson", ...source } },
  layers: [{ id: "parks", type: "fill", source: "parks" }],
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** A fetch that answers `parks.geojson` after `delay` ms, counting calls. */
function stubFetch(delay: number, status = 200) {
  const calls: string[] = [];
  const fetch = vi.fn((url: string) => {
    calls.push(String(url));
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: status === 200,
            status,
            statusText: status === 200 ? "OK" : "Not Found",
            headers: { get: () => "application/geo+json" },
            text: async () => JSON.stringify(PARKS),
          }),
        delay
      )
    );
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

function mount(config: unknown, attrs: Record<string, string> = {}): MLMap {
  const el = document.createElement("ml-map") as MLMap;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute("config", JSON.stringify(config));
  document.body.appendChild(el);
  return el;
}

describe("fitTo on a url: source is framed on load (ml-aot.75)", () => {
  const wait = MLMap.fitToWaitMs;
  beforeEach(() => {
    document.body.innerHTML = "";
    built.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  });
  afterEach(() => {
    MLMap.fitToWaitMs = wait;
    vi.unstubAllGlobals();
  });

  it("waits for the data, then builds the map with it as prefetchedData (one request)", async () => {
    const calls = stubFetch(30);
    mount(doc({ url: "data/parks.geojson" }));
    await tick(5);
    expect(built).toHaveLength(0); // still waiting for the data
    expect(calls).toHaveLength(1);
    await tick(80);
    expect(built).toHaveLength(1);
    const { sources, options } = built[0]!;
    expect(sources.parks.prefetchedData).toEqual(PARKS);
    expect(options.sourceData.pending.parks).toBeInstanceOf(Promise);
    expect(calls).toHaveLength(1);
  });

  it("resolves the url against base before fetching", async () => {
    const calls = stubFetch(5);
    mount(doc({ url: "/data/parks.geojson" }), { base: "/my-repo/" });
    await tick(60);
    expect(calls).toEqual(["/my-repo/data/parks.geojson"]);
    expect(built[0]!.sources.parks.url).toBe("/my-repo/data/parks.geojson");
  });

  it("past fitToWaitMs: built at the authored camera, handed the load still in flight", async () => {
    MLMap.fitToWaitMs = 20;
    const calls = stubFetch(200);
    mount(doc({ url: "data/parks.geojson" }));
    await tick(60);
    expect(built).toHaveLength(1);
    const { sources, options } = built[0]!;
    expect(sources.parks.prefetchedData).toBeUndefined();
    await expect(options.sourceData.pending.parks).resolves.toEqual(PARKS);
    expect(calls).toHaveLength(1);
  });

  it("a failed fetch is built at once and handed over, so the data notice reports it", async () => {
    stubFetch(5, 404);
    mount(doc({ url: "data/parks.geojson" }));
    await tick(60);
    expect(built).toHaveLength(1);
    expect(built[0]!.sources.parks.prefetchedData).toBeUndefined();
    await expect(built[0]!.options.sourceData.pending.parks).rejects.toThrow(/HTTP 404/);
  });

  it("no prefetch, and the same synchronous build, without such a fitTo", () => {
    const calls = stubFetch(5);
    for (const config of [
      doc({ url: "data/parks.geojson" }, null), // no fitTo
      doc({ data: PARKS }), // inline data: framed at construction already
      doc({ url: "data/parks.geojson", stream: { type: "sse", url: "/s" } } as never), // a stream
    ]) {
      built.length = 0;
      mount(config);
      expect(built).toHaveLength(1);
      expect(built[0]!.options.sourceData).toBeUndefined();
    }
    expect(calls).toEqual([]);
  });

  it("fitToWaitMs = 0 turns the prefetch off", () => {
    MLMap.fitToWaitMs = 0;
    const calls = stubFetch(5);
    mount(doc({ url: "data/parks.geojson" }));
    expect(built).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("an element removed while waiting never builds a map", async () => {
    stubFetch(30);
    const el = mount(doc({ url: "data/parks.geojson" }));
    await tick(5);
    el.remove();
    await tick(80);
    expect(built).toHaveLength(0);
  });
});
