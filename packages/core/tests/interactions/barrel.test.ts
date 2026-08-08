import { describe, it, expect } from "vitest";
import {
  CLICK_INTERACTIONS,
  HOVER_INTERACTIONS,
  HOVER_FEATURE_STATE_KEY,
  defineInteraction,
  stateless,
  type Interaction,
  type InteractionContext,
  type InteractionDeps,
  type InteractionRuntime,
} from "../../src/interactions";

// Smoke test: the public barrel resolves and its runtime + type surface are
// present. Behavior is characterized by the renderer suites; this only guards
// the move — that every currently-exported symbol still exports by name.
describe("interactions barrel", () => {
  it("exposes the built-in registries", () => {
    expect(CLICK_INTERACTIONS.map((i) => i.name)).toEqual(["popup", "flyTo"]);
    expect(HOVER_INTERACTIONS.map((i) => i.name)).toEqual(["highlight"]);
    expect(HOVER_FEATURE_STATE_KEY).toBe("hover");
  });

  it("exposes the registry helpers", () => {
    expect(typeof defineInteraction).toBe("function");
    expect(typeof stateless).toBe("function");
  });

  it("keeps the type surface importable and structurally usable", () => {
    // Purely a type/exports check — if any of these interfaces stopped being
    // exported by name, this file would fail to type-check.
    const noop: InteractionDeps = { showPopup: () => {} };
    const iface: Interaction<boolean> = {
      name: "probe",
      select: (t) => t,
      create: (_deps: InteractionDeps): InteractionRuntime<boolean> => ({
        run: (_config: boolean, _ctx: InteractionContext) => {},
      }),
    };
    expect(iface.create(noop)).toBeDefined();
  });
});
