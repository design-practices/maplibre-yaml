import { describe, it, expect } from "vitest";
import { EffectRegistry, z, backends, tonalHatch, blueprint, registerBuiltins } from "../src/index";
import type { EffectDefinition } from "../src/contract";

const minimal = (over: Partial<EffectDefinition<{ k: number }>> = {}): EffectDefinition<{ k: number }> => ({
  type: "test-fx",
  backend: backends.extrusions,
  params: z.object({ k: z.number().default(1) }),
  fragment: "vec4 effect_color(EffectInput i) { return vec4(1.0); }",
  fallback: (_p, layer) => layer,
  ...over,
});

describe("EffectRegistry (house registry pattern)", () => {
  it("registers and looks up; types() keeps registration order", () => {
    const r = new EffectRegistry();
    r.register(minimal());
    r.register(minimal({ type: "other-fx" }));
    expect(r.has("test-fx")).toBe(true);
    expect(r.get("test-fx")?.type).toBe("test-fx");
    expect(r.types()).toEqual(["test-fx", "other-fx"]);
  });

  it("throws on a duplicate type", () => {
    const r = new EffectRegistry();
    r.register(minimal());
    expect(() => r.register(minimal())).toThrow(/already registered/);
  });

  it("refuses an effect without a fallback (mandatory eject lowering)", () => {
    const r = new EffectRegistry();
    expect(() => r.register(minimal({ fallback: undefined as never }))).toThrow(/no fallback\(\)/);
  });

  it("refuses non-kebab types, missing backend/params, and a fragment without effect_color", () => {
    const r = new EffectRegistry();
    expect(() => r.register(minimal({ type: "Bad_Name" }))).toThrow(/kebab-case/);
    expect(() => r.register(minimal({ backend: undefined as never }))).toThrow(/no backend/);
    expect(() => r.register(minimal({ params: undefined as never }))).toThrow(/zod `params`/);
    expect(() => r.register(minimal({ fragment: "void main() {}" }))).toThrow(/effect_color/);
  });

  it("the built-ins are written against the same public contract", () => {
    const r = new EffectRegistry();
    registerBuiltins(r);
    expect(r.types()).toEqual(["tonal-hatch", "blueprint"]);
    for (const def of [tonalHatch, blueprint]) {
      expect(def.backend).toBe(backends.extrusions);
      expect(def.animated).toBe(false);
      // eject: the static layer ships as authored
      const layer = { id: "b", type: "fill-extrusion" };
      expect(def.fallback(def.params.parse({}) as never, layer)).toBe(layer);
    }
    // registerBuiltins is idempotent
    registerBuiltins(r);
    expect(r.types()).toHaveLength(2);
  });
});
