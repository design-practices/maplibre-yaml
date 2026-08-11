/**
 * @file Security-first tests for the `emit` click interaction
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * `emit` dispatches a NAMED event with a DECLARATIVE payload to the host,
 * resolved closed-world against a host-supplied handler map. It is the epic's
 * security seam, so these tests lead with the security properties and only then
 * pin behaviour:
 *
 *   1. The trust gate (`allowsHostHook`) is inert under an untrusted policy and
 *      active only under a trusted one — the core security property.
 *   2. The built-in is inert under an untrusted policy even when a handler is
 *      registered: the gate, not the handler map, decides whether emit runs.
 *   3. A registered event + trusted policy resolves and dispatches the projected
 *      payload to the host handler.
 *   4. A registered-but-different name and an unregistered name are denied with a
 *      warning and never dispatched (closed-world default-deny).
 *   5. Payload projection reaches named feature properties; a projection over a
 *      missing property yields a defined-absent value, never a throw.
 *   6. Hover-emit (ml-fn9): the SAME `emit` runtime, mirrored onto the hover
 *      trigger with per-feature dedupe — it fires once per feature entered, not
 *      on every mousemove, and shares the click-emit trust gate and closed-world
 *      resolution. Its dedupe + parity tests live in the lower half of this file.
 *
 * The built-in is driven the way `EventHandler` drives it —
 * `create({...deps})` → `run(config, ctx)` — against stub deps.
 */

import { describe, it, expect, vi } from "vitest";
import { CLICK_INTERACTIONS, HOVER_INTERACTIONS } from "../../src/interactions/built-ins";
import { createInteractionRegistry } from "../../src/interactions/registry";
import type {
  Interaction,
  InteractionContext,
  InteractionDeps,
  InteractionHostHandlers,
  EmitConfig,
} from "../../src/interactions/types";
import {
  allowsHostHook,
  DEFAULT_POLICY,
  type CapabilityPolicy,
} from "../../src/capabilities";

/** The emit built-in, pulled from the ordered click set. */
function emitInteraction(): Interaction {
  const found = CLICK_INTERACTIONS.find((i) => i.name === "emit");
  if (!found) throw new Error("emit built-in is not registered");
  return found;
}

/**
 * A fresh runtime + context. `policy`/`handlers` are the emit-specific deps;
 * `feature.properties` is what the payload projects from.
 */
function harness(opts: {
  policy?: CapabilityPolicy;
  handlers?: InteractionHostHandlers;
  properties?: Record<string, unknown>;
}) {
  const deps: InteractionDeps = {
    showPopup: () => {},
    hostHandlers: opts.handlers,
    policy: opts.policy,
  };
  const runtime = emitInteraction().create(deps);
  const ctx: InteractionContext = {
    map: {} as unknown as InteractionContext["map"],
    layerId: "layer-1",
    sourceId: "src-1",
    feature: {
      type: "Feature",
      properties: opts.properties ?? {},
      geometry: { type: "Point", coordinates: [0, 0] },
    },
    lngLat: { lng: 0, lat: 0 } as InteractionContext["lngLat"],
  };
  return { runtime, ctx };
}

const trusted: CapabilityPolicy = { trust: "trusted" };
const untrusted: CapabilityPolicy = { trust: "untrusted" };

describe("allowsHostHook — the trust gate (core security property)", () => {
  it("denies host hooks under an untrusted policy", () => {
    expect(allowsHostHook(untrusted)).toBe(false);
  });

  it("denies host hooks under the default policy (default-deny)", () => {
    expect(allowsHostHook(DEFAULT_POLICY)).toBe(false);
  });

  it("permits host hooks only under a trusted policy", () => {
    expect(allowsHostHook(trusted)).toBe(true);
  });
});

describe("emit — inert under an untrusted policy", () => {
  it("does not dispatch even when the event has a registered handler", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: untrusted,
      handlers: { select: handler },
      properties: { bbl: "1000010001" },
    });

    runtime.run({ event: "select" }, ctx);

    // The gate, not the handler map, decides. A registered handler must not run.
    expect(handler).not.toHaveBeenCalled();
  });

  it("is inert under the default policy too", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      handlers: { select: handler },
      properties: {},
    });
    // No policy passed → the built-in falls back to DEFAULT_POLICY (untrusted).
    runtime.run({ event: "select" }, ctx);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("emit — dispatch under a trusted policy", () => {
  it("dispatches the projected payload to a registered handler", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: { bbl: "1000010001", name: "Tract A" },
    });

    runtime.run(
      {
        event: "select",
        payload: {
          id: { property: "bbl" },
          label: { property: "name" },
        },
      },
      ctx
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "1000010001", label: "Tract A" });
  });

  it("dispatches an empty payload object when no payload is declared", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { ping: handler },
      properties: { bbl: "x" },
    });

    runtime.run({ event: "ping" }, ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({});
  });
});

