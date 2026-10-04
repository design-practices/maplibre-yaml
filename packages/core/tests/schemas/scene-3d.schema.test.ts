/**
 * @file Schemas for the 3D trio (U15): terrain, sky, projection — v1 and v2
 */

import { describe, it, expect } from "vitest";
import {
  TerrainSchema,
  SkySchema,
  ProjectionSchema,
  MapBlockSchema,
  MapFullPageBlockSchema,
  ControlsConfigSchema,
} from "../../src/schemas/map.schema";
import { MapBlockV2Schema } from "../../src/schemas/map-v2.schema";

const config = { center: [0, 0], zoom: 2 };

describe("TerrainSchema", () => {
  it("accepts the spec shape", () => {
    expect(TerrainSchema.parse({ source: "dem", exaggeration: 1.5 })).toEqual({
      source: "dem",
      exaggeration: 1.5,
    });
    expect(TerrainSchema.parse({ source: "dem" })).toEqual({ source: "dem" });
  });

  it("requires a non-empty source and a non-negative exaggeration", () => {
    expect(TerrainSchema.safeParse({}).success).toBe(false);
    expect(TerrainSchema.safeParse({ source: "" }).success).toBe(false);
    expect(TerrainSchema.safeParse({ source: "dem", exaggeration: -1 }).success).toBe(false);
  });
});

describe("SkySchema", () => {
  it("accepts every spec property as a value or a zoom expression", () => {
    const sky = {
      "sky-color": "#199EF3",
      "horizon-color": ["interpolate", ["linear"], ["zoom"], 0, "#fff", 10, "#000"],
      "fog-color": "white",
      "sky-horizon-blend": 0.5,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.1,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 7, 0],
    };
    expect(SkySchema.parse(sky)).toEqual(sky);
  });

  it("rejects a blend outside 0-1", () => {
    expect(SkySchema.safeParse({ "fog-ground-blend": 2 }).success).toBe(false);
  });
});

describe("ProjectionSchema", () => {
  it("accepts mercator and globe", () => {
    expect(ProjectionSchema.parse({ type: "globe" })).toEqual({ type: "globe" });
    expect(ProjectionSchema.parse({ type: "mercator" })).toEqual({ type: "mercator" });
  });

  it("rejects an unknown projection and the bare-string shorthand", () => {
    expect(ProjectionSchema.safeParse({ type: "albers" }).success).toBe(false);
    expect(ProjectionSchema.safeParse("globe").success).toBe(false);
  });
});

describe("the trio is a document-root key in v1 and a style key in v2", () => {
  const trio = {
    terrain: { source: "dem" },
    sky: { "sky-color": "#00f" },
    projection: { type: "globe" },
  };

  it("v1 map and map-fullpage blocks accept it at the root", () => {
    const map = MapBlockSchema.parse({ type: "map", id: "m", config, ...trio });
    expect(map["terrain"]).toEqual(trio.terrain);
    expect(map["projection"]).toEqual(trio.projection);
    const full = MapFullPageBlockSchema.parse({
      type: "map-fullpage",
      id: "m",
      config,
      ...trio,
    });
    expect(full["sky"]).toEqual(trio.sky);
  });

  it("v2 accepts it under style:", () => {
    const v2 = MapBlockV2Schema.parse({
      version: 2,
      type: "map",
      id: "m",
      style: { ...config, ...trio },
    });
    expect(v2["style"].terrain).toEqual(trio.terrain);
    expect(v2["style"].projection).toEqual(trio.projection);
  });
});

describe("controls.globe / controls.terrain", () => {
  it("accept the same boolean-or-options shape as every other control", () => {
    expect(
      ControlsConfigSchema.parse({ globe: true, terrain: { enabled: true, position: "top-left" } })
    ).toEqual({ globe: true, terrain: { enabled: true, position: "top-left" } });
  });
});
