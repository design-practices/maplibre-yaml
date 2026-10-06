/**
 * @file Export-class registry: contract + closed-world exhaustiveness (U3)
 *
 * @description
 * The exhaustiveness block is the load-bearing part: it recomputes the
 * construct list from the model's own key boundaries, so a new runtime key
 * added anywhere in the format fails here until it declares an export class.
 */

import { describe, it, expect } from "vitest";
import { ExportClassRegistry } from "../../src/export/registry";
import { exportClasses } from "../../src/export/registrations";
import {
  LAYER_RUNTIME_KEYS,
  SOURCE_RUNTIME_KEYS,
} from "../../src/model/normalize";

describe("ExportClassRegistry contract", () => {
  it("throws on duplicate registration", () => {
    const registry = new ExportClassRegistry();
    registry.register("thing", { class: "exports", onEmit: "compiles." });
    expect(() =>
      registry.register("thing", { class: "exports", onEmit: "again." })
    ).toThrow(/already registered/);
  });

  it("refuses an exports-with-fallback class without an export()", () => {
    const registry = new ExportClassRegistry();
    expect(() =>
      registry.register("fx", { class: "exports-with-fallback", onEmit: "lowers." })
    ).toThrow(/without an export\(\)/);
  });

  it("refuses an export() on any other class", () => {
    const registry = new ExportClassRegistry();
    expect(() =>
      registry.register("chrome", {
        class: "no-export",
        onEmit: "absent.",
        export: () => ({}),
      })
    ).toThrow(/only "exports-with-fallback" constructs lower/);
  });

  it("require() throws loudly for an unregistered construct", () => {
    const registry = new ExportClassRegistry();
    expect(() => registry.require("layer.mystery")).toThrow(
      /no registered export class/
    );
  });
});

describe("closed-world exhaustiveness (R4)", () => {
  it("every layer runtime key has a registered export class", () => {
    for (const key of LAYER_RUNTIME_KEYS) {
      expect(
        exportClasses.has(`layer.${key}`),
        `layer.${key} has no export-class registration`
      ).toBe(true);
    }
  });

  it("every source runtime key has a registered export class", () => {
    for (const key of SOURCE_RUNTIME_KEYS) {
      expect(
        exportClasses.has(`source.${key}`),
        `source.${key} has no export-class registration`
      ).toBe(true);
    }
  });

  it("layer.effect is an exports-with-fallback construct (experimental effects, U13′)", () => {
    expect(LAYER_RUNTIME_KEYS).toContain("effect");
    const definition = exportClasses.get("layer.effect");
    expect(definition?.class).toBe("exports-with-fallback");
    // The fallback is the static layer itself: export() hands it back with
    // one lossy warning.
    const lowered = definition!.export!({
      path: "layers.buildings",
      value: {
        layer: { id: "buildings", type: "fill-extrusion", source: "omt" },
        effect: { type: "tonal-hatch", gain: 0.7 },
      },
    });
    expect(lowered.layers).toEqual([
      { id: "buildings", type: "fill-extrusion", source: "omt" },
    ]);
    expect(lowered.warnings).toHaveLength(1);
    expect(lowered.warnings![0]!.kind).toBe("lossy");
  });

  it("every root runtime construct has a registered export class", () => {
    // The RuntimeHalf fields (model/types.ts) plus the two document-level
    // constructs the emitter handles specially. If RuntimeHalf grows a field,
    // add it here AND register it — this list is deliberately literal so the
    // diff that adds the field touches the doctrine too.
    for (const construct of [
      "map.options",
      "controls",
      "legend",
      "container",
      "parameters",
      "markers",
      "fitTo",
      "popups",
      "state",
      "images",
      "terrain",
      "sky",
      "projection",
      "color-relief",
      "light",
      "x-*",
    ]) {
      expect(
        exportClasses.has(construct),
        `${construct} has no export-class registration`
      ).toBe(true);
    }
  });

  it("every registration carries a non-empty author-facing onEmit", () => {
    for (const [construct, definition] of exportClasses.entries()) {
      expect(definition.onEmit.length, `${construct} has an empty onEmit`).toBeGreaterThan(
        20
      );
    }
  });
});
