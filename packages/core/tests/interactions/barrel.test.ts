import { describe, it, expect, vi } from "vitest";

// The interactions barrel now re-exports `attachInteractions`, which imports the
// maplibre-gl `Popup` value at module load. Polyfill the object-URL API the
// bundle touches on import so the real module loads under jsdom (same shim the
// renderer conformance suites use).
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:barrel-test";
  w.URL.revokeObjectURL ??= () => {};
});

import {
  CLICK_INTERACTIONS,
  HOVER_INTERACTIONS,
  HOVER_FEATURE_STATE_KEY,
  type Interaction,
  type InteractionContext,
  type InteractionDeps,
  type InteractionRuntime,
} from "../../src/interactions";
import * as barrel from "../../src/interactions";
// The authoring seam (`defineInteraction`, `stateless`) is deliberately NOT on
// the public barrel — it is an internal helper `built-ins.ts` imports directly
// from `./types`. Exposing it from the barrel would hand hosts a custom-
// interaction registration path the Scope Boundaries deferred as security-
// sensitive. This import proves the internal path still works.
import { defineInteraction, stateless } from "../../src/interactions/types";

// Smoke test: the public barrel resolves and its runtime + type surface are
// present. Behavior is characterized by the renderer suites; this only guards
// the move — that every currently-exported symbol still exports by name.
describe("interactions barrel", () => {
  it("exposes the built-in registries", () => {
    expect(CLICK_INTERACTIONS.map((i) => i.name)).toEqual([
      "popup",
      "flyTo",
      "zoomToFeature",
      "emit",
    ]);
    expect(HOVER_INTERACTIONS.map((i) => i.name)).toEqual(["highlight"]);
    expect(HOVER_FEATURE_STATE_KEY).toBe("hover");
  });

  it("keeps the authoring seam off the public barrel", () => {
    // The helpers exist (imported from the internal path above) but must NOT be
    // re-exported from the barrel — no host-facing registration path.
    expect(typeof defineInteraction).toBe("function");
    expect(typeof stateless).toBe("function");
    expect("defineInteraction" in barrel).toBe(false);
    expect("stateless" in barrel).toBe(false);
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
