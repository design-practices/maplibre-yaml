/**
 * @file The experimental `effect:` layer key in core (U13′, ml-vw4.2)
 *
 * @description
 * Core owns the key's schema, its eject class, and its emit lowering, but
 * never the effects package: everything here runs against a fake host
 * registered through the same hook `@maplibre-yaml/effects/register` uses.
 */

import { describe, it, expect, afterEach } from "vitest";
import { YAMLParser } from "../../src/parser";
import { toModel } from "../../src/model";
import { projectStyle, EmitError } from "../../src/emitter/project";
import {
  registerEffectsHost,
  getEffectsHost,
  onEffectsHost,
  resetEffectsHostForTests,
  type EffectsHost,
  type EffectBlock,
} from "../../src/effects-host";

const V1 = `type: map
id: fx
config:
  center: [-74.01, 40.70]
  zoom: 15
  mapStyle: "https://example.com/style.json"
sources:
  omt:
    type: vector
    tiles: ["https://example.com/{z}/{x}/{y}.pbf"]
layers:
  - id: buildings
    type: fill-extrusion
    source: omt
    source-layer: building
    paint:
      fill-extrusion-color: "#cccccc"
      fill-extrusion-height: ["get", "render_height"]
    effect:
      type: tonal-hatch
      gain: 0.72
`;

const V2 = `version: 2
type: map
id: fx
style:
  center: [-74.01, 40.70]
  zoom: 15
  basemap: "https://example.com/style.json"
  sources:
    omt:
      type: vector
      tiles: ["https://example.com/{z}/{x}/{y}.pbf"]
  layers:
    - id: buildings
      type: fill-extrusion
      source: omt
      source-layer: building
      paint:
        fill-extrusion-color: "#cccccc"
        fill-extrusion-height: ["get", "render_height"]
      runtime:
        effect:
          type: tonal-hatch
          gain: 0.72
`;

/** A minimal host: tonal-hatch takes a numeric `gain` in [0, 2]. */
function fakeHost(overrides: Partial<EffectsHost> = {}): EffectsHost {
  return {
    apiVersion: 1,
    types: () => ["tonal-hatch"],
    validate(effect: EffectBlock) {
      if (effect.type !== "tonal-hatch") {
        return [{ path: ["type"], message: `Unknown effect "${effect.type}"` }];
      }
      const gain = effect["gain"];
      if (gain !== undefined && (typeof gain !== "number" || gain < 0 || gain > 2)) {
        return [{ path: ["gain"], message: "gain must be a number in [0, 2]" }];
      }
      return [];
    },
    attach: () => ({ detach() {} }),
    lower: (_effect, layer) => layer,
    ...overrides,
  };
}

afterEach(() => resetEffectsHostForTests());

