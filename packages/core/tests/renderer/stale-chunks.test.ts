// @vitest-environment node
/**
 * A `chunks/` folder from another maplibre-yaml version: chunk file names
 * carry no version, so a self-hosted copy that updated only the entry (or a
 * browser serving a cached chunk beside a fresh entry) hands core a reader
 * chunk without the adapter core expects (a 0.9 `chunks/flatgeobuf.js` is
 * the bare library: no `useHost`). That is the seam's plain `chunk` notice —
 * "copy the whole `dist/`" — on the affected source, not a minified
 * "useHost is not a function".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("maplibre-gl", () => {
  const gl = { config: { REGISTERED_PROTOCOLS: {} }, addProtocol: () => {}, removeProtocol: () => {}, getVersion: () => "6.12.0" };
  return { default: gl, ...gl };
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/public/gallery-assets/cloud-native");
const fgb = new Uint8Array(readFileSync(join(FIXTURES, "districts.fgb")));
const parquet = new Uint8Array(readFileSync(join(FIXTURES, "districts.parquet")));
const FGB_LIB = "../../src/formats/lib/flatgeobuf";
const GP_LIB = "../../src/formats/lib/geoparquet";
const COG_LIB = "../../src/formats/lib/cog";

const STALE = /another maplibre-yaml version/;

/** A 0.9-shaped chunk: the library's own exports, no adapter, no `useHost`. */
function staleChunk(lib: string, exports: Record<string, unknown>) {
  vi.resetModules();
  // `useHost: undefined` stands for the missing export: vitest's module-mock
  // proxy throws on a key the factory didn't return, a browser's namespace
  // object reads it as undefined.
  vi.doMock(lib, () => ({ useHost: undefined, ...exports }));
}

const serve = (bytes: Uint8Array) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } })));

afterEach(() => {
  vi.doUnmock(FGB_LIB);
  vi.doUnmock(GP_LIB);
  vi.doUnmock(COG_LIB);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The plain `chunk` notice for `format`, naming the version mismatch. */
async function expectStaleNotice(error: unknown, format: string) {
  const { isFormatError } = await import("../../src/formats/errors");
  expect(String((error as Error).message)).not.toMatch(/is not a function|useHost/);
  expect(isFormatError(error)).toBe(true);
  const failure = (error as { failure: { code: string; format: string; url: string; detail?: string } }).failure;
  expect(failure).toMatchObject({ code: "chunk", format, url: `chunks/${format}.js` });
  expect(failure.detail).toMatch(STALE);
  expect(failure.detail).toContain("copy the whole dist/");
  expect((error as Error).message).toContain("copy the whole `dist/` folder");
}

describe("a reader chunk from another maplibre-yaml version (no useHost)", () => {
  it("FlatGeobuf, read whole ahead of the map (fitTo): the chunk notice", async () => {
    staleChunk(FGB_LIB, { deserialize: () => undefined });
    serve(fgb);
    const { cloudSourceDataLoader, loadedCloudReaders } = await import("../../src/renderer/cloud-sources");
    const error = await cloudSourceDataLoader({ type: "geojson", url: "https://h.org/d.fgb" })!.catch((e: unknown) => e);
    await expectStaleNotice(error, "flatgeobuf");
    // Not kept as a ready reader: nothing starts from it.
    expect(loadedCloudReaders("flatgeobuf")).toBeUndefined();
  });

  it("GeoParquet, read whole ahead of the map (fitTo): the chunk notice", async () => {
    staleChunk(GP_LIB, { parquetMetadataAsync: () => undefined });
    serve(parquet);
    const { cloudSourceDataLoader, loadedCloudReaders } = await import("../../src/renderer/cloud-sources");
    const error = await cloudSourceDataLoader({ type: "geojson", url: "https://h.org/d.parquet" })!.catch((e: unknown) => e);
    await expectStaleNotice(error, "geoparquet");
    expect(loadedCloudReaders("geoparquet")).toBeUndefined();
  });

  it("FlatGeobuf through the layer manager: the source's reader notice", async () => {
    staleChunk(FGB_LIB, { deserialize: () => undefined });
    serve(fgb);
    const { LayerManager } = await import("../../src/renderer/layer-manager");
    const added = new Set<string>();
    const map = {
      addSource: vi.fn((id: string) => added.add(id)),
      getSource: vi.fn((id: string) => (added.has(id) ? { setData: vi.fn() } : undefined)),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      getZoom: () => 12,
      getBounds: () => ({ getWest: () => 9, getEast: () => 11, getSouth: () => 41, getNorth: () => 43 }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const callbacks = { onDataLoading: vi.fn(), onDataLoaded: vi.fn(), onDataError: vi.fn() };
    const manager = new LayerManager(map as never, callbacks);
    await manager.addLayer({ id: "d", type: "fill", source: { type: "geojson", url: "https://h.org/d.fgb" } } as never);
    await vi.waitFor(() => expect(callbacks.onDataError).toHaveBeenCalledTimes(1));
    expect(callbacks.onDataError.mock.calls[0]![0]).toBe("d");
    await expectStaleNotice(callbacks.onDataError.mock.calls[0]![1], "flatgeobuf");
    manager.destroy();
  });

  it("COG: the cog:// handler's request rejects with the chunk notice, every time", async () => {
    const cogProtocol = vi.fn(async () => ({ data: {} }));
    staleChunk(COG_LIB, { cogProtocol });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(16), { status: 206 })));
    const protocol = await import("../../src/formats/cog-protocol");
    const added: Record<string, (p: { url: string; type?: string }, a: AbortController) => Promise<unknown>> = {};
    protocol.install({
      addProtocol: ((name: string, fn: never) => (added[name] = fn)) as never,
      config: { REGISTERED_PROTOCOLS: {} },
      version: "6.12.0",
      module: {},
    });
    const first = await added["cog"]!({ url: "cog://https://h.org/a.tif", type: "json" }, new AbortController()).catch((e: unknown) => e);
    await expectStaleNotice(first, "cog");
    // Not cached as ready: the next request checks again (and reports again), never runs the stale chunk.
    const second = await added["cog"]!({ url: "cog://https://h.org/a.tif/1/0/0" }, new AbortController()).catch((e: unknown) => e);
    await expectStaleNotice(second, "cog");
    expect(cogProtocol).not.toHaveBeenCalled();
  });
});
