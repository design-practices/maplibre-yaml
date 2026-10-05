/**
 * Emit lowering with the package loaded: the core projection runs each
 * effect's registered `fallback()` (the built-ins ship the static layer as
 * authored; an effect may declare absence with null).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { effectRegistry, registerBuiltins, installEffectsHost, registerEffect, backends, z } from "../src/index";
import { YAMLParser } from "../../core/src/parser";
import { toModel } from "../../core/src/model";
import { projectStyle, EmitError } from "../../core/src/emitter/project";
import { resetEffectsHostForTests } from "../../core/src/effects-host";

beforeAll(() => {
  resetEffectsHostForTests();
  registerBuiltins(effectRegistry);
  installEffectsHost();
  registerEffect({
    type: "decor-only",
    backend: backends.extrusions,
    params: z.object({}),
    fragment: "vec4 effect_color(EffectInput i) { return vec4(1.0); }",
    // no honest static form: declare absence
    fallback: () => null,
  });
});
afterAll(() => resetEffectsHostForTests());

const doc = (effect: string) =>
  toModel(
    YAMLParser.safeParseMapBlock(`type: map
id: fx
config: { center: [0, 0], zoom: 15 }
sources:
  omt: { type: vector, tiles: ["https://example.com/{z}/{x}/{y}.pbf"] }
layers:
  - id: buildings
    type: fill-extrusion
    source: omt
    source-layer: building
    paint: { fill-extrusion-color: "#ccc", fill-extrusion-height: 10 }
    effect: ${effect}
  - id: labels
    type: symbol
    source: omt
    source-layer: place
`).data as never
  );

describe("emit with the effects package loaded", () => {
  it("tonal-hatch ejects to its static layer, one lossy warning; strict refuses", () => {
    const model = doc("{ type: tonal-hatch, gain: 0.6 }");
    const result = projectStyle(model, "with-fallbacks");
    const layers = result.style["layers"] as Array<Record<string, unknown>>;
    expect(layers.map((l) => l["id"])).toEqual(["buildings", "labels"]);
    expect(layers[0]).not.toHaveProperty("effect");
    expect(result.warnings.filter((w) => w.kind === "lossy").map((w) => w.path)).toEqual([
      "layers.buildings.effect",
    ]);
    expect(() => projectStyle(model, "strict")).toThrow(EmitError);
  });

  it("an effect whose fallback is null declares absence: the layer is dropped", () => {
    const result = projectStyle(doc("{ type: decor-only }"), "with-fallbacks");
    expect((result.style["layers"] as Array<{ id: string }>).map((l) => l.id)).toEqual(["labels"]);
    expect(result.warnings.find((w) => w.construct === "layer.effect")?.message).toMatch(/declares no static form/);
  });
});