describe("effect: schema (v1 and v2)", () => {
  it("parses a v1 layer-level effect and lands it in the layer's runtime half", () => {
    const result = YAMLParser.safeParseMapBlock(V1);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const model = toModel(result.data as never);
    const layer = model.style.layers[0]!;
    expect(layer.runtime["effect"]).toEqual({ type: "tonal-hatch", gain: 0.72 });
    expect(layer.spec).not.toHaveProperty("effect");
  });

  it("v2 `runtime.effect` normalizes to the same model as v1 (AE2)", () => {
    const v1 = YAMLParser.safeParseMapBlock(V1);
    const v2 = YAMLParser.safeParseMapBlock(V2);
    expect(v2.success, JSON.stringify(v2.errors)).toBe(true);
    expect(toModel(v2.data as never).style.layers).toEqual(
      toModel(v1.data as never).style.layers
    );
  });

  it("without the effects package: passthrough + one unimplemented warning, never an error", () => {
    const result = YAMLParser.safeParseMapBlock(V1);
    expect(result.success).toBe(true);
    const fx = result.warnings.filter((w) => w.path.endsWith(".effect"));
    expect(fx).toHaveLength(1);
    expect(fx[0]!.kind).toBe("unimplemented");
    expect(fx[0]!.message).toMatch(/"tonal-hatch" is not loaded/);
    expect(fx[0]!.message).toMatch(/@maplibre-yaml\/effects\/register/);
    expect(fx[0]!.line).toBe(19);
    // Params are the effect's vocabulary, not unknown keys.
    expect(result.warnings.some((w) => /Unknown key "gain"/.test(w.message))).toBe(false);
  });

  it("v2 runtime.effect also warns once without the package", () => {
    const result = YAMLParser.safeParseMapBlock(V2);
    const fx = result.warnings.filter((w) => w.kind === "unimplemented");
    expect(fx).toHaveLength(1);
  });

  it("with a host: params validate against the registered schema, with line numbers", () => {
    registerEffectsHost(fakeHost());
    const bad = V1.replace("gain: 0.72", 'gain: "loud"');
    const result = YAMLParser.safeParseMapBlock(bad);
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path.endsWith("effect.gain"));
    expect(error, JSON.stringify(result.errors)).toBeDefined();
    expect(error!.message).toMatch(/gain must be a number/);
    expect(error!.line).toBe(21);
    // and the not-loaded warning is gone
    expect(YAMLParser.safeParseMapBlock(V1).warnings.some((w) => w.kind === "unimplemented")).toBe(false);
  });

  it("with a host: an unknown effect type is a positioned error", () => {
    registerEffectsHost(fakeHost());
    const result = YAMLParser.safeParseMapBlock(V1.replace("tonal-hatch", "tonal-hach"));
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path.endsWith("effect.type"));
    expect(error?.message).toMatch(/Unknown effect "tonal-hach"/);
    expect(error?.line).toBe(20);
  });

  it("an effect block without a type is an error even without a host", () => {
    const result = YAMLParser.safeParseMapBlock(V1.replace("      type: tonal-hatch\n", ""));
    expect(result.success).toBe(false);
  });
});

describe("effects host hook", () => {
  it("is one slot per realm, refuses a second different host, and notifies late subscribers", () => {
    const seen: EffectsHost[] = [];
    const unsubscribe = onEffectsHost((h) => seen.push(h));
    const host = fakeHost();
    registerEffectsHost(host);
    expect(getEffectsHost()).toBe(host);
    expect(seen).toEqual([host]);
    registerEffectsHost(host); // idempotent for the same host
    expect(() => registerEffectsHost(fakeHost())).toThrow(/already registered/);
    unsubscribe();
    // an already-registered host notifies synchronously
    const late: EffectsHost[] = [];
    onEffectsHost((h) => late.push(h));
    expect(late).toEqual([host]);
  });
});

describe("emit lowering (layer.effect, class fallback)", () => {
  const model = () => toModel(YAMLParser.safeParseMapBlock(V1).data as never);

  it("--with-fallbacks: one lossy warning per effect; the static layer ships; no effect key", () => {
    const result = projectStyle(model(), "with-fallbacks");
    const fx = result.warnings.filter((w) => w.construct === "layer.effect");
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({
      path: "layers.buildings.effect",
      kind: "lossy",
      ejectClass: "fallback",
    });
    expect(fx[0]!.message).toMatch(/tonal-hatch/);
    const layers = result.style["layers"] as Record<string, unknown>[];
    expect(layers.map((l) => l["id"])).toEqual(["buildings"]);
    expect(JSON.stringify(result.style)).not.toContain('"effect"');
  });

  it("--strict refuses a document with an effect", () => {
    expect(() => projectStyle(model(), "strict")).toThrow(EmitError);
  });

  it("a registered fallback may adjust the static layer", () => {
    registerEffectsHost(
      fakeHost({
        lower: (_effect, layer) => ({
          ...layer,
          paint: { ...(layer["paint"] as object), "fill-extrusion-color": "#000000" },
        }),
      })
    );
    const layers = projectStyle(model(), "with-fallbacks").style["layers"] as Array<{
      paint: Record<string, unknown>;
    }>;
    expect(layers[0]!.paint["fill-extrusion-color"]).toBe("#000000");
  });

  it("a fallback returning null declares absence: the layer is dropped, still lossy", () => {
    registerEffectsHost(fakeHost({ lower: () => null }));
    const result = projectStyle(model(), "with-fallbacks");
    expect(result.style["layers"]).toEqual([]);
    const fx = result.warnings.find((w) => w.construct === "layer.effect");
    expect(fx?.kind).toBe("lossy");
    expect(fx?.message).toMatch(/declares no static form/);
  });
});
