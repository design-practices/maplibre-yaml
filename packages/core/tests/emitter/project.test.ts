/**
 * @file Tests for the style projection
 * @module @maplibre-yaml/core/tests/emitter
 *
 * @description
 * Every case ends at MapLibre's own validator where it can. Asserting on the
 * projected object proves what we think we built; asserting `validateStyleMin`
 * returns clean proves MapLibre agrees, and that is the claim the eject
 * guarantee actually makes.
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { projectStyle, EmitError } from "../../src/emitter";
import { normalizeMapBlock } from "../../src/model";
import type { V1MapInput } from "../../src/model";

const emit = (input: unknown, mode?: "strict" | "with-fallbacks") =>
  projectStyle(normalizeMapBlock(input as V1MapInput), mode);

const base = { id: "m", config: { center: [-73.98, 40.75], zoom: 12 } };
const emptyGeojson = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

describe("projectStyle — the erasable half compiles", () => {
  it("emits a spec-valid style for a named source and layer", () => {
    const { style } = emit({
      ...base,
      sources: { s: emptyGeojson },
      layers: [{ id: "a", type: "circle", source: "s", paint: { "circle-color": "#111" } }],
    });
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(style["version"]).toBe(8);
    expect(style["center"]).toEqual([-73.98, 40.75]);
  });

  it("hoists an inline source into a named one", () => {
    const { style } = emit({
      ...base,
      layers: [{ id: "parcels", type: "circle", source: emptyGeojson }],
    });
    expect(validateStyleMin(style as never)).toEqual([]);
    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]!["source"]).toBe("parcels-source");
    expect(style["sources"]).toHaveProperty("parcels-source");
  });

  it("compiles `state` through, since MapLibre carries it natively", () => {
    const { style } = emit({
      ...base,
      state: { scenario: { default: "built" } },
      sources: { s: emptyGeojson },
      layers: [{ id: "a", type: "circle", source: "s" }],
    });
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(style["state"]).toEqual({ scenario: { default: "built" } });
  });

  it("turns `visible: false` into layout.visibility", () => {
    const { style } = emit({
      ...base,
      sources: { s: emptyGeojson },
      layers: [{ id: "a", type: "circle", source: "s", visible: false }],
    });
    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]!["layout"]).toEqual({ visibility: "none" });
    expect(layers[0]).not.toHaveProperty("visible");
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("honors `before` as array ordering", () => {
    const { style } = emit({
      ...base,
      sources: { s: emptyGeojson },
      layers: [
        { id: "base", type: "circle", source: "s" },
        { id: "under", type: "circle", source: "s", before: "base" },
      ],
    });
    const ids = (style["layers"] as Record<string, unknown>[]).map((l) => l["id"]);
    expect(ids).toEqual(["under", "base"]);
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe("projectStyle — the runtime half degrades", () => {
  it("drops live-data configuration and says so", () => {
    const { style, warnings } = emit({
      ...base,
      sources: { s: { ...emptyGeojson, refresh: { refreshInterval: 5000 } } },
      layers: [{ id: "a", type: "circle", source: "s" }],
    });
    expect(validateStyleMin(style as never)).toEqual([]);
    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["s"]).not.toHaveProperty("refresh");
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/refresh/);
  });

  it("drops interactions and chrome and says so", () => {
    const { style, warnings } = emit({
      ...base,
      controls: { navigation: true },
      sources: { s: emptyGeojson },
      layers: [
        {
          id: "a",
          type: "circle",
          source: "s",
          interactive: { hover: { highlight: true } },
          legend: { color: "#111", label: "Points" },
        },
      ],
    });
    expect(validateStyleMin(style as never)).toEqual([]);
    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]).not.toHaveProperty("interactive");
    expect(layers[0]).not.toHaveProperty("legend");
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/interactive/);
  });

  it("warns that constructor options have no style-spec equivalent", () => {
    const { warnings } = emit({
      ...base,
      config: { center: [0, 0], zoom: 5, minZoom: 3, scrollZoom: false },
    });
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/minZoom|scrollZoom/);
  });

  it("errors in strict mode rather than degrading", () => {
    expect(() =>
      emit(
        {
          ...base,
          sources: { s: { ...emptyGeojson, refresh: { refreshInterval: 5000 } } },
          layers: [{ id: "a", type: "circle", source: "s" }],
        },
        "strict"
      )
    ).toThrow(EmitError);
  });
});

describe("projectStyle — author data is not document structure", () => {
  it("preserves feature properties named like reserved keys", () => {
    const { style } = emit({
      ...base,
      sources: {
        s: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { runtime: "keep me", "x-notes": "keep me too" },
              },
            ],
          },
        },
      },
      layers: [{ id: "a", type: "circle", source: "s" }],
    });
    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    const data = sources["s"]!["data"] as Record<string, unknown>;
    const props = (data["features"] as Record<string, unknown>[])[0]!["properties"];
    expect(props).toEqual({ runtime: "keep me", "x-notes": "keep me too" });
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("keeps layer metadata, which the spec carries", () => {
    const { style } = emit({
      ...base,
      sources: { s: emptyGeojson },
      layers: [{ id: "a", type: "circle", source: "s", metadata: { owner: "planning" } }],
    });
    const layers = style["layers"] as Record<string, unknown>[];
    expect(layers[0]!["metadata"]).toEqual({ owner: "planning" });
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});