describe("emit — closed-world default-deny on the event name", () => {
  it("denies an unregistered event name with a warning and no dispatch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: {},
      properties: {},
    });

    runtime.run({ event: "evilEval" }, ctx);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/evilEval/);
    warn.mockRestore();
  });

  it("denies a registered-but-different event name (no fuzzy match)", () => {
    const registered = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: registered },
      properties: {},
    });

    // The handler map registers "select"; the config names "selectFeature".
    runtime.run({ event: "selectFeature" }, ctx);

    expect(registered).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not treat a prototype method name as a registered handler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: {},
      properties: {},
    });

    // "toString"/"constructor" exist on Object.prototype but are not registered
    // handlers — closed-world means own registered keys only.
    runtime.run({ event: "toString" }, ctx);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Regression guard (security): pin that a prototype-chain event name can never
  // resolve to an inherited function. The code is already correct — the
  // `hasOwnProperty` + `typeof === "function"` guard denies these — so these
  // pass immediately; they exist so a future refactor that loosened the guard
  // (e.g. `handlers[config.event]` without the own-key check) fails loudly.
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])(
    "denies prototype-chain name %s that no handler registers (no dispatch, warns)",
    (evtName) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const registered = vi.fn();
      const { runtime, ctx } = harness({
        policy: trusted,
        // The map registers a benign, unrelated event; the prototype name lives
        // on the chain but is never an OWN registered key.
        handlers: { select: registered },
        properties: {},
      });

      runtime.run({ event: evtName }, ctx);

      // The inherited name is denied outright: nothing dispatches (not the
      // registered handler, not the inherited method), and a diagnostic warns.
      expect(registered).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(evtName);
      warn.mockRestore();
    }
  );
});

describe("emit — declarative payload projection", () => {
  it("projects named feature properties into the payload", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: { bbl: "1000010001", pop: 8336817 },
    });

    runtime.run(
      {
        event: "select",
        payload: { id: { property: "bbl" }, population: { property: "pop" } },
      },
      ctx
    );

    expect(handler).toHaveBeenCalledWith({ id: "1000010001", population: 8336817 });
  });

  it("yields a defined-absent value for a missing property, never a throw", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: { bbl: "1000010001" },
    });

    expect(() =>
      runtime.run(
        {
          event: "select",
          payload: { id: { property: "bbl" }, missing: { property: "nope" } },
        },
        ctx
      )
    ).not.toThrow();

    const payload = handler.mock.calls[0]?.[0] as Record<string, unknown>;
    // The key is present and defined-absent (null), not omitted, not undefined.
    expect(payload).toHaveProperty("missing");
    expect(payload.missing).toBeNull();
    expect(payload.id).toBe("1000010001");
  });

  it("uses the declared `else` fallback when a property is missing", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: {},
    });

    runtime.run(
      {
        event: "select",
        payload: { label: { property: "name", else: "Unknown" } },
      },
      ctx
    );

    expect(handler).toHaveBeenCalledWith({ label: "Unknown" });
  });

  it("a payload spec with a __proto__ key does not pollute Object.prototype", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: { evil: "pwned" },
    });

    // A hand-built / tampered payload spec carrying a `__proto__` key. A plain
    // object literal `{ __proto__: ... }` would SET the prototype rather than
    // create a key, so use defineProperty to make "__proto__" an OWN enumerable
    // property — exactly what a maliciously crafted projection would need for
    // projectEmitPayload to iterate it and assign `payload["__proto__"] = …`.
    const payloadSpec: Record<string, unknown> = {};
    Object.defineProperty(payloadSpec, "__proto__", {
      value: { property: "evil" },
      enumerable: true,
      writable: true,
      configurable: true,
    });

    runtime.run({ event: "select", payload: payloadSpec as any }, ctx);

    // The dispatch must not have injected anything onto Object.prototype: a
    // fresh object sees no smuggled key, and the global prototype is untouched.
    expect(({} as any).evil).toBeUndefined();
    expect(({} as any).pwned).toBeUndefined();
    expect("pwned" in {}).toBe(false);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("pwned");
  });

  it("projects a static `str` literal", () => {
    const handler = vi.fn();
    const { runtime, ctx } = harness({
      policy: trusted,
      handlers: { select: handler },
      properties: { bbl: "x" },
    });

    runtime.run(
      {
        event: "select",
        payload: { kind: { str: "feature" }, id: { property: "bbl" } },
      },
      ctx
    );

    expect(handler).toHaveBeenCalledWith({ kind: "feature", id: "x" });
  });
});

describe("emit — registry integration on both triggers", () => {
  it("resolves the emit name to the built-in on the allowlist", () => {
    const registry = createInteractionRegistry();
    const result = registry.resolve("emit");
    expect("denied" in result).toBe(false);
    expect((result as Interaction).name).toBe("emit");
    expect(registry.has("emit")).toBe(true);
  });

  it("registers emit on BOTH the click and hover triggers", () => {
    // Two runtimes under one name: the click one fires on click with no dedupe;
    // the hover one fires on mousemove with per-feature dedupe. The registry
    // allows the shared name across the two trigger lists (deduped in byName).
    const clickNames = CLICK_INTERACTIONS.map((i) => i.name);
    const hoverNames = HOVER_INTERACTIONS.map((i) => i.name);
    expect(clickNames).toContain("emit");
    expect(hoverNames).toContain("emit");
  });
});

