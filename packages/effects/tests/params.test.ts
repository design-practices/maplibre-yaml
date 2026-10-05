/**
 * Params validation: the registry's own check, and the integration that
 * matters to authors — core's YAML parser reporting bad params with line
 * numbers once the package is registered.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateEffect, effectRegistry, registerBuiltins, installEffectsHost, tonalHatch } from "../src/index";
// core's source, not its dist: the effects host is found through the
// realm-wide slot, not through an import.
import { YAMLParser } from "../../core/src/parser";
import { getEffectsHost, resetEffectsHostForTests } from "../../core/src/effects-host";

beforeAll(() => {
  resetEffectsHostForTests();
  registerBuiltins(effectRegistry);
  installEffectsHost();
});
afterAll(() => resetEffectsHostForTests());

describe("validateEffect", () => {
  it("accepts defaults and fills them in", () => {
    expect(validateEffect({ type: "tonal-hatch" })).toEqual([]);
    expect(tonalHatch.params.parse({})).toEqual({
      ink: "#4d4d4e",
      paper: "#f9f3e3",
      atlas: "hatch-atlas",
      gain: 0.72,
      outline: 0.85,
      exaggerate: false,
    });
  });

  it("reports a bad param with its path", () => {
    const issues = validateEffect({ type: "blueprint", grid: -2 });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(["grid"]);
  });

  it("refuses unknown params (typo protection) and unknown types", () => {
    expect(validateEffect({ type: "tonal-hatch", gian: 1 })[0]!.message).toMatch(/Unrecognized key/);
    const unknown = validateEffect({ type: "tonal-hach" });
    expect(unknown[0]!.path).toEqual(["type"]);
    expect(unknown[0]!.message).toMatch(/Registered effects: tonal-hatch, blueprint/);
  });

  it("rejects a non-hex color", () => {
    expect(validateEffect({ type: "tonal-hatch", ink: "black" })[0]!.message).toMatch(/hex color/);
  });
});

const DOC = (effect: string) => `type: map
id: fx
config:
  center: [-74.01, 40.70]
  zoom: 15
  mapStyle: "https://example.com/style.json"
layers:
  - id: buildings
    type: fill-extrusion
    source: { type: vector, url: "https://example.com/tiles.json" }
    source-layer: building
    paint:
      fill-extrusion-height: ["get", "render_height"]
    effect:
${effect}
`;

describe("core parses `effect:` against the registered schema (package loaded)", () => {
  it("the host is visible to core through the shared slot", () => {
    expect(getEffectsHost()?.types()).toEqual(["tonal-hatch", "blueprint"]);
  });

  it("valid params parse, with no not-loaded warning", () => {
    const r = YAMLParser.safeParseMapBlock(DOC("      type: tonal-hatch\n      gain: 0.6"));
    expect(r.success, JSON.stringify(r.errors)).toBe(true);
    expect(r.warnings.filter((w) => w.kind === "unimplemented")).toEqual([]);
  });

  it("a bad param is a line-numbered parse error", () => {
    const r = YAMLParser.safeParseMapBlock(DOC("      type: blueprint\n      grid: zero"));
    expect(r.success).toBe(false);
    const e = r.errors.find((x) => x.path.endsWith("effect.grid"));
    expect(e, JSON.stringify(r.errors)).toBeDefined();
    expect(e!.line).toBe(16);
    expect(e!.message).toMatch(/blueprint: Expected number/);
  });

  it("an unknown effect type is a line-numbered parse error", () => {
    const r = YAMLParser.safeParseMapBlock(DOC("      type: crosshatch"));
    expect(r.success).toBe(false);
    const e = r.errors.find((x) => x.path.endsWith("effect.type"));
    expect(e!.line).toBe(15);
    expect(e!.message).toMatch(/Unknown effect "crosshatch"/);
  });
});
