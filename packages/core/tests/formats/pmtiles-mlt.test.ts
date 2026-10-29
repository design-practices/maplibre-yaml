// @vitest-environment node
// (jsdom's fetch globals drop a `Range` request header; Node's keep it.)
/**
 * PMTiles archives of MLT tiles (0.10, U4; KTD9, KTD11): core's `pmtiles://`
 * handler adds `encoding: "mlt"` to the TileJSON of an archive whose header
 * says MLT (tile type 6), only on a maplibre-gl that draws MLT (6+), and an
 * author's own `encoding` wins. Served by a stub `fetch` that honours HTTP
 * ranges, from districts.pmtiles with its header's tile type patched.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("maplibre-gl", () => ({ default: {} }));

import { archiveTileType, install } from "../../src/formats/pmtiles";
import { LayerManager } from "../../src/renderer/layer-manager";
describe("MLT tiles: encoding from the archive header (U4, KTD9, KTD11)", () => {
  const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/public/gallery-assets/cloud-native");
  /** districts.pmtiles with its header's tile type patched (byte 99: 1 MVT, 2 PNG, 6 MLT). */
  const archive = (tileType: number) => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "districts.pmtiles")));
    bytes[99] = tileType;
    return bytes;
  };
  /** Serve `bytes` for every request, with range support; the ranges asked for. */
  function serve(bytes: Uint8Array) {
    const ranges: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const range = new Headers(init?.headers ?? {}).get("range") ?? "";
      ranges.push(range);
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = Number(from);
      const end = Math.min(Number(to), bytes.length - 1);
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1) },
      });
    });
    return ranges;
  }
  /** The TileJSON core's handler replies with for `url`, on a page running maplibre-gl `version`. */
  async function tileJson(version: string | undefined, url = "http://h.org/a.pmtiles") {
    const addProtocol = vi.fn();
    install({ addProtocol, config: { REGISTERED_PROTOCOLS: {} }, version, module: {} });
    const handler = addProtocol.mock.calls[0]![1] as (
      p: { url: string; type: string },
      a: AbortController
    ) => Promise<{ data: Record<string, unknown> }>;
    return (await handler({ url: `pmtiles://${url}`, type: "json" }, new AbortController())).data;
  }
  afterEach(() => vi.restoreAllMocks());

  it("an archive of MLT tiles (tile type 6) gets encoding: mlt in its TileJSON (AE6)", async () => {
    serve(archive(6));
    const json = await tileJson("6.12.0");
    expect(json).toMatchObject({ encoding: "mlt", vector_layers: expect.any(Array) });
    expect(json["tiles"]).toEqual(["pmtiles://http://h.org/a.pmtiles/{z}/{x}/{y}.mlt"]);
  });

  it("an MVT archive (tile type 1) and a raster archive (PNG) are left alone", async () => {
    serve(archive(1));
    expect(await tileJson("6.12.0")).not.toHaveProperty("encoding");
    vi.restoreAllMocks();
    serve(archive(2));
    expect(await tileJson("6.12.0", "http://h.org/imagery.pmtiles")).not.toHaveProperty("encoding");
  });

  it("below maplibre-gl 6, which can't draw MLT, the TileJSON is unchanged (KTD11)", async () => {
    serve(archive(6));
    const json = await tileJson("5.24.0");
    expect(json).not.toHaveProperty("encoding");
    expect(json).toMatchObject({ tilejson: "3.0.0", vector_layers: expect.any(Array) });
  });

  it("a runtime that reports no version is not a claim: MapLibre has the final word", async () => {
    serve(archive(6));
    expect(await tileJson(undefined)).toMatchObject({ encoding: "mlt" });
  });

  it("an author's encoding wins: it reaches MapLibre, which merges the source over the TileJSON (AE6)", async () => {
    const map = { addSource: vi.fn(), getSource: vi.fn(), on: vi.fn(), off: vi.fn() };
    new LayerManager(map as never, {} as never).registerSources({
      lots: { type: "vector", url: "https://h.org/a.pmtiles", encoding: "mvt" },
    });
    const spec = map.addSource.mock.calls[0]![1];
    expect(spec).toEqual({ type: "vector", url: "pmtiles://https://h.org/a.pmtiles", encoding: "mvt" });
    serve(archive(6));
    // maplibre-gl's load_tilejson.ts: `extend(tileJSON, options)` — explicit source options take precedence.
    expect({ ...(await tileJson("6.12.0")), ...spec }.encoding).toBe("mvt");
  });

  it("archiveTileType reads the tile type from the header core's handler already holds", async () => {
    const ranges = serve(archive(6));
    await tileJson("5.24.0", "http://h.org/held.pmtiles");
    const read = ranges.length;
    expect(await archiveTileType("pmtiles://http://h.org/held.pmtiles")).toBe(6);
    expect(ranges).toHaveLength(read);
    // An archive core's handler hasn't opened: its own header read.
    expect(await archiveTileType("http://h.org/other.pmtiles")).toBe(6);
    expect(ranges.length).toBeGreaterThan(read);
  });

  it("an archive that can't be read: undefined, never a throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await archiveTileType("pmtiles://http://h.org/missing.pmtiles")).toBeUndefined();
  });
});
