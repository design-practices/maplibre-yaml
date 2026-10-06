/**
 * @file `light:` — the style-spec root light, end to end (U10′)
 *
 * Schema (v1 root + v2 style half, closed object), model parity (AE2),
 * emit (compiles through verbatim, spec-valid, no warning), basemap merge
 * (the document's light wins over an inherited one), and the export-class
 * registration (`exports`).
 */
import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { denormalizeOptions } from "../../src/model";
import { projectStyle, mergeBasemap } from "../../src/emitter";
import { LightSchema } from "../../src/schemas/map.schema";
import { exportClasses } from "../../src/export";

const BASEMAP = "https://demotiles.maplibre.org/style.json";

function parse(yaml: string) {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) {
    throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  }
  return toModel(result.data as never);
}

const V1 = `
type: map
id: lit
config:
  center: [-74.01, 40.71]
  zoom: 15
  mapStyle: ${BASEMAP}
light:
  anchor: map
  position: [1.5, 210, 30]
  color: "#fff6e0"
  intensity: 0.6
`;

const V2 = `
version: 2
type: map
id: lit
style:
  basemap: ${BASEMAP}
  center: [-74.01, 40.71]
  zoom: 15
  light:
    anchor: map
    position: [1.5, 210, 30]
    color: "#fff6e0"
    intensity: 0.6
`;

describe("LightSchema", () => {
  it("accepts every spec property, literal or zoom expression", () => {
    expect(LightSchema.safeParse({}).success).toBe(true);
    expect(
      LightSchema.safeParse({
        anchor: "viewport",
        position: [1.15, 210, 30],
        color: "white",
        intensity: 0.5,
      }).success
    ).toBe(true);
    expect(
      LightSchema.safeParse({
        intensity: ["interpolate", ["linear"], ["zoom"], 13, 0.3, 18, 0.6],
        position: ["literal", [1.15, 210, 30]],
      }).success
    ).toBe(true);
  });

  it("rejects out-of-range values, wrong shapes, and unknown keys", () => {
    expect(LightSchema.safeParse({ anchor: "sky" }).success).toBe(false);
    expect(LightSchema.safeParse({ position: [1, 2] }).success).toBe(false);
    expect(LightSchema.safeParse({ intensity: 2 }).success).toBe(false);
    // A typo is loud, never a silently ignored setting.
    expect(LightSchema.safeParse({ intensty: 0.5 }).success).toBe(false);
  });
});

describe("light: model", () => {
  it("v1 root light and v2 style.light normalize deep-equal (AE2)", () => {
    const v1 = parse(V1);
    expect(v1.style.light).toEqual({
      anchor: "map",
      position: [1.5, 210, 30],
      color: "#fff6e0",
      intensity: 0.6,
    });
    expect(parse(V2)).toEqual(v1);
  });

  it("reaches the renderer options (applied live with map.setLight)", () => {
    expect(denormalizeOptions(parse(V1)).light).toEqual(parse(V1).style.light);
  });

  it("is absent from the model when the document declares none", () => {
    const m = parse(`
type: map
id: dark
config: { center: [0, 0], zoom: 2, mapStyle: ${BASEMAP} }
`);
    expect(m.style.light).toBeUndefined();
    expect(denormalizeOptions(m).light).toBeUndefined();
  });
});

describe("light: emit", () => {
  it("compiles through verbatim to a spec-valid style root, with no warning", () => {
    const { style, warnings } = projectStyle(parse(V1), "strict");
    expect(style["light"]).toEqual({
      anchor: "map",
      position: [1.5, 210, 30],
      color: "#fff6e0",
      intensity: 0.6,
    });
    expect(warnings).toEqual([]);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("the document's light replaces a basemap light on merge", () => {
    const base = {
      version: 8,
      light: { intensity: 0.1 },
      sources: {},
      layers: [],
    };
    const { style } = mergeBasemap(base, projectStyle(parse(V1)));
    expect((style["light"] as { intensity: number }).intensity).toBe(0.6);
  });

  it("a document without light inherits the basemap's", () => {
    const base = { version: 8, light: { intensity: 0.1 }, sources: {}, layers: [] };
    const doc = parse(`
type: map
id: dark
config: { center: [0, 0], zoom: 2, mapStyle: ${BASEMAP} }
`);
    const { style } = mergeBasemap(base, projectStyle(doc));
    expect(style["light"]).toEqual({ intensity: 0.1 });
  });

  it("is registered as class `exports`", () => {
    expect(exportClasses.require("light").class).toBe("exports");
  });
});
