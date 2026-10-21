// @vitest-environment node
/**
 * The GeoParquet library is reached through `getDecoder("geoparquet")`, an
 * on-demand chunk (`chunks/geoparquet.js`). When that download fails
 * (offline, a content blocker, a self-hosted copy without `chunks/`), the
 * file's layer gets the plain "couldn't be downloaded" notice instead of a
 * raw module-loading error, and nothing else breaks.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/formats/lib/geoparquet", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /chunks/format-geoparquet.js");
});

describe("the GeoParquet reader couldn't be downloaded", () => {
  it("is a plain notice for that file, not a module-loading error", async () => {
    const { GeoParquetLoader, loadModeOf } = await import("../../src/renderer/cloud-sources");
    const { isFormatError } = await import("../../src/formats/errors");
    // A small file served whole by the stub fetch: the read gets as far as the library.
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(new URL("../../../../docs/public/gallery-assets/cloud-native/districts.parquet", import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const onError = vi.fn();
    const loader = new GeoParquetLoader(
      { getZoom: () => 12, on: vi.fn(), off: vi.fn() } as never,
      "data/wells.parquet",
      loadModeOf({}),
      "all",
      { onData: vi.fn(), onError }
    );
    await loader.start();
    const error = onError.mock.calls[0]![0];
    expect(isFormatError(error) && error.failure).toMatchObject({ code: "chunk", format: "geoparquet" });
    expect(error.message).toContain("The GeoParquet reader (");
    expect(error.message).toContain("couldn't be downloaded");
    expect(error.message).toContain("copy the whole `dist/` folder");
    expect(error.message).not.toMatch(/dynamically imported module/);
  });
});
