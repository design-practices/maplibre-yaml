/**
 * @file `*-pattern` paint properties accept expressions (ml-gjf)
 *
 * The style spec lets fill-, line- and fill-extrusion-pattern be data-driven
 * and background-pattern zoom-driven; the schema typed all four as plain
 * strings, so a `match` over a feature property failed validation even
 * though the emitter already rewrote image names inside expressions.
 */
import { describe, it, expect } from "vitest";
import {
  FillLayerSchema,
  LineLayerSchema,
  FillExtrusionLayerSchema,
  BackgroundLayerSchema,
} from "../../src/schemas/layer.schema";
import { YAMLParser } from "../../src/parser";
import { toModel } from "../../src/model/to-model";
import { projectStyle } from "../../src/emitter/project";

const source = { type: "geojson" as const, data: { type: "FeatureCollection", features: [] } };
const byTone = ["match", ["get", "tone"], "dark", "hatch-dark", "hatch-light"];

describe("*-pattern accepts literals and expressions", () => {
  it.each([
    ["fill", FillLayerSchema, "fill-pattern"],
    ["line", LineLayerSchema, "line-pattern"],
    ["fill-extrusion", FillExtrusionLayerSchema, "fill-extrusion-pattern"],
  ] as const)("%s: data-driven match and a literal both validate", (type, schema, prop) => {
    for (const value of [byTone, "hatch-light"]) {
      const layer = { id: "l", type, source, paint: { [prop]: value } };
      const result = schema.safeParse(layer);
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect((result as { data: { paint: Record<string, unknown> } }).data.paint[prop]).toEqual(
        value
      );
    }
  });

  it("background: a zoom step and a literal both validate", () => {
    for (const value of [["step", ["zoom"], "coarse", 14, "fine"], "coarse"]) {
      const result = BackgroundLayerSchema.safeParse({
        id: "bg",
        type: "background",
        paint: { "background-pattern": value },
      });
      expect(result.success).toBe(true);
    }
  });

  it("non-string, non-expression values are still rejected", () => {
    expect(
      FillLayerSchema.safeParse({ id: "l", type: "fill", source, paint: { "fill-pattern": 42 } })
        .success
    ).toBe(false);
  });

  it("a whole document with a data-driven fill-pattern parses (the bead's repro)", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: tones
config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" }
images:
  hatch-dark: "https://example.com/dark.png"
  hatch-light: "https://example.com/light.png"
sources:
  s: { type: geojson, data: { type: FeatureCollection, features: [] } }
layers:
  - id: tones
    type: fill
    source: s
    paint:
      fill-pattern: [match, [get, tone], dark, hatch-dark, hatch-light]
`);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
  });
});

describe("data-driven patterns on emit", () => {
  const emit = (pattern: unknown) => {
    const parsed = YAMLParser.safeParseMapBlock(`
type: map
id: tones
config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" }
images:
  hatch-dark: "https://example.com/dark.png"
  hatch-light: "https://example.com/light.png"
sources:
  s: { type: geojson, data: { type: FeatureCollection, features: [] } }
layers:
  - id: tones
    type: fill
    source: s
    paint:
      fill-pattern: ${JSON.stringify(pattern)}
`);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    return projectStyle(toModel(parsed.data as never), "strict");
  };

  it("a match over feature data rewrites every output and warns about nothing", () => {
    const { style, warnings } = emit(byTone);
    const layer = (style["layers"] as Record<string, any>[])[0]!;
    expect(layer["paint"]["fill-pattern"]).toEqual([
      "match",
      ["get", "tone"],
      "dark",
      "mlym:hatch-dark",
      "mlym:hatch-light",
    ]);
    // The `["get", "tone"]` INPUT selects among literal names — it is not a
    // dynamic image name, so there is no live/export divergence to report.
    expect(warnings).toEqual([]);
  });

  it("a name computed from data at an OUTPUT position still warns (contract)", () => {
    const { warnings } = emit(["match", ["get", "tone"], "dark", ["get", "img"], "hatch-light"]);
    expect(warnings.map((w) => [w.path, w.kind])).toEqual([
      ["layers.tones.fill-pattern", "contract"],
    ]);
  });
});
