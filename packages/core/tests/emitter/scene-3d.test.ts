/**
 * @file Emit for the 3D trio (U15): terrain / sky / projection export verbatim
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  projectStyle,
  mergeBasemap,
  applyRuntimeGate,
  EmitError,
} from "../../src/emitter";
import { normalizeMapBlock } from "../../src/model";
import type { V1MapInput } from "../../src/model";

const DEM = {
  type: "raster-dem",
  tiles: ["https://dem.test/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
};

const doc = (over: Record<string, unknown> = {}) =>
  normalizeMapBlock({
    id: "m",
    config: { center: [11.39, 47.27], zoom: 12, pitch: 70 },
    sources: { terrainSource: DEM },
    layers: [],
    ...over,
  } as unknown as V1MapInput);

const SKY = {
  "sky-color": "#199EF3",
  "horizon-color": "#ffffff",
  "fog-color": "#ffffff",
  "sky-horizon-blend": 0.5,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.1,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
};

describe("projectStyle — the 3D trio compiles to the style.json root", () => {
  it("terrain, sky, and projection export verbatim into a spec-valid style", () => {
    const { style, warnings } = projectStyle(
      doc({
        terrain: { source: "terrainSource", exaggeration: 1.5 },
        sky: SKY,
        projection: { type: "globe" },
      })
    );
    expect(style["terrain"]).toEqual({ source: "terrainSource", exaggeration: 1.5 });
    expect(style["sky"]).toEqual(SKY);
    expect(style["projection"]).toEqual({ type: "globe" });
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("strict mode accepts a resolvable 3D document (class exports, nothing lossy)", () => {
    expect(() =>
      projectStyle(doc({ terrain: { source: "terrainSource" } }), "strict")
    ).not.toThrow();
  });

  it("a terrain source naming an inline layer source resolves to its hoisted id", () => {
    const { style } = projectStyle(
      doc({
        sources: {},
        layers: [{ id: "hills", type: "hillshade", source: DEM }],
        terrain: { source: "hills-source" },
      })
    );
    expect(style["terrain"]).toEqual({ source: "hills-source" });
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("an unresolvable terrain source (no basemap) is dropped as lossy, never shipped invalid", () => {
    const { style, warnings } = projectStyle(doc({ terrain: { source: "nope" } }));
    expect(style["terrain"]).toBeUndefined();
    expect(warnings).toEqual([
      expect.objectContaining({ path: "terrain.source", kind: "lossy", construct: "terrain" }),
    ]);
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(() => projectStyle(doc({ terrain: { source: "nope" } }), "strict")).toThrow(
      EmitError
    );
  });

  it("a terrain source of the wrong type is dropped as lossy", () => {
    const { style, warnings } = projectStyle(
      doc({
        sources: { sat: { type: "raster", tiles: ["https://x.test/{z}/{x}/{y}.png"] } },
        terrain: { source: "sat" },
      })
    );
    expect(style["terrain"]).toBeUndefined();
    expect(warnings[0]!.message).toContain("raster-dem");
  });
});

describe("mergeBasemap — document 3D wins over the basemap's", () => {
  const BASE = {
    version: 8,
    sources: {
      basetiles: { type: "vector", url: "https://tiles.test/v3.json" },
      baseDem: DEM,
    },
    layers: [{ id: "bg", type: "background" }],
    terrain: { source: "baseDem", exaggeration: 3 },
    sky: { "sky-color": "#000000" },
    projection: { type: "mercator" },
  };

  it("inherits the basemap's trio when the document authors none", () => {
    const merged = mergeBasemap(BASE, projectStyle(doc()));
    expect(merged.style["terrain"]).toEqual(BASE.terrain);
    expect(merged.style["sky"]).toEqual(BASE.sky);
    expect(merged.style["projection"]).toEqual(BASE.projection);
    expect(merged.warnings.filter((w) => w.construct === "terrain")).toEqual([]);
  });

  it("the document's value replaces the basemap's wholesale, with a contract note per key", () => {
    const projected = projectStyle(
      doc({
        config: { center: [0, 0], zoom: 2, mapStyle: "https://tiles.test/style.json" },
        terrain: { source: "terrainSource", exaggeration: 1 },
        sky: { "fog-color": "#ffffff" },
        projection: { type: "globe" },
      })
    );
    const merged = mergeBasemap(BASE, projected);
    expect(merged.style["terrain"]).toEqual({ source: "terrainSource", exaggeration: 1 });
    // Wholesale, not per-property: the basemap's sky-color does not leak in.
    expect(merged.style["sky"]).toEqual({ "fog-color": "#ffffff" });
    expect(merged.style["projection"]).toEqual({ type: "globe" });
    const notes = merged.warnings.filter((w) =>
      ["terrain", "sky", "projection"].includes(w.construct ?? "")
    );
    expect(notes.map((w) => [w.construct, w.kind])).toEqual([
      ["terrain", "contract"],
      ["sky", "contract"],
      ["projection", "contract"],
    ]);
    expect(validateStyleMin(merged.style as never)).toEqual([]);
  });

  it("a terrain naming a basemap-only source defers to the merge and resolves there", () => {
    const projected = projectStyle(
      doc({
        config: { center: [0, 0], zoom: 2, mapStyle: "https://tiles.test/style.json" },
        sources: {},
        terrain: { source: "baseDem" },
      })
    );
    expect(projected.warnings).toEqual([]);
    expect(projected.style["terrain"]).toEqual({ source: "baseDem" });
    const merged = mergeBasemap(BASE, projected);
    expect(merged.style["terrain"]).toEqual({ source: "baseDem" });
  });

  it("a terrain source that neither side declares is dropped at the merge as lossy", () => {
    const projected = projectStyle(
      doc({
        config: { center: [0, 0], zoom: 2, mapStyle: "https://tiles.test/style.json" },
        sources: {},
        terrain: { source: "ghost" },
      })
    );
    const merged = mergeBasemap(BASE, projected);
    expect(merged.style["terrain"]).toBeUndefined();
    expect(merged.warnings).toContainEqual(
      expect.objectContaining({ path: "terrain.source", kind: "lossy" })
    );
    expect(validateStyleMin(merged.style as never)).toEqual([]);
  });
});

describe("applyRuntimeGate — 3D against a declared target", () => {
  const projected = () =>
    projectStyle(doc({ sky: SKY, projection: { type: "globe" } }));

  it("globe and sky below their floors are reported lossy, keys kept (they validate on 4.x)", () => {
    const gated = applyRuntimeGate(projected(), { trust: "trusted", target: "4.4.0" });
    expect(gated.style["projection"]).toEqual({ type: "globe" });
    expect(gated.style["sky"]).toEqual(SKY);
    expect(
      gated.warnings.filter((w) => w.kind === "lossy").map((w) => w.construct)
    ).toEqual(["projection", "sky"]);
  });

  it("a 4.7 target keeps sky silent (>= 4.5.0) but reports globe", () => {
    const gated = applyRuntimeGate(projected(), { trust: "trusted", target: "4.7.1" });
    expect(gated.warnings.map((w) => w.construct)).toEqual(["projection"]);
    expect(gated.warnings[0]!.message).toContain("5.0.0");
  });

  it("a 5.x target and an undeclared target add nothing", () => {
    expect(
      applyRuntimeGate(projected(), { trust: "trusted", target: "5.24.0" }).warnings
    ).toEqual([]);
    expect(applyRuntimeGate(projected(), { trust: "trusted" }).warnings).toEqual([]);
  });

  it("mercator is never reported, whatever the target", () => {
    const gated = applyRuntimeGate(projectStyle(doc({ projection: { type: "mercator" } })), {
      trust: "trusted",
      target: "4.0.0",
    });
    expect(gated.warnings).toEqual([]);
  });
});
