/**
 * The on-demand reader seam (ml-7qa.5, 0.9): a reader whose file can't be
 * downloaded becomes a plain FormatError naming the file and what to do —
 * for the affected source only — and the next attempt retries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// A reader's chunk "fails to download": a module factory that throws makes
// the dynamic import reject, as a 404 would. `offline()` installs it for the
// fresh module graph the test then imports.
const CHUNK_URL = "https://example.org/site/js/maplibre-yaml/chunks/";
const FGB_LIB = "../../src/formats/lib/flatgeobuf";
function offline() {
  vi.resetModules();
  vi.doMock("pmtiles", () => {
    throw new TypeError(`Failed to fetch dynamically imported module: ${CHUNK_URL}pmtiles.js`);
  });
  vi.doMock(FGB_LIB, () => {
    throw new TypeError("Importing a module script failed.");
  });
}
function online() {
  vi.doUnmock("pmtiles");
  vi.doUnmock(FGB_LIB);
  vi.resetModules();
}

import { getDecoder, hasDecoder } from "../../src/formats/decoders";
import { install } from "../../src/formats/pmtiles";
import { decodeBytes } from "../../src/formats/flatgeobuf";
import { isFormatError } from "../../src/formats/errors";

afterEach(online);

describe("getDecoder", () => {
  it("loads each reader once and shares it", async () => {
    const a = getDecoder("pmtiles");
    expect(getDecoder("pmtiles")).toBe(a);
    expect(typeof (await a).Protocol).toBe("function");
    expect(typeof (await getDecoder("flatgeobuf")).deserialize).toBe("function");
  });

  it("knows which formats it has a reader for", () => {
    expect(hasDecoder("pmtiles")).toBe(true);
    expect(hasDecoder("flatgeobuf")).toBe(true);
    expect(hasDecoder("cog")).toBe(true);
    expect(hasDecoder("geoparquet")).toBe(true);
    expect(hasDecoder("protomaps-basemap" as never)).toBe(true);
  });

  it("names the file it couldn't download and says to copy the whole dist/ folder", async () => {
    offline();
    const { getDecoder: fresh } = await import("../../src/formats/decoders");
    const error = await fresh("pmtiles").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure).toMatchObject({
      code: "chunk",
      format: "pmtiles",
      url: `${CHUNK_URL}pmtiles.js`,
    });
    const message = (error as Error).message;
    expect(message).toContain(`The PMTiles reader (\`${CHUNK_URL}pmtiles.js\`) couldn't be downloaded.`);
    expect(message).toContain("copy the whole `dist/` folder");
    expect(message).toContain("load it from the CDN");
    expect(message).toContain("Other layers are unaffected.");
  });

  it("names the chunk by its file in dist/ when the browser doesn't say (Safari)", async () => {
    offline();
    const { getDecoder: fresh } = await import("../../src/formats/decoders");
    const error = await fresh("flatgeobuf").catch((e: unknown) => e);
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "chunk", url: "chunks/flatgeobuf.js" });
  });

  it("does not cache a failure: the next call tries again", async () => {
    offline();
    const { getDecoder: fresh } = await import("../../src/formats/decoders");
    // Safari names no file: the next call imports the reader as before.
    await expect(fresh("flatgeobuf")).rejects.toMatchObject({ failure: { code: "chunk" } });
    online();
    await expect(fresh("flatgeobuf")).resolves.toHaveProperty("deserialize");
  });

  it("asks again for a file the browser named under a URL of its own: the browser keeps a failed import (ml-cnv.19)", async () => {
    offline();
    const fresh = await import("../../src/formats/decoders");
    await expect(fresh.getDecoder("pmtiles")).rejects.toMatchObject({ failure: { code: "chunk" } });
    // Chromium and Firefox reject an import() of the same URL again without a
    // request, so the retry asks for `?retry=1`…
    const load = vi
      .spyOn(fresh.reimport, "load")
      .mockRejectedValueOnce(new TypeError(`Failed to fetch dynamically imported module: ${CHUNK_URL}pmtiles.js?retry=1`))
      .mockResolvedValueOnce({ Protocol: class {} });
    await expect(fresh.getDecoder("pmtiles")).rejects.toMatchObject({ failure: { url: `${CHUNK_URL}pmtiles.js` } });
    expect(load).toHaveBeenLastCalledWith(`${CHUNK_URL}pmtiles.js?retry=1`);
    // …and the next one `?retry=2`, which loads.
    await expect(fresh.getDecoder("pmtiles")).resolves.toHaveProperty("Protocol");
    expect(load).toHaveBeenLastCalledWith(`${CHUNK_URL}pmtiles.js?retry=2`);
    // Loaded: shared from now on.
    expect(fresh.getDecoder("pmtiles")).toBe(fresh.getDecoder("pmtiles"));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("the readers' callers", () => {
  it("pmtiles: the protocol registers synchronously; a request then reports the missing reader", async () => {
    offline();
    const { install: freshInstall } = await import("../../src/formats/pmtiles");
    const addProtocol = vi.fn();
    expect(freshInstall({ addProtocol, config: { REGISTERED_PROTOCOLS: {} }, module: {} })).toBe("installed");
    expect(addProtocol).toHaveBeenCalledTimes(1);
    const handler = addProtocol.mock.calls[0]![1] as (p: { url: string }, a: AbortController) => Promise<unknown>;
    const error = await handler({ url: "pmtiles://https://h.org/x.pmtiles" }, new AbortController()).catch((e) => e);
    expect(isFormatError(error) && error.failure.code).toBe("chunk");
  });

  it("pmtiles: a reader that failed to download is dropped, so the next request downloads it again (ml-cnv.18)", async () => {
    offline();
    const decoders = await import("../../src/formats/decoders");
    const { install: freshInstall } = await import("../../src/formats/pmtiles");
    const addProtocol = vi.fn();
    freshInstall({ addProtocol, config: { REGISTERED_PROTOCOLS: {} }, module: {} });
    const handler = addProtocol.mock.calls[0]![1] as (p: { url: string }, a: AbortController) => Promise<unknown>;
    const request = { url: "pmtiles://https://h.org/x.pmtiles" };
    const first = await handler(request, new AbortController()).catch((e) => e);
    expect(isFormatError(first) && first.failure.code).toBe("chunk");
    // Back online: the next request gets a reader and its tile.
    const tile = vi.fn(async () => ({ data: "tile" }));
    vi.spyOn(decoders.reimport, "load").mockResolvedValue({
      Protocol: class {
        tile = tile;
      },
    });
    await expect(handler(request, new AbortController())).resolves.toEqual({ data: "tile" });
    expect(tile).toHaveBeenCalledTimes(1);
  });

  it("pmtiles: registering needs no reader download (sync, before new Map())", () => {
    const addProtocol = vi.fn();
    install({ addProtocol, config: { REGISTERED_PROTOCOLS: {} }, module: {} });
    expect(addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
  });

  it("flatgeobuf: decoding reports the missing reader as a FormatError, not a read error", async () => {
    offline();
    const { decodeBytes: freshDecode } = await import("../../src/formats/flatgeobuf");
    const error = await freshDecode(new Uint8Array([0x66, 0x67, 0x62, 3, 0x66, 0x67, 0x62, 0]), "x.fgb").catch(
      (e: unknown) => e
    );
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "chunk", format: "flatgeobuf" });
    expect(typeof decodeBytes).toBe("function");
  });
});
