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

  it("skips names the map already carries", async () => {
    const map = mapMock();
    map.added.set("taken", {});
    const create = vi.spyOn(document, "createElement");
    const done = loadDocumentImages(map, { taken: "https://x.example/t.png" });
    for (const img of createdImages(create)) img.dispatchEvent(new Event("load"));
    await done;
    expect(map.addImage).not.toHaveBeenCalled();
    create.mockRestore();
  });
});
