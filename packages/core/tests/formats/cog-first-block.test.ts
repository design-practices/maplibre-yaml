/**
 * The COG reader's first block comes from the preflight's read (0.9): the
 * one matching request is answered from the held bytes, once; every other
 * request goes to fetch untouched.
 */
import { describe, it, expect, vi } from "vitest";

describe("shareFirstBlock", () => {
  it("answers the reader's first 64 KB request from the held bytes, once", async () => {
    const network = vi.fn(async () => new Response("network", { status: 200 }));
    vi.stubGlobal("fetch", network);
    vi.resetModules();
    const { shareFirstBlock } = await import("../../src/formats/lib/cog-first-block");
    const bytes = new Uint8Array(65536).map((_, i) => i % 251);
    shareFirstBlock("https://h.org/a.tif", { bytes, contentRange: "bytes 0-65535/200000" });

    const first = await fetch("https://h.org/a.tif", { headers: { Range: "bytes=0-65535" } });
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe("bytes 0-65535/200000");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
    expect(network).not.toHaveBeenCalled();

    // Served once; another range, another file, or a second ask go to the network.
    await fetch("https://h.org/a.tif", { headers: { Range: "bytes=0-65535" } });
    await fetch("https://h.org/a.tif", { headers: { Range: "bytes=65536-131071" } });
    await fetch("https://h.org/b.tif", { headers: { Range: "bytes=0-65535" } });
    expect(network).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("never serves more than it holds (a file shorter than the block it read)", async () => {
    const network = vi.fn(async () => new Response("network", { status: 200 }));
    vi.stubGlobal("fetch", network);
    vi.resetModules();
    const { shareFirstBlock, dropFirstBlock } = await import("../../src/formats/lib/cog-first-block");
    shareFirstBlock("https://h.org/small.tif", { bytes: new Uint8Array(100), contentRange: null });
    await fetch("https://h.org/small.tif", { headers: { Range: "bytes=0-65535" } });
    expect(network).toHaveBeenCalledTimes(1);
    dropFirstBlock("https://h.org/small.tif");
    vi.unstubAllGlobals();
  });
});