/** The hover-emit built-in, pulled from the ordered hover set. */
function hoverEmitInteraction(): Interaction {
  const found = HOVER_INTERACTIONS.find((i) => i.name === "emit");
  if (!found) throw new Error("hover-emit built-in is not registered");
  return found;
}

/**
 * A hover-emit runtime plus a `move` helper that drives it the way a mousemove
 * does — one call per pointer sample, carrying the feature `id` the dedupe keys
 * on and the `properties` the payload projects from.
 */
function hoverHarness(opts: {
  policy?: CapabilityPolicy;
  handlers?: InteractionHostHandlers;
}) {
  const deps: InteractionDeps = {
    showPopup: () => {},
    hostHandlers: opts.handlers,
    policy: opts.policy,
  };
  const runtime = hoverEmitInteraction().create(deps);
  const move = (
    config: EmitConfig,
    featureId: string | number | undefined,
    properties: Record<string, unknown> = {},
    layerId = "layer-1"
  ) => {
    const ctx: InteractionContext = {
      map: {} as unknown as InteractionContext["map"],
      layerId,
      sourceId: "src-1",
      feature: {
        type: "Feature",
        id: featureId,
        properties,
        geometry: { type: "Point", coordinates: [0, 0] },
      },
      lngLat: { lng: 0, lat: 0 } as InteractionContext["lngLat"],
    };
    runtime.run(config, ctx);
  };
  return { runtime, move };
}

describe("hover-emit — per-feature dedupe (the core of ml-fn9)", () => {
  const cfg: EmitConfig = {
    event: "select",
    payload: { id: { property: "bbl" } },
  };

  it("dispatches once when a feature is ENTERED, not on every mousemove", () => {
    const handler = vi.fn();
    const { move } = hoverHarness({
      policy: trusted,
      handlers: { select: handler },
    });

    // Three mousemove samples over the SAME feature → one dispatch.
    move(cfg, "f1", { bbl: "A" });
    move(cfg, "f1", { bbl: "A" });
    move(cfg, "f1", { bbl: "A" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "A" });
  });

  it("dispatches AGAIN when the pointer enters a new feature", () => {
    const handler = vi.fn();
    const { move } = hoverHarness({
      policy: trusted,
      handlers: { select: handler },
    });

    move(cfg, "f1", { bbl: "A" });
    move(cfg, "f2", { bbl: "B" }); // new feature → new dispatch
    move(cfg, "f2", { bbl: "B" }); // dedupe on the newly-entered one

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]).toEqual({ id: "A" });
    expect(handler.mock.calls[1]?.[0]).toEqual({ id: "B" });
  });

  it("re-emits a feature re-entered after clearLayer (mouseleave lifecycle)", () => {
    const handler = vi.fn();
    const { runtime, move } = hoverHarness({
      policy: trusted,
      handlers: { select: handler },
    });

    move(cfg, "f1", { bbl: "A" });
    // mouseleave/detach clears the tracked feature, so re-entry emits again.
    runtime.clearLayer?.("layer-1", {} as unknown as InteractionContext["map"]);
    move(cfg, "f1", { bbl: "A" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("dedupes per layer, not globally (same id on two layers both fire)", () => {
    const handler = vi.fn();
    const { move } = hoverHarness({
      policy: trusted,
      handlers: { select: handler },
    });

    move(cfg, "f1", { bbl: "A" }, "layer-1");
    move(cfg, "f1", { bbl: "A" }, "layer-2");

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("hover-emit — security parity with click-emit", () => {
  const cfg: EmitConfig = { event: "select" };

  it("is inert under an untrusted policy even with a registered handler", () => {
    const handler = vi.fn();
    const { move } = hoverHarness({
      policy: untrusted,
      handlers: { select: handler },
    });
    move(cfg, "f1", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("is inert under the default policy (no policy passed)", () => {
    const handler = vi.fn();
    const { move } = hoverHarness({ handlers: { select: handler } });
    move(cfg, "f1", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("denies an unregistered event name closed-world with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { move } = hoverHarness({ policy: trusted, handlers: {} });

    move({ event: "evilEval" }, "f1", {});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/evilEval/);
    warn.mockRestore();
  });

  it("skips and warns once when features carry no id (dedupe needs one)", () => {
    const handler = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { move } = hoverHarness({
      policy: trusted,
      handlers: { select: handler },
    });

    // No id → the pointer sample cannot be told from the next: emit would fire
    // per mousemove, the firehose dedupe exists to prevent. Skip, warn once.
    move({ event: "select" }, undefined, { bbl: "A" });
    move({ event: "select" }, undefined, { bbl: "A" });

    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/generateId/);
    warn.mockRestore();
  });
});
