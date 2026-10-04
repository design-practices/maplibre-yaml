/**
 * @file Eject-class registry: contract + closed-world exhaustiveness (U3)
 *
 * @description
 * The exhaustiveness block is the load-bearing part: it recomputes the
 * construct list from the model's own key boundaries, so a new runtime key
 * added anywhere in the format fails here until it declares an eject class.
 */

import { describe, it, expect } from "vitest";
import { EjectClassRegistry } from "../../src/eject/registry";
import { ejectClasses } from "../../src/eject/registrations";
import {
  LAYER_RUNTIME_KEYS,
  SOURCE_RUNTIME_KEYS,
} from "../../src/model/normalize";

describe("EjectClassRegistry contract", () => {
  it("throws on duplicate registration", () => {
    const registry = new EjectClassRegistry();
    registry.register("thing", { class: "ejects", onEmit: "compiles." });
    expect(() =>
      registry.register("thing", { class: "ejects", onEmit: "again." })
    ).toThrow(/already registered/);
  });

  it("refuses a fallback class without an eject()", () => {
    const registry = new EjectClassRegistry();
    expect(() =>
      registry.register("fx", { class: "fallback", onEmit: "lowers." })
    ).toThrow(/without an eject\(\)/);
  });

  it("refuses an eject() on a non-fallback class", () => {
    const registry = new EjectClassRegistry();
    expect(() =>
      registry.register("chrome", {
        class: "declared-absence",
        onEmit: "absent.",
        eject: () => ({}),
      })
    ).toThrow(/only "fallback" constructs lower/);
  });

  it("require() throws loudly for an unregistered construct", () => {
    const registry = new EjectClassRegistry();
    expect(() => registry.require("layer.mystery")).toThrow(
      /no registered eject class/
    );
  });
});

describe("closed-world exhaustiveness (R4)", () => {
  it("every layer runtime key has a registered eject class", () => {
    for (const key of LAYER_RUNTIME_KEYS) {
      expect(
        ejectClasses.has(`layer.${key}`),
        `layer.${key} has no eject-class registration`
      ).toBe(true);
    }
  });

  it("every source runtime key has a registered eject class", () => {
    for (const key of SOURCE_RUNTIME_KEYS) {
      expect(
        ejectClasses.has(`source.${key}`),
        `source.${key} has no eject-class registration`
      ).toBe(true);
    }
  });

  it("every root runtime construct has a registered eject class", () => {
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
      "color-relief",
      "x-*",
    ]) {
      expect(
        ejectClasses.has(construct),
        `${construct} has no eject-class registration`
      ).toBe(true);
    }
  });

  it("every registration carries a non-empty author-facing onEmit", () => {
    for (const [construct, definition] of ejectClasses.entries()) {
      expect(definition.onEmit.length, `${construct} has an empty onEmit`).toBeGreaterThan(
        20
      );
    }
  });
});
