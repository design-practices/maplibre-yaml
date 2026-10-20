/**
 * Cloud-native sources at render time (0.9, ml-cnv): the PMTiles protocol is
 * registered once on the renderer's maplibre module (the page's own
 * registration wins), source URLs reach MapLibre in canonical form, our keys
 * never do (COG: `cog://`, `#dem`, `#color:`, tileSize 256), and a reserved
 * format becomes a plain "not yet" instead of a MapLibre error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A stand-in maplibre-gl module with a real protocol registry (the parts
// core reads: `config.REGISTERED_PROTOCOLS`, `addProtocol`, `removeProtocol`,
// `getVersion`). Not the real package: on the CI matrix's 4.x/5.x legs that
// is the UMD bundle, which calls URL.createObjectURL at import time (absent
// in jsdom) — and these tests are about what core does with the module, not
// about MapLibre.
vi.mock("maplibre-gl", () => {
  const REGISTERED_PROTOCOLS: Record<string, unknown> = {};
  const gl = {
    config: { REGISTERED_PROTOCOLS },
    addProtocol: (name: string, fn: unknown) => {
      REGISTERED_PROTOCOLS[name] = fn;
    },
    removeProtocol: (name: string) => {
      delete REGISTERED_PROTOCOLS[name];
    },
    getVersion: () => "6.12.0",
  };
  return { default: gl, ...gl };
});

import { install } from "../../src/formats/pmtiles";
import { toMapLibreTileSpec, withoutFormatKeys } from "../../src/renderer/cloud-sources";
import { isProtocolRegistered, prepareProtocols } from "../../src/renderer/cloud-protocols";
import { maplibregl, removeProtocol } from "../../src/renderer/maplibre-interop";
import { LayerManager } from "../../src/renderer/layer-manager";
import { isFormatError } from "../../src/formats/errors";

const registry = () =>
  (maplibregl as unknown as { config: { REGISTERED_PROTOCOLS: Record<string, unknown> } }).config
    .REGISTERED_PROTOCOLS;

describe("pmtiles install()", () => {
  it("registers once, and leaves a page's own handler alone", () => {
    const REGISTERED_PROTOCOLS: Record<string, unknown> = {};
    const addProtocol = vi.fn((name: string, fn: unknown) => (REGISTERED_PROTOCOLS[name] = fn));
    const module = {};
    expect(install({ addProtocol, config: { REGISTERED_PROTOCOLS }, module })).toBe("installed");
    expect(addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
    expect(install({ addProtocol, config: { REGISTERED_PROTOCOLS }, module })).toBe("already");
    expect(addProtocol).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    expect(
      install({ addProtocol: other, config: { REGISTERED_PROTOCOLS: { pmtiles: () => {} } }, module: {} })
    ).toBe("host");
    expect(other).not.toHaveBeenCalled();
  });

  it("refuses maplibre-gl 3 (its protocol API can't run the handler), in words", () => {
    let error: unknown;
    try {
      install({ addProtocol: vi.fn(), config: { REGISTERED_PROTOCOLS: {} }, version: "3.6.2", module: {} });
    } catch (e) {
      error = e;
    }
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "decoder" });
    expect((error as Error).message).toContain("it needs maplibre-gl 4 or later; this page runs 3.6.2");
  });

  it("classifies what the archive reader throws", async () => {
    const addProtocol = vi.fn();
    install({ addProtocol, config: { REGISTERED_PROTOCOLS: {} }, module: {} });
    const handler = addProtocol.mock.calls[0]![1] as (
      p: { url: string; type: string },
      a: AbortController
    ) => Promise<unknown>;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404, statusText: "Not Found" }));
    // MapLibre's TileJSON request for the archive.
    const error = await handler({ url: "pmtiles://http://h.org/x.pmtiles", type: "json" }, new AbortController()).catch(
      (e) => e
    );
    fetchSpy.mockRestore();
    expect(isFormatError(error) && error.failure).toMatchObject({
      code: "http",
      status: 404,
      url: "http://h.org/x.pmtiles",
    });
    expect(error.message).toBe("`http://h.org/x.pmtiles` didn't load (404 Not Found).");
  });
});

describe("prepareProtocols (on the interop-resolved module)", () => {
  afterEach(() => {
    if (registry()["pmtiles"]) removeProtocol("pmtiles");
  });

  it("registers pmtiles synchronously for every document, so a basemap style can use it (ml-aot.87)", () => {
    // Nothing for the document's own sources to wait on…
    expect(prepareProtocols({ a: { type: "geojson", url: "a.fgb" } }, [])).toBeUndefined();
    // …and the protocol is already there, before any map is constructed.
    expect(typeof registry()["pmtiles"]).toBe("function");
  });

  it("registers pmtiles for a named, inline, or inline-basemap source", async () => {
    for (const [sources, layers, style] of [
      [{ a: { type: "vector", url: "a.pmtiles" } }, [], undefined],
      [{}, [{ id: "x", source: { type: "raster", url: "pmtiles://x" } }], undefined],
      [{}, [], { version: 8, sources: { b: { type: "vector", url: "pmtiles://b.pmtiles" } }, layers: [] }],
    ] as const) {
      const failed = await prepareProtocols(sources, layers, style);
      expect(failed?.size).toBe(0);
      expect(typeof registry()["pmtiles"]).toBe("function");
      removeProtocol("pmtiles");
    }
  });

  it("a reader that can't be downloaded fails only the document's PMTiles sources, after registering (ml-7qa.5)", async () => {
    vi.resetModules();
    vi.doMock("pmtiles", () => {
      throw new TypeError("Failed to fetch dynamically imported module: http://h.org/dist/chunks/pmtiles.js");
    });
    try {
      const fresh = await import("../../src/renderer/cloud-protocols");
      const interop = await import("../../src/renderer/maplibre-interop");
      const registered = () =>
        (interop.maplibregl as unknown as { config: { REGISTERED_PROTOCOLS: Record<string, unknown> } }).config
          .REGISTERED_PROTOCOLS;
      // A document without PMTiles sources waits on nothing (the basemap's
      // own requests would report through the handler)…
      expect(fresh.prepareProtocols({ a: { type: "geojson", url: "a.geojson" } }, [])).toBeUndefined();
      expect(typeof registered()["pmtiles"]).toBe("function");
      // …one with them gets the failure to report on those sources.
      const failed = await fresh.prepareProtocols({ a: { type: "vector", url: "a.pmtiles" } }, []);
      const error = failed?.get("pmtiles");
      expect(isFormatError(error) && error.failure).toMatchObject({
        code: "chunk",
        url: "http://h.org/dist/chunks/pmtiles.js",
      });
      interop.removeProtocol("pmtiles");
    } finally {
      vi.doUnmock("pmtiles");
      vi.resetModules();
    }
  });

  it("keeps a handler the page registered first (host wins)", async () => {
    const host = async () => ({ data: {} });
    maplibregl.addProtocol("pmtiles", host as never);
    await prepareProtocols({ a: { type: "vector", url: "a.pmtiles" } }, []);
    expect(registry()["pmtiles"]).toBe(host);
  });

  it("registers cog:// synchronously too, and a COG source waits on it (ml-cnv.2)", async () => {
    if (registry()["cog"]) removeProtocol("cog");
    expect(prepareProtocols({}, [])).toBeUndefined();
    expect(typeof registry()["cog"]).toBe("function");
    const failed = await prepareProtocols({ e: { type: "raster-dem", url: "e.tif" } }, []);
    expect(failed?.size).toBe(0);
    removeProtocol("cog");
  });

  it("keeps a cog handler the page registered first (host wins)", async () => {
    const host = async () => ({ data: {} });
    maplibregl.addProtocol("cog", host as never);
    await prepareProtocols({ a: { type: "raster", url: "a.tif" } }, []);
    expect(registry()["cog"]).toBe(host);
    removeProtocol("cog");
  });
});

describe("toMapLibreTileSpec", () => {
  it("canonicalizes a PMTiles URL to pmtiles://<absolute> and drops our keys", () => {
    const { spec, problem } = toMapLibreTileSpec({ type: "vector", url: "data/a.pmtiles", format: "pmtiles", load: "all" });
    expect(problem).toBeUndefined();
    expect(spec).toEqual({ type: "vector", url: `pmtiles://${new URL("data/a.pmtiles", document.baseURI).href}` });
  });

  it("absolutizes the file inside a pmtiles:// URL; keeps an absolute one", () => {
    expect(toMapLibreTileSpec({ type: "raster", url: "pmtiles:///x/a.pmtiles", tileSize: 256 }).spec.url).toBe(
      `pmtiles://${new URL("/x/a.pmtiles", document.baseURI).href}`
    );
    expect(toMapLibreTileSpec({ type: "raster", url: "pmtiles://https://h.org/a.pmtiles" }).spec.url).toBe(
      "pmtiles://https://h.org/a.pmtiles"
    );
  });

  it("format: pmtiles on an extensionless URL", () => {
    expect(toMapLibreTileSpec({ type: "vector", url: "https://h.org/tiles?k=1", format: "pmtiles" }).spec).toEqual({
      type: "vector",
      url: "pmtiles://https://h.org/tiles?k=1",
    });
  });

  it("leaves an ordinary TileJSON source alone", () => {
    const source = { type: "vector", url: "https://h.org/tiles.json" };
    expect(toMapLibreTileSpec(source).spec).toBe(source);
  });

  it("a COG becomes cog://<absolute> with tileSize 256 (ml-cnv.2)", () => {
    const { spec, problem } = toMapLibreTileSpec({ type: "raster", url: "data/scene.tif", tileSize: 512 });
    expect(problem).toBeUndefined();
    // An authored tileSize is kept (the parser turns an unwritten one into 256).
    expect(spec).toEqual({ type: "raster", url: `cog://${new URL("data/scene.tif", document.baseURI).href}`, tileSize: 512 });
    expect(toMapLibreTileSpec({ type: "raster", url: "cog://https://h.org/s.tif" }).spec).toEqual({
      type: "raster",
      url: "cog://https://h.org/s.tif",
      tileSize: 256,
    });
  });

  it("a COG raster-dem gets #dem and mapbox encoding; colorRamp becomes #color: and leaves the spec", () => {
    expect(
      toMapLibreTileSpec({ type: "raster-dem", url: "https://h.org/e.tif", encoding: "terrarium" }).spec
    ).toEqual({ type: "raster-dem", url: "cog://https://h.org/e.tif#dem", tileSize: 256, encoding: "mapbox" });
    expect(
      toMapLibreTileSpec({
        type: "raster",
        url: "https://h.org/n.tif",
        colorRamp: { colors: ["#000000", "#ffffff"], min: 0, max: 1 },
      }).spec
    ).toEqual({ type: "raster", url: 'cog://https://h.org/n.tif#color:["#000000","#ffffff"],0,1,c', tileSize: 256 });
  });

  it("a page's own cog:// URL is kept as written", () => {
    maplibregl.addProtocol("cog", (async () => ({ data: {} })) as never);
    try {
      expect(isProtocolRegistered("cog")).toBe(true);
      const { spec, problem } = toMapLibreTileSpec(
        { type: "raster", url: "cog://https://h.org/s.tif" },
        isProtocolRegistered
      );
      expect(problem).toBeUndefined();
      expect(spec["url"]).toBe("cog://https://h.org/s.tif");
    } finally {
      removeProtocol("cog");
    }
  });

  it("withoutFormatKeys returns the same object when there is nothing to strip", () => {
    const spec = { type: "geojson" };
    expect(withoutFormatKeys(spec)).toBe(spec);
    expect(withoutFormatKeys({ type: "geojson", format: "flatgeobuf", load: "all" })).toEqual({ type: "geojson" });
  });
});

describe("LayerManager with cloud-native sources", () => {
  let map: any;
  let callbacks: any;
  beforeEach(() => {
    map = {
      addSource: vi.fn(),
      getSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn(), onSourceError: vi.fn() };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("named PMTiles sources reach MapLibre canonical, without format:", () => {
    const manager = new LayerManager(map, callbacks);
    manager.registerSources({
      tiles: { type: "vector", url: "https://h.org/a.pmtiles", format: "pmtiles" },
      dem: { type: "raster-dem", url: "https://h.org/t.pmtiles", encoding: "terrarium" },
    });
    expect(map.addSource).toHaveBeenCalledWith("tiles", { type: "vector", url: "pmtiles://https://h.org/a.pmtiles" });
    expect(map.addSource).toHaveBeenCalledWith("dem", {
      type: "raster-dem",
      url: "pmtiles://https://h.org/t.pmtiles",
      encoding: "terrarium",
    });
  });

  it("an inline PMTiles source too", async () => {
    const manager = new LayerManager(map, callbacks);
    await manager.addLayer({
      id: "x",
      type: "fill",
      source: { type: "vector", url: "https://h.org/a.pmtiles" },
      "source-layer": "d",
    } as never);
    expect(map.addSource).toHaveBeenCalledWith("x-source", { type: "vector", url: "pmtiles://https://h.org/a.pmtiles" });
  });

  it("a COG source is added in canonical form, never as an error (ml-cnv.2)", () => {
    const manager = new LayerManager(map, callbacks);
    manager.registerSources({ scene: { type: "raster", url: "https://h.org/scene.tif", tileSize: 256 } });
    expect(callbacks.onSourceError).not.toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith("scene", {
      type: "raster",
      url: "cog://https://h.org/scene.tif",
      tileSize: 256,
    });
  });

  it("an inline COG raster-dem source too", async () => {
    const manager = new LayerManager(map, callbacks);
    await manager.addLayer({
      id: "hills",
      type: "hillshade",
      source: { type: "raster-dem", url: "https://h.org/e.tif" },
    } as never);
    expect(map.addSource).toHaveBeenCalledWith("hills-source", {
      type: "raster-dem",
      url: "cog://https://h.org/e.tif#dem",
      tileSize: 256,
      encoding: "mapbox",
    });
  });

  it("a GeoParquet url: says 'not yet' instead of failing as 'not JSON'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const manager = new LayerManager(map, callbacks);
    manager.registerSources({ wells: { type: "geojson", url: "https://h.org/wells.parquet" } });
    await vi.waitFor(() => expect(callbacks.onDataError).toHaveBeenCalled());
    expect(callbacks.onDataError.mock.calls[0][1].failure).toMatchObject({ code: "unsupported", format: "geoparquet" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("a basemap style loaded from a URL: relative URLs resolve against the style", () => {
  it("resolves pmtiles://<relative>, TileJSON, tiles, sprite and glyphs; leaves the rest", async () => {
    const { basemapRequestTransformer } = await import("../../src/renderer/basemap-urls");
    const t = basemapRequestTransformer("https://u.github.io/my-repo/basemap/style.json");
    expect(t("pmtiles://nyc.pmtiles", "Source")).toEqual({ url: "pmtiles://https://u.github.io/my-repo/basemap/nyc.pmtiles" });
    expect(t("pmtiles://./nyc.pmtiles", "Source")).toEqual({ url: "pmtiles://https://u.github.io/my-repo/basemap/nyc.pmtiles" });
    expect(t("pmtiles://../data/a.pmtiles", "Source")).toEqual({ url: "pmtiles://https://u.github.io/my-repo/data/a.pmtiles" });
    expect(t("tiles.json", "Source")).toEqual({ url: "https://u.github.io/my-repo/basemap/tiles.json" });
    expect(t("t/{z}/{x}/{y}.pbf", "Tile")).toEqual({ url: "https://u.github.io/my-repo/basemap/t/{z}/{x}/{y}.pbf" });
    expect(t("sprites/light.json", "SpriteJSON")).toEqual({ url: "https://u.github.io/my-repo/basemap/sprites/light.json" });
    expect(t("fonts/Noto Sans/0-255.pbf", "Glyphs")?.url).toBe(
      "https://u.github.io/my-repo/basemap/fonts/Noto%20Sans/0-255.pbf"
    );
    // Absolute URLs and other resource types are left to MapLibre.
    expect(t("pmtiles://https://example.com/a.pmtiles", "Source")).toBeUndefined();
    expect(t("https://example.com/tiles.json", "Source")).toBeUndefined();
    expect(t("photo.png", "Image")).toBeUndefined();
  });

  it("a relative style URL resolves against the page first; a host transformRequest still runs", async () => {
    const { basemapRequestTransformer } = await import("../../src/renderer/basemap-urls");
    const host = vi.fn((url: string) => ({ url: `${url}?key=1` }));
    const seen: string[] = [];
    const t = basemapRequestTransformer("basemap/style.json", host, (u) => seen.push(u));
    const expected = `pmtiles://${new URL("basemap/nyc.pmtiles", document.baseURI).href}`;
    expect(t("pmtiles://nyc.pmtiles", "Source")).toEqual({ url: `${expected}?key=1` });
    expect(seen).toEqual([expected]);
  });

  it("a document's own relative tile URLs are made absolute against the page first", async () => {
    const { absolutizeSourceUrls } = await import("../../src/utils/tile-url");
    expect(absolutizeSourceUrls({ type: "vector", url: "data/tiles.json" })).toEqual({
      type: "vector",
      url: new URL("data/tiles.json", document.baseURI).href,
    });
    expect(absolutizeSourceUrls({ type: "raster", tiles: ["r/{z}/{x}/{y}.png"] }).tiles).toEqual([
      `${new URL("r/", document.baseURI).href}{z}/{x}/{y}.png`,
    ]);
    expect(absolutizeSourceUrls({ type: "vector", url: "pmtiles://https://h/a.pmtiles" }).url).toBe(
      "pmtiles://https://h/a.pmtiles"
    );
  });
});
