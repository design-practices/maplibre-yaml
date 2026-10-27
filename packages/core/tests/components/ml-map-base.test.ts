/**
 * `<ml-map base>` (ml-aot.30): on a site deployed under a subpath (a GitHub
 * Pages project site at `/my-repo/`), the element resolves its `src` and every
 * URL in the document against the base before anything is fetched. Without
 * the attribute, nothing changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

interface FakeRenderer {
  config: any;
  layers: any[];
  options: any;
  sources: any;
  addLayer: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  emit(name: string, payload?: any): void;
}
const renderers: FakeRenderer[] = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, config, layers, options, sources) => {
    const handlers = new Map<string, Array<(payload: any) => void>>();
    const fake: FakeRenderer & Record<string, unknown> = {
      config,
      layers,
      options,
      sources,
      emit(name: string, payload?: any) {
        for (const fn of handlers.get(name) ?? []) fn(payload);
      },
      addLayer: vi.fn(async () => {}),
      getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      destroy: vi.fn(),
      isMapLoaded: vi.fn(() => false),
      // Live documents (0.10): a base change is an update of the running map.
      getDocument: () => ({ config: fake.config, layers: fake.layers, sources: fake.sources ?? {}, options: fake.options }),
      update: vi.fn(async (next: any) => {
        fake.config = next.config;
        fake.layers = next.layers;
        fake.sources = next.sources;
        return { outcome: "applied", summary: { added: [], removed: [], moved: [], replaced: [], propertiesSet: [], sourcesReplaced: [], cameraMoved: false, rebuild: false, failures: [] } };
      }),
      on: vi.fn((name: string, fn: (payload: any) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      }),
    };
    renderers.push(fake);
    return fake;
  }),
}));

import { MLMap } from "../../src/components/ml-map";

const DOC = {
  type: "map",
  id: "m",
  config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
  sources: { pts: { type: "geojson", url: "/data/pts.geojson" } },
  layers: [
    { id: "inline", type: "circle", source: { type: "geojson", url: "data/inline.geojson" } },
  ],
  images: { tri: "/images/tri.png" },
  markers: [{ at: [0, 0], icon: "images/pin.png" }],
};

const YAML = `type: map
id: from-src
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      url: "/data/pts.geojson"
`;

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const latest = () => renderers[renderers.length - 1]!;

async function mount(attrs: Record<string, string> = {}): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (!("src" in attrs)) el.setAttribute("config", JSON.stringify(DOC));
  document.body.appendChild(el);
  await tick();
  return el;
}

describe("<ml-map base>", () => {
  const realFetch = globalThis.fetch;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    errorSpy.mockRestore();
  });

  it("resolves the document's sources, inline sources, images and marker icons under the base", async () => {
    await mount({ base: "/my-repo/" });
    const r = latest();
    expect(r.sources.pts.url).toBe("/my-repo/data/pts.geojson");
    expect(r.layers[0].source.url).toBe("/my-repo/data/inline.geojson");
    expect(r.options.images).toEqual({ tri: "/my-repo/images/tri.png" });
    expect(r.options.markers[0].icon).toBe("/my-repo/images/pin.png");
    // Absolute URLs are never changed.
    expect(r.config.mapStyle).toBe("https://example.com/style.json");
  });

  it("without base, the document reaches the renderer exactly as written", async () => {
    await mount();
    const r = latest();
    expect(r.sources.pts.url).toBe("/data/pts.geojson");
    expect(r.layers[0].source.url).toBe("data/inline.geojson");
    expect(r.options.images).toEqual({ tri: "/images/tri.png" });
    expect(r.options.markers[0].icon).toBe("images/pin.png");
  });

  it("the config getter still returns the document as authored", async () => {
    const el = await mount({ base: "/my-repo" });
    expect((el.config as any).sources.pts.url).toBe("/data/pts.geojson");
  });

  it("fetches src under the base, and resolves the fetched document too", async () => {
    const fetchMock = vi.fn(async () => new Response(YAML, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await mount({ src: "/configs/map.yaml", base: "/my-repo/" });
    expect(fetchMock).toHaveBeenCalledWith("/my-repo/configs/map.yaml");
    expect(latest().layers[0].source.url).toBe("/my-repo/data/pts.geojson");
  });

  it("does not double a src that already includes the base (Astro's withBase)", async () => {
    const fetchMock = vi.fn(async () => new Response(YAML, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await mount({ src: "/my-repo/configs/map.yaml", base: "/my-repo" });
    expect(fetchMock).toHaveBeenCalledWith("/my-repo/configs/map.yaml");
  });

  it("the base property reflects the attribute, and changing it re-resolves the document as an update (KTD11)", async () => {
    const el = await mount();
    expect(el.base).toBeNull();
    expect(latest().sources.pts.url).toBe("/data/pts.geojson");

    el.base = "/my-repo/";
    expect(el.getAttribute("base")).toBe("/my-repo/");
    await tick();
    // Live documents (0.10): the same map, every URL-bearing source counted as changed.
    expect(renderers).toHaveLength(1);
    expect(latest().update).toHaveBeenCalledTimes(1);
    expect(latest().update.mock.calls[0]![1]).toEqual({ failedSources: new Set(), urlsRebased: true });
    expect(latest().sources.pts.url).toBe("/my-repo/data/pts.geojson");

    // An equivalent spelling is not a change.
    el.setAttribute("base", "/my-repo");
    await tick();
    expect(latest().update).toHaveBeenCalledTimes(1);

    el.base = null;
    expect(el.hasAttribute("base")).toBe(false);
    await tick();
    expect(latest().update).toHaveBeenCalledTimes(2);
    expect(latest().sources.pts.url).toBe("/data/pts.geojson");
  });

  it("a base property set before the element connects is honoured (frameworks set properties first)", async () => {
    const map = document.createElement("ml-map") as MLMap;
    map.base = "/my-repo/";
    map.setAttribute("config", JSON.stringify(DOC));
    document.body.appendChild(map);
    await tick();
    expect(latest().sources.pts.url).toBe("/my-repo/data/pts.geojson");
  });

  it("addLayer() resolves the added layer's source", async () => {
    const el = await mount({ base: "/my-repo/" });
    await el.addLayer({ id: "x", type: "circle", source: { type: "geojson", url: "data/x.geojson" } });
    expect(latest().addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ url: "/my-repo/data/x.geojson" }) })
    );
  });
});
