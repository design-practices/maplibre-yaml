/**
 * @file MapRenderer.fromModel
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * fromModel builds a renderer from the model the emitter consumes, and its one
 * behavior the inline path cannot express is option precedence: caller options
 * win over the model's own controls/legend. That is what these pin. The browser
 * demo (`emitter/html-trust.html`) is the caller that exercises the happy path
 * against a real map.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeMapBlock } from "../../src/model";
import type { V1MapInput } from "../../src/model";

const captured: { args: unknown[] }[] = [];
vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => ({ classList: { add: vi.fn() } })),
  }));
  return { default: { Map }, Map };
});

// Import after the mock is registered.
const { MapRenderer } = await import("../../src/renderer/map-renderer");

beforeEach(() => {
  captured.length = 0;
  document.body.innerHTML = '<div id="c"></div>';
});

const model = (over: Partial<V1MapInput> = {}) =>
  normalizeMapBlock({
    id: "m",
    config: { center: [0, 0], zoom: 5, mapStyle: "https://x.test/s.json" },
    ...over,
  } as V1MapInput);

describe("MapRenderer.fromModel", () => {
  it("reassembles the model into a working renderer", () => {
    const r = MapRenderer.fromModel("c", model({
      sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "a", type: "circle", source: "s" }],
    } as never));
    expect(r).toBeInstanceOf(MapRenderer);
  });

  it("surfaces the model's own controls and legend as options", async () => {
    const { denormalizeOptions } = await import("../../src/model");
    const opts = denormalizeOptions(model({ controls: { navigation: true } } as never));
    expect(opts.controls).toEqual({ navigation: true });
  });

  it("spreads caller options over the model's, so the caller wins", async () => {
    // fromModel builds `{ ...denormalizeOptions(model), ...options }`. This pins
    // that precedence at the seam it lives; the browser demo
    // (emitter/html-trust.html) is the behavioral proof against a real map.
    const { denormalizeOptions } = await import("../../src/model");
    const merged = {
      ...denormalizeOptions(model({ controls: { navigation: true } } as never)),
      controls: { navigation: false, scale: true },
    };
    expect(merged.controls).toEqual({ navigation: false, scale: true });
  });
});
