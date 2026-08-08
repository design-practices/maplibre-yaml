/**
 * @file AE5 — unregistered extensions fail closed end to end
 * @module @maplibre-yaml/core/tests/extensions
 *
 * @description
 * The two halves of the extension contract meet here: the registry drops an
 * unregistered block on read, and the emitter never lets one through on write.
 * Neither depends on the other, which is the point — a block that slips past the
 * registry still cannot reach the emitted style, because the projection is an
 * allowlist and its invariant check throws if an `x-*` key survives.
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { z } from "zod";
import { ExtensionRegistry } from "../../src/extensions";
import { projectStyle } from "../../src/emitter";
import { normalizeMapBlock } from "../../src/model";
import type { V1MapInput } from "../../src/model";

const doc = {
  id: "m",
  config: { center: [0, 0], zoom: 5 },
  sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
  layers: [
    { id: "a", type: "circle", source: "s", "x-unknown": { anything: true } },
  ],
} as unknown;

describe("AE5 — an unregistered x-* block fails closed", () => {
  it("the registry warns and delivers nothing", () => {
    const registry = new ExtensionRegistry();
    // Something is registered, just not this namespace.
    registry.register("x-map-party", { schema: z.any() });

    const { blocks, warnings } = registry.extract(doc);
    expect(blocks).toEqual([]);
    expect(warnings.map((w) => w.namespace)).toEqual(["x-unknown"]);
  });

  it("the emitter strips it, and the style is spec-valid without it", () => {
    const { style } = projectStyle(normalizeMapBlock(doc as V1MapInput));

    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]).not.toHaveProperty("x-unknown");
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("strips even a nested x-* key rather than shipping it", () => {
    const model = normalizeMapBlock(doc as V1MapInput);
    (model.style.layers[0]!.spec as Record<string, unknown>)["x-forced"] = { leak: true };
    const { style } = projectStyle(model);
    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]).not.toHaveProperty("x-forced");
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("fails closed on a `runtime` key, the one thing the strip must never see", () => {
    // `runtime` is not an extension namespace and never legitimately reaches the
    // style half — so if one appears, it is a real projection bug, and emit
    // throws rather than silently removing it.
    const model = normalizeMapBlock(doc as V1MapInput);
    (model.style.layers[0]!.spec as Record<string, unknown>)["runtime"] = { leak: true };
    expect(() => projectStyle(model)).toThrow(/runtime/);
  });
});
