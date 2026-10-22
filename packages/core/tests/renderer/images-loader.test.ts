/**
 * @file Live `images:` — addImage before layers, scheme gate, failure posture (U6)
 */

import { describe, it, expect, vi } from "vitest";
import { loadDocumentImages } from "../../src/renderer/images-loader";

/** A map mock capturing addImage; hasImage reflects what was added. */
function mapMock() {
  const added = new Map<string, unknown>();
  return {
    added,
    addImage: vi.fn((name: string, img: unknown, options?: unknown) => {
      added.set(name, { img, options });
    }),
    hasImage: vi.fn((name: string) => added.has(name)),
  } as any;
}

/** The most recently created <img> elements, oldest first. */
function createdImages(spy: ReturnType<typeof vi.spyOn>): HTMLImageElement[] {
  return spy.mock.results.map((r) => r.value as HTMLImageElement);
}

describe("loadDocumentImages", () => {
  it("registers each image via addImage with sdf/pixelRatio options", async () => {
    const map = mapMock();
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(map, {
      plain: "https://x.example/a.png",
      fancy: { url: "https://x.example/b.png", sdf: true, pixelRatio: 2 },
    });

    for (const img of createdImages(create)) img.dispatchEvent(new Event("load"));
    await done;

    expect(map.addImage).toHaveBeenCalledTimes(2);
    expect(map.addImage).toHaveBeenCalledWith("plain", expect.anything(), {});
    expect(map.addImage).toHaveBeenCalledWith("fancy", expect.anything(), {
      sdf: true,
      pixelRatio: 2,
    });
    // Texture uploads need untainted sources.
    expect(createdImages(create)[0]!.crossOrigin).toBe("anonymous");
    create.mockRestore();
  });

  it("refuses an unsafe URL scheme — warned, signaled, never fetched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: string[] = [];
    const map = mapMock();
    // eslint-disable-next-line no-script-url
    await loadDocumentImages(map, { evil: "javascript:alert(1)" }, (name) =>
      errors.push(name)
    );

    expect(map.addImage).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("unsafe URL scheme");
    expect(errors).toEqual(["evil"]);
    warn.mockRestore();
  });

  it("a failed load warns and resolves — the document keeps rendering", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: string[] = [];
    const map = mapMock();
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(
      map,
      { broken: "https://x.example/broken.png", ok: "https://x.example/ok.png" },
      (name) => errors.push(name)
    );

    const [broken, ok] = createdImages(create);
    broken!.dispatchEvent(new Event("error"));
    ok!.dispatchEvent(new Event("load"));
    await done;

    expect(map.addImage).toHaveBeenCalledTimes(1);
    expect(map.addImage).toHaveBeenCalledWith("ok", expect.anything(), {});
    expect(errors).toEqual(["broken"]);
    expect(warn.mock.calls[0]![0]).toContain("failed to load");
    warn.mockRestore();
    create.mockRestore();
  });

  it("a name the map already carries is shadowed — warned, never silently skipped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = mapMock();
    map.added.set("taken", {});
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(map, { taken: "https://x.example/t.png" });
    for (const img of createdImages(create)) img.dispatchEvent(new Event("load"));
    await done;
    expect(map.addImage).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("shadowed");
    warn.mockRestore();
    create.mockRestore();
  });

  it("an addImage throw is contained — warned, signaled, promise still resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: string[] = [];
    const map = mapMock();
    map.addImage.mockImplementation(() => {
      throw new Error("style is gone");
    });
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(map, { doomed: "https://x.example/d.png" }, (name) =>
      errors.push(name)
    );
    for (const img of createdImages(create)) img.dispatchEvent(new Event("load"));
    await done;
    expect(errors).toEqual(["doomed"]);
    expect(warn.mock.calls[0]![0]).toContain("Could not register");
    warn.mockRestore();
    create.mockRestore();
  });

  it("an image that never loads times out — the document stops waiting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: string[] = [];
    const map = mapMock();
    // A 5ms timeout; the img never fires load/error.
    await loadDocumentImages(
      map,
      { stuck: "https://x.example/tarpit.png" },
      (name) => errors.push(name),
      5
    );
    expect(errors).toEqual(["stuck"]);
    expect(warn.mock.calls[0]![0]).toContain("did not load within");
    expect(map.addImage).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("density matching (ml-aot.139): no image denser than the screen", () => {
  it("area-averages pixels, in premultiplied alpha", async () => {
    const { downsampleRGBA } = await import("../../src/renderer/images-loader");
    // 4x2 → 2x1: each output pixel averages a 2x2 block
    const src = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 10, 20, 30, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 10, 20, 30, 255,
    ]);
    expect([...downsampleRGBA(src, 4, 2, 2, 1)]).toEqual([128, 128, 128, 255, 10, 20, 30, 255]);
    // a transparent texel does not darken its opaque neighbour's colour
    const edge = new Uint8Array([200, 100, 50, 255, 0, 0, 0, 0]);
    expect([...downsampleRGBA(edge, 2, 1, 1, 1)]).toEqual([200, 100, 50, 128]);
    // non-integer ratio (3 → 2) keeps total weight
    const ramp = new Uint8Array([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255]);
    expect([...downsampleRGBA(ramp, 3, 1, 2, 1)]).toEqual([30, 30, 30, 255, 150, 150, 150, 255]);
  });

  it("registers a pixelRatio-4 image at the screen's ratio, keeping its logical size", async () => {
    const dpr = vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage: () => {}, getImageData: () => ({ data: pixels }) } as never);
    const map = mapMock();
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(map, {
      dense: { url: "https://x.example/hatch.png", pixelRatio: 4 },
      matched: { url: "https://x.example/ok.png", pixelRatio: 2 },
      sdf: { url: "https://x.example/sdf.png", pixelRatio: 4, sdf: true },
    });
    for (const img of createdImages(create).filter((e) => e.tagName === "IMG")) {
      Object.defineProperty(img, "naturalWidth", { value: 8 });
      Object.defineProperty(img, "naturalHeight", { value: 8 });
      img.dispatchEvent(new Event("load"));
    }
    await done;
    const dense = map.added.get("dense");
    expect(dense.options).toEqual({ pixelRatio: 2 });
    expect(dense.img).toMatchObject({ width: 4, height: 4 });
    expect(dense.img.data).toHaveLength(4 * 4 * 4);
    // already at the screen's ratio, or SDF: handed over as declared
    expect(map.added.get("matched").options).toEqual({ pixelRatio: 2 });
    expect(map.added.get("matched").img).toBeInstanceOf(HTMLImageElement);
    expect(map.added.get("sdf").options).toEqual({ sdf: true, pixelRatio: 4 });
    expect(map.added.get("sdf").img).toBeInstanceOf(HTMLImageElement);
    create.mockRestore();
    getContext.mockRestore();
    dpr.mockRestore();
  });
});
