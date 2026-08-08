/**
 * @file Tests for the `zoomToFeature` click interaction
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * `zoomToFeature` fits the camera to the *clicked feature's own bounds* via
 * `map.fitBounds` — the sibling of `flyTo`, which flies to author-fixed
 * coordinates. These tests drive the built-in the way `EventHandler` does
 * (`create({...deps})` → `run(config, ctx)`) against a mock map, and pin: the
 * bbox handed to `fitBounds` per geometry type, config passthrough
 * (padding/maxZoom/duration), the missing-geometry no-op (no call, no throw),
 * and that the U2 registry resolves the name to the built-in.
 */

import { describe, it, expect, vi } from "vitest";
import { CLICK_INTERACTIONS } from "../../src/interactions/built-ins";
import { createInteractionRegistry } from "../../src/interactions/registry";
import type {
  Interaction,
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
} from "../../src/interactions/types";

/** A deps stub — `zoomToFeature` uses only the map, never `showPopup`. */
const deps: InteractionDeps = { showPopup: () => {} };

/** The built-in under test, pulled from the ordered click set. */
function zoomToFeature(): Interaction {
  const found = CLICK_INTERACTIONS.find((i) => i.name === "zoomToFeature");
  if (!found) throw new Error("zoomToFeature built-in is not registered");
  return found;
}

/** A fresh runtime with a fitBounds spy and a context wrapping `geometry`. */
function harness(geometry: unknown) {
  const fitBounds = vi.fn();
  const runtime: InteractionRuntime = zoomToFeature().create(deps);
  const ctx: InteractionContext = {
    map: { fitBounds } as unknown as InteractionContext["map"],
    layerId: "layer-1",
    sourceId: "src-1",
    feature: { type: "Feature", properties: {}, geometry },
    lngLat: { lng: 0, lat: 0 } as InteractionContext["lngLat"],
  };
  return { fitBounds, runtime, ctx };
}

describe("zoomToFeature — fits the clicked feature's bounds", () => {
  it("calls fitBounds with a Polygon's bbox", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    });

    runtime.run({}, ctx);

    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(fitBounds.mock.calls[0][0]).toEqual([
      [0, 0],
      [4, 4],
    ]);
  });

  it("passes a degenerate bbox for a Point", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "Point",
      coordinates: [7, -3],
    });

    runtime.run({}, ctx);

    expect(fitBounds.mock.calls[0][0]).toEqual([
      [7, -3],
      [7, -3],
    ]);
  });

  it("uses the LineString's span", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "LineString",
      coordinates: [
        [0, 0],
        [2, 3],
        [-1, 5],
      ],
    });

    runtime.run({}, ctx);

    expect(fitBounds.mock.calls[0][0]).toEqual([
      [-1, 0],
      [2, 5],
    ]);
  });

  it("spans a Multi* geometry", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [8, 5],
            [8, 7],
            [5, 5],
          ],
        ],
      ],
    });

    runtime.run({}, ctx);

    expect(fitBounds.mock.calls[0][0]).toEqual([
      [0, 0],
      [8, 7],
    ]);
  });
});

describe("zoomToFeature — config passthrough", () => {
  it("forwards padding, maxZoom, and duration to fitBounds", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "Point",
      coordinates: [1, 2],
    });

    runtime.run({ padding: 40, maxZoom: 14, duration: 800 }, ctx);

    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(fitBounds.mock.calls[0][1]).toMatchObject({
      padding: 40,
      maxZoom: 14,
      duration: 800,
    });
  });

  it("omits unset options rather than sending undefined", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "Point",
      coordinates: [1, 2],
    });

    runtime.run({ padding: 40 }, ctx);

    const options = fitBounds.mock.calls[0][1] as Record<string, unknown>;
    expect(options).toHaveProperty("padding", 40);
    expect(options).not.toHaveProperty("maxZoom");
    expect(options).not.toHaveProperty("duration");
  });
});

describe("zoomToFeature — error path", () => {
  it("does not call fitBounds and does not throw for a missing geometry", () => {
    const { fitBounds, runtime, ctx } = harness(null);
    expect(() => runtime.run({}, ctx)).not.toThrow();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("does not call fitBounds for an empty geometry", () => {
    const { fitBounds, runtime, ctx } = harness({
      type: "LineString",
      coordinates: [],
    });
    runtime.run({}, ctx);
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("zoomToFeature — registry integration (U2)", () => {
  it("resolves the name to the built-in on the allowlist", () => {
    const registry = createInteractionRegistry();
    const result = registry.resolve("zoomToFeature");
    expect("denied" in result).toBe(false);
    expect((result as Interaction).name).toBe("zoomToFeature");
    expect(registry.has("zoomToFeature")).toBe(true);
  });

  it("keeps popup ahead of the camera interactions in click order", () => {
    const registry = createInteractionRegistry();
    const order = registry.clickInteractions().map((i) => i.name);
    expect(order.indexOf("popup")).toBeLessThan(order.indexOf("zoomToFeature"));
    expect(order.indexOf("popup")).toBeLessThan(order.indexOf("flyTo"));
  });
});
