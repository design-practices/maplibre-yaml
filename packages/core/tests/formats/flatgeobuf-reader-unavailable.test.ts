// @vitest-environment node
/**
 * The FlatGeobuf reader is reached through `getDecoder("flatgeobuf")`, an
 * on-demand chunk (`chunks/flatgeobuf.js`). A source read whole with
 * `fitTo:` is loaded ahead of the map (`cloudSourceDataLoader`), its
 * whole-file GET started alongside the chunk's download. When that download
 * fails (offline, a content blocker, a self-hosted copy without `chunks/`),
 * the GET it started is cancelled and the file's layer gets the plain
 * "couldn't be downloaded" notice instead of a raw module-loading error.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/formats/lib/flatgeobuf", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /chunks/flatgeobuf.js");
});

describe("the FlatGeobuf reader couldn't be downloaded", () => {
  it("is a plain notice for that file, not a module-loading error, and the GET it started is cancelled", async () => {
    const { cloudSourceDataLoader } = await import("../../src/renderer/cloud-sources");
    const { isFormatError } = await import("../../src/formats/errors");
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(new URL("../../../../docs/public/gallery-assets/cloud-native/districts.fgb", import.meta.url));
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
      })
    );
    const error = await cloudSourceDataLoader({ type: "geojson", url: "data/districts.fgb" })!.catch((e: unknown) => e as Error);
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "chunk", format: "flatgeobuf" });
    expect(error.message).toContain("The FlatGeobuf reader (");
    expect(error.message).toContain("couldn't be downloaded");
    expect(error.message).toContain("copy the whole `dist/` folder");
    expect(error.message).not.toMatch(/dynamically imported module/);
    // The whole-file GET started ahead of the chunk: abandoned with it.
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    vi.unstubAllGlobals();
  });
});
