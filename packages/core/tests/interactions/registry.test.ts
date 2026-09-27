/**
 * @file Tests for the interaction registry
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * The registry's contract is closed-world, default-deny: the built-in
 * interactions are seeded by name from the fixed allowlist, an unknown name
 * resolves to a denial with a warning (never a handler), and the click/hover
 * grouping and dispatch order — popup before flyTo — survive the registry
 * rather than living in a separate array. Mirrors the ExtensionRegistry
 * decision that a registry is an instance, not a module singleton, so two
 * documents or two tests get independent state.
 */

import { describe, it, expect, vi } from "vitest";

// The interactions barrel now re-exports `attachInteractions`, which imports the
// maplibre-gl `Popup` value at module load. Polyfill the object-URL API the
// bundle touches on import so the real module loads under jsdom (same shim the
// renderer conformance suites use).
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:registry-test";
  w.URL.revokeObjectURL ??= () => {};
});

import {
  InteractionRegistry,
  createInteractionRegistry,
  type InteractionDenial,
} from "../../src/interactions";
import type { Interaction } from "../../src/interactions";
// The authoring helper is deliberately off the public barrel (see barrel.test);
// import it from the internal path to hand-build interactions for these tests.
import { defineInteraction } from "../../src/interactions/types";

/** A minimal built-in with a given name, for registry-shape assertions. */
const stub = (name: string): Interaction =>
  defineInteraction({
    name,
    select: (t) => t?.[name],
    create: () => ({ run: () => {} }),
  });

/** A resolution is a denial when it carries the `denied` discriminant. */
const isDenied = (
  result: Interaction | InteractionDenial
): result is InteractionDenial => "denied" in result;

describe("InteractionRegistry — resolution", () => {
  it("resolves each built-in name to its handler", () => {
    const registry = createInteractionRegistry();

    for (const name of ["popup", "flyTo", "zoomToFeature", "highlight"]) {
      const result = registry.resolve(name);
      expect(isDenied(result)).toBe(false);
      expect((result as Interaction).name).toBe(name);
    }
  });

  it("denies a name not on the allowlist with a warning and no handler", () => {
    const registry = createInteractionRegistry();

    const result = registry.resolve("evilEval");
    expect(isDenied(result)).toBe(true);
    const denial = result as InteractionDenial;
    expect(denial.denied).toBe(true);
    expect(denial.warning).toMatch(/evilEval/);
    // A denial carries no `create`/`select` — nothing is runnable.
    expect((denial as unknown as Interaction).create).toBeUndefined();
  });

  it("reports allowlist membership via has()", () => {
    const registry = createInteractionRegistry();
    expect(registry.has("popup")).toBe(true);
    expect(registry.has("highlight")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });
});

describe("InteractionRegistry — order is behavior", () => {
  it("preserves click dispatch order: popup before the camera interactions", () => {
    const registry = createInteractionRegistry();
    expect(registry.clickInteractions().map((i) => i.name)).toEqual([
      "popup",
      "flyTo",
      "zoomToFeature",
      "emit",
    ]);
  });

  it("returns the hover set in order", () => {
    const registry = createInteractionRegistry();
    expect(registry.hoverInteractions().map((i) => i.name)).toEqual([
      "highlight",
      "emit",
      "popup",
    ]);
  });

  it("resolves click members ahead of hover members by name", () => {
    const registry = createInteractionRegistry();
    // The ordered click set drives dispatch; popup's position precedes flyTo's.
    const order = registry.clickInteractions().map((i) => i.name);
    expect(order.indexOf("popup")).toBeLessThan(order.indexOf("flyTo"));
  });
});

describe("InteractionRegistry — instance, not singleton", () => {
  it("gives two registries independent instances", () => {
    const a = createInteractionRegistry();
    const b = createInteractionRegistry();
    // Distinct registry instances, not a shared module singleton — the
    // ExtensionRegistry decision. The resolved *definitions* are legitimately
    // the same shared built-in constants (per-handler state comes from
    // `create()`, not from cloning), so instance identity is what matters here.
    expect(a).not.toBe(b);
    expect(a.resolve("popup")).toBe(b.resolve("popup"));
  });

  it("seeds the same fixed allowlist in each fresh instance", () => {
    const a = new InteractionRegistry();
    const b = new InteractionRegistry();
    const names = (r: InteractionRegistry) => [
      ...r.clickInteractions().map((i) => i.name),
      ...r.hoverInteractions().map((i) => i.name),
    ];
    expect(names(a)).toEqual([
      "popup",
      "flyTo",
      "zoomToFeature",
      "emit",
      "highlight",
      "emit",
      "popup",
    ]);
    expect(names(a)).toEqual(names(b));
  });
});

describe("InteractionRegistry — a name may sit on both triggers", () => {
  it('accepts "emit" once in click AND once in hover without throwing', () => {
    // The settled contract: "emit" is one logical interaction key valid on both
    // triggers, each with its own runtime. The same name appearing once per
    // trigger list is allowed — it is not a collision.
    expect(
      () => new InteractionRegistry([stub("emit")], [stub("emit")])
    ).not.toThrow();
  });

  it("dedups a cross-trigger name to a single allowlist membership", () => {
    // byName is the trigger-agnostic closed-world allowlist: "emit" is a valid
    // key on click and hover, so it is present once. has()/resolve() test
    // membership, not which trigger's runtime.
    const registry = createInteractionRegistry();
    expect(registry.has("emit")).toBe(true);
    const result = registry.resolve("emit");
    expect(isDenied(result)).toBe(false);
    expect((result as Interaction).name).toBe("emit");
  });

  it("still throws on a genuine duplicate WITHIN the click list", () => {
    expect(() => new InteractionRegistry([stub("dup"), stub("dup")], [])).toThrow(
      /registered twice/
    );
  });

  it("still throws on a genuine duplicate WITHIN the hover list", () => {
    expect(() => new InteractionRegistry([], [stub("dup"), stub("dup")])).toThrow(
      /registered twice/
    );
  });
});
