/**
 * @file U4 (ml-4jq): the geo-sugar expander is public API.
 *
 * `@maplibre-yaml/astro` single-sources its base-Feature shape against the core
 * expander (U4), so `expandGeoSugar`/`project`/`detectSugarKey` must reach a
 * consumer through the package's public barrel — the same "does it reach the
 * root?" guard the `!html` de-drift pinned in `parse-options.test.ts`. The
 * package root uses explicit named re-exports (not `export *`), so an export
 * added to `./model` is not automatically surfaced here; this pins it.
 */

import { describe, it, expect, vi } from "vitest";

// The root barrel eagerly loads maplibre-gl (via the renderer), which needs a
// URL.createObjectURL. Same shim the renderer conformance suites use — lets us
// import from the real public `@maplibre-yaml/core` surface, not a sub-path.
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:sugar-export-surface";
  w.URL.revokeObjectURL ??= () => {};
});

import {
  SUGAR_KEYS,
  detectSugarKey,
  project,
  expandGeoSugar,
  isSugarError,
} from "../../src";

describe("geo-sugar expander is public API (U4)", () => {
  it("SUGAR_KEYS reaches consumers through the public barrel", () => {
    expect(SUGAR_KEYS).toEqual(["location", "locations", "region", "route"]);
  });

  it("expandGeoSugar turns a location node into a Point Feature via the barrel", () => {
    const node = { coordinates: [-73.98, 40.75], name: "Midtown" };
    const result = expandGeoSugar(node, "location");
    expect(isSugarError(result)).toBe(false);
    if (isSugarError(result)) return;
    expect(result.value).toMatchObject({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.98, 40.75] },
      properties: { name: "Midtown", description: "" },
    });
  });

  it("detectSugarKey and project reach consumers through the barrel", () => {
    expect(detectSugarKey({ type: "geojson", region: {} })).toBe("region");
    expect(project({ coordinates: [0, 0], markerColor: "#f00", zoom: 12 })).toEqual({
      coordinates: [0, 0],
    });
  });
});
