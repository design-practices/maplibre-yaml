/**
 * @file Tests for the compile-time basemap merge
 * @module @maplibre-yaml/core/tests/emitter
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { projectStyle, mergeBasemap, resolveBasemap, EmitError } from "../../src/emitter";
import { normalizeMapBlock } from "../../src/model";
import type { V1MapInput } from "../../src/model";

const emptyGeojson = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

const BASE_STYLE = {
  version: 8,
  name: "Basemap",
  sprite: "https://tiles.test/sprite",
  glyphs: "https://tiles.test/{fontstack}/{range}.pbf",
  center: [0, 0],
  zoom: 1,
  sources: { basetiles: { type: "vector", url: "https://tiles.test/v3.json" } },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#eee" } },
    { id: "roads", type: "line", source: "basetiles", "source-layer": "roads" },
    { id: "labels", type: "symbol", source: "basetiles", "source-layer": "place" },
  ],
};

const project = (input: unknown) => projectStyle(normalizeMapBlock(input as V1MapInput));

const doc = (over: Record<string, unknown> = {}) => ({
  id: "m",
  config: { center: [-73.98, 40.75], zoom: 12 },
  sources: { parcels: emptyGeojson },
  layers: [{ id: "parcels-fill", type: "fill", source: "parcels" }],
  ...over,
});

describe("mergeBasemap", () => {
  it("produces a self-contained style carrying both sides", () => {
    const { style } = mergeBasemap(BASE_STYLE, project(doc()));

    expect(validateStyleMin(style as never)).toEqual([]);
    expect(Object.keys(style["sources"] as object).sort()).toEqual(["basetiles", "parcels"]);
    const ids = (style["layers"] as Record<string, unknown>[]).map((l) => l["id"]);
    expect(ids).toEqual(["bg", "roads", "labels", "parcels-fill"]);
  });

  it("keeps the author's camera and inherits the base's rendering resources", () => {
    const { style } = mergeBasemap(BASE_STYLE, project(doc()));

    // The camera is the author's; sprite and glyphs are the basemap's, without
    // which every symbol layer in it renders blank.
    expect(style["center"]).toEqual([-73.98, 40.75]);
    expect(style["zoom"]).toBe(12);
    expect(style["sprite"]).toBe("https://tiles.test/sprite");
    expect(style["glyphs"]).toBe("https://tiles.test/{fontstack}/{range}.pbf");
  });

  it("inserts a document layer before a basemap layer when asked", () => {
    const { style } = mergeBasemap(
      BASE_STYLE,
      project(
        doc({
          layers: [{ id: "parcels-fill", type: "fill", source: "parcels", before: "labels" }],
        })
      )
    );

    const ids = (style["layers"] as Record<string, unknown>[]).map((l) => l["id"]);
    expect(ids).toEqual(["bg", "roads", "parcels-fill", "labels"]);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("warns when `before` names a layer neither side has", () => {
    const { style, warnings } = mergeBasemap(
      BASE_STYLE,
      project(
        doc({
          layers: [{ id: "parcels-fill", type: "fill", source: "parcels", before: "nope" }],
        })
      )
    );

    const ids = (style["layers"] as Record<string, unknown>[]).map((l) => l["id"]);
    expect(ids[ids.length - 1]).toBe("parcels-fill");
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/names a layer that is in neither/);
  });

  it("lets a document source shadow a basemap source, with a warning", () => {
    const { style, warnings } = mergeBasemap(
      BASE_STYLE,
      project(doc({ sources: { basetiles: emptyGeojson }, layers: [] }))
    );

    const sources = style["sources"] as Record<string, Record<string, unknown>>;
    expect(sources["basetiles"]!["type"]).toBe("geojson");
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/shadows one of the same name/);
  });

  it("replaces a shadowed basemap layer in place rather than appending it", () => {
    const { style, warnings } = mergeBasemap(
      BASE_STYLE,
      project(doc({ layers: [{ id: "roads", type: "fill", source: "parcels" }] }))
    );

    const ids = (style["layers"] as Record<string, unknown>[]).map((l) => l["id"]);
    // Position is preserved so the document's replacement draws where the base
    // layer did, rather than jumping to the top of the map.
    expect(ids).toEqual(["bg", "roads", "labels"]);
    const roads = (style["layers"] as Record<string, unknown>[])[1]!;
    expect(roads["type"]).toBe("fill");
    expect(warnings.map((w) => w.message).join(" ")).toMatch(/shadows/);
  });

  it("rejects a base that is not a style object", () => {
    expect(() => mergeBasemap("not a style", project(doc()))).toThrow(EmitError);
  });
});

describe("resolveBasemap", () => {
  it("passes an inline style object straight through", async () => {
    await expect(resolveBasemap(BASE_STYLE)).resolves.toBe(BASE_STYLE);
  });

  it("fetches a URL through the injected fetcher", async () => {
    const resolved = await resolveBasemap("https://tiles.test/style.json", async () => BASE_STYLE);
    expect(resolved).toBe(BASE_STYLE);
  });

  it("fails with the URL named rather than emitting a partial style", async () => {
    // A map with no basemap is not a degraded map, it is a blank screen — so
    // this errors in both modes rather than falling back.
    await expect(
      resolveBasemap("https://tiles.test/gone.json", async () => {
        throw new Error("404 Not Found");
      })
    ).rejects.toThrow(/https:\/\/tiles\.test\/gone\.json.*404/s);
  });

  it("rejects a basemap that is neither a URL nor an object", async () => {
    await expect(resolveBasemap(42)).rejects.toThrow(EmitError);
  });
});
