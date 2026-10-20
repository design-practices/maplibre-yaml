/**
 * Cloud-native sources at render time (0.9, ml-cnv): the PMTiles protocol is
 * registered once on the renderer's maplibre module (the page's own
 * registration wins), source URLs reach MapLibre in canonical form, our keys
 * never do, and a reserved format becomes a plain "not yet" instead of a
 * MapLibre error.
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

  it("does nothing for a document without PMTiles", () => {
    expect(prepareProtocols({ a: { type: "geojson", url: "a.fgb" } }, [])).toBeUndefined();
    expect(registry()["pmtiles"]).toBeUndefined();
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

  it("keeps a handler the page registered first (host wins)", async () => {
    const host = async () => ({ data: {} });
    maplibregl.addProtocol("pmtiles", host as never);
    await prepareProtocols({ a: { type: "vector", url: "a.pmtiles" } }, []);
    expect(registry()["pmtiles"]).toBe(host);
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

  it("a COG (reserved) becomes an empty placeholder plus a plain 'not yet'", () => {
    const { spec, problem } = toMapLibreTileSpec({ type: "raster", url: "data/scene.tif" });
    expect(spec["type"]).toBe("raster");
    expect(spec["url"]).toBeUndefined();
    expect(problem?.failure).toMatchObject({ code: "unsupported", format: "cog", url: "data/scene.tif" });
  });

  it("a COG uses the page's own cog:// protocol when one is registered", () => {
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

  it("a reserved format is reported once and added as a placeholder (layers still add)", () => {
    const manager = new LayerManager(map, callbacks);
    manager.registerSources({ scene: { type: "raster", url: "https://h.org/scene.tif" } });
    expect(callbacks.onSourceError).toHaveBeenCalledTimes(1);
    expect(callbacks.onSourceError.mock.calls[0][0]).toBe("scene");
    expect(map.addSource).toHaveBeenCalledWith("scene", expect.objectContaining({ type: "raster" }));
  });

  it("asks the injected predicate whether the page registered cog:// (no maplibre-gl import of its own)", () => {
    const manager = new LayerManager(map, callbacks, { isProtocolRegistered: (s) => s === "cog" });
    manager.registerSources({ scene: { type: "raster", url: "https://h.org/scene.tif" } });
    expect(callbacks.onSourceError).not.toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith("scene", { type: "raster", url: "cog://https://h.org/scene.tif" });
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
