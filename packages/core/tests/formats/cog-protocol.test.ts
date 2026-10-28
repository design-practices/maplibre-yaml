/**
 * The `cog://` registration in the main bundle (bundle headroom U5): the
 * adapter lives in the `cog` chunk, but a COG's first 64 KB read still starts
 * at once — alongside the chunk's download, as when the preflight lived in
 * the main bundle — and is handed to the chunk, so a file's header is read
 * once. A chunk that couldn't be downloaded is the seam's notice, and the
 * next request downloads it, and reads the header, again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = vi.hoisted(() => ({ cogProtocol: vi.fn(async () => ({ data: { tilejson: "2.2.0" } })) }));
vi.mock("@geomatico/maplibre-cog-protocol", () => plugin);

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "docs", "public", "gallery-assets", "cloud-native"
);
const head = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name))).slice(0, 65536);
const partial = (name: string) =>
  new Response(head(name), { status: 206, headers: { "content-range": "bytes 0-65535/700000" } });

const CHUNK_URL = "https://example.org/site/dist/chunks/cog.js";
const LIB = "../../src/formats/lib/cog";

type Handler = (p: { url: string; type?: string }, a: AbortController) => Promise<unknown>;

async function registered() {
  const protocol = await import("../../src/formats/cog-protocol");
  const added: Record<string, Handler> = {};
  protocol.install({
    addProtocol: ((name: string, fn: never) => (added[name] = fn)) as never,
    config: { REGISTERED_PROTOCOLS: {} },
    version: "6.12.0",
    module: {},
  });
  return { protocol, handler: added["cog"]! };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  plugin.cogProtocol.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  vi.doUnmock(LIB);
  vi.restoreAllMocks();
});

describe("the cog:// handler in the main bundle", () => {
  it("starts a TileJSON request's header read before the reader has loaded, and the reader takes it: one read", async () => {
    fetchSpy.mockImplementation(async () => partial("imagery.cog.tif"));
    const { handler } = await registered();
    const pending = handler({ url: "cog://https://h.org/a.tif#dem", type: "json" }, new AbortController());
    // Asked at once, in the same turn: not after the chunk's download.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).headers).toEqual({ Range: "bytes=0-65535" });
    await expect(pending).resolves.toEqual({ data: { tilejson: "2.2.0" } });
    // The reader's preflight used that read; a second source on the file reads nothing more.
    await handler({ url: "cog://https://h.org/a.tif", type: "json" }, new AbortController());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(plugin.cogProtocol).toHaveBeenCalledTimes(2);
  });

  it("readCogHeaderAhead (fitTo) reads the header once; the handler then reuses it", async () => {
    fetchSpy.mockImplementation(async () => partial("imagery.cog.tif"));
    const { protocol, handler } = await registered();
    const header = await protocol.readCogHeaderAhead("https://h.org/fit.tif");
    expect(header?.bounds?.[0]).toBeCloseTo(10, 6);
    await handler({ url: "cog://https://h.org/fit.tif", type: "json" }, new AbortController());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("the not-cloud-optimized hint reaches the renderer through the chunk's reporter (cogHintFor)", async () => {
    fetchSpy.mockImplementation(async () => partial("imagery-plain.tif"));
    const { protocol, handler } = await registered();
    await handler({ url: "cog://https://h.org/plain.tif", type: "json" }, new AbortController());
    expect(protocol.cogHintFor("cog://https://h.org/plain.tif#dem")).toContain("not a Cloud Optimized one");
    expect(protocol.cogHint("https://h.org/plain.tif")).toContain("gdal_translate -of COG");
  });

  it("a reader that couldn't be downloaded: the seam's notice; the next request downloads it and reads again", async () => {
    vi.doMock(LIB, () => {
      throw new TypeError(`Failed to fetch dynamically imported module: ${CHUNK_URL}`);
    });
    fetchSpy.mockImplementation(async () => partial("imagery.cog.tif"));
    const { handler } = await registered();
    const decoders = await import("../../src/formats/decoders");
    const request = { url: "cog://https://h.org/b.tif", type: "json" };
    const first = (await handler(request, new AbortController()).catch((e: unknown) => e)) as {
      failure?: unknown;
      message: string;
    };
    expect(first.failure).toMatchObject({ code: "chunk", format: "cog", url: CHUNK_URL });
    expect(first.message).toContain("couldn't be downloaded");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Back online: the retry asks for the file afresh (`?retry=1`) and the header again.
    vi.doUnmock(LIB);
    const lib = await vi.importActual<typeof import("../../src/formats/lib/cog")>(LIB);
    const load = vi.spyOn(decoders.reimport, "load").mockResolvedValue(lib);
    await expect(handler(request, new AbortController())).resolves.toEqual({ data: { tilejson: "2.2.0" } });
    expect(load).toHaveBeenCalledWith(`${CHUNK_URL}?retry=1`);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("tiles go to the reader without a header read", async () => {
    fetchSpy.mockImplementation(async () => partial("imagery.cog.tif"));
    const { handler } = await registered();
    await handler({ url: "cog://https://h.org/t.tif#dem/10/545/373", type: "image" }, new AbortController());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(plugin.cogProtocol).toHaveBeenCalledTimes(1);
  });
});
