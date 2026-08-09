/**
 * @file Security-first tests for `attachInteractions` — the compiled-map entry point
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * `attachInteractions` wires the registry's built-in handlers onto a bare
 * `maplibregl.Map` from a declarative projection — the surface a compiled map
 * and a bring-your-own-map host (map-party) both use. These tests lead with the
 * load-bearing security property and then pin behaviour + lifecycle:
 *
 *   1. **AE5 — the compiled-path XSS gate.** A popup `!html` marker renders
 *      ESCAPED under an untrusted policy and under a defaulted-absent policy,
 *      renders as live markup under trusted, and a `<script>` feature property
 *      is escaped in every case — the renderer's `PopupBuilder(policy)` applied
 *      off the renderer. This is the #1 requirement.
 *   2. AE2 — a projection binds click/hover/mousemove on a bare Map; firing them
 *      invokes popup/highlight/zoomToFeature; highlight's `setFeatureState` uses
 *      the PROJECTED source id.
 *   3. AE3 — attach dispatches a registered `emit` to the host handler under
 *      trusted, and the built-in is inert under untrusted (defense-in-depth).
 *   4. AE4 — a projection naming an unknown interaction is denied with a warning.
 *   5. AE6/lifecycle — `destroy()`/`detach()` `map.off` every bound listener with
 *      no leak; `resetFeatureState` clears highlight state.
 *   6. Parity (R9 go/no-go) — attach binds the same listeners `EventHandler`
 *      wires for the same model.
 *
 * The popup mock is hoisted so tests observe the HTML `showPopup` actually
 * builds, rather than stubbing the sink.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const popupInstance = {
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => popupInstance);
  return { default: { Popup }, Popup };
});

import { attachInteractions } from "../../src/interactions/attach";
import { projectInteractions } from "../../src/interactions/manifest";
import { createInteractionRegistry } from "../../src/interactions/registry";
import type { InteractionsProjection } from "../../src/interactions/manifest";
import { EventHandler } from "../../src/renderer/event-handler";
import { normalizeMapBlock } from "../../src/model/normalize";
import type { V1MapInput } from "../../src/model/types";
import type { CapabilityPolicy } from "../../src/capabilities";

const trusted: CapabilityPolicy = { trust: "trusted" };
const untrusted: CapabilityPolicy = { trust: "untrusted" };
const LNGLAT = { lng: 1, lat: 2 } as any;

/** A bare Map mock: records on/off, exposes the runtime methods interactions call. */
function mockMap() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    setFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  } as any;
}

/** Fire the listener registered for `event` with a synthetic feature. */
function fire(map: any, event: string, feature: any) {
  const call = map.on.mock.calls.find((c: any[]) => c[0] === event);
  call?.[2]?.({ features: feature ? [feature] : [], lngLat: LNGLAT });
}

/** A one-layer projection with the given interactive config and source id. */
function projection(
  interactive: unknown,
  source = "layer-source"
): InteractionsProjection {
  return { layers: { "layer-1": { source, interactive: interactive as any } } };
}

beforeEach(() => {
  popupInstance.setLngLat.mockClear();
  popupInstance.setHTML.mockClear();
  popupInstance.addTo.mockClear();
  popupInstance.remove.mockClear();
});

describe("attachInteractions — AE5: the compiled-path popup XSS gate", () => {
  // A popup that requests raw markup AND reads a hostile feature property.
  const htmlPopup = {
    click: {
      popup: [
        { p: [{ str: { $html: "<b>bold</b>" } }, { property: "name" }] },
      ],
    },
  };
  const hostileFeature = {
    properties: { name: "<script>alert(1)</script>" },
    geometry: { type: "Point", coordinates: [0, 0] },
  };

  it("renders `!html` escaped under an untrusted policy", () => {
    const map = mockMap();
    attachInteractions(map, projection(htmlPopup), { policy: untrusted });
    fire(map, "click", hostileFeature);

    const html = popupInstance.setHTML.mock.calls[0]?.[0] as string;
    expect(html).toBeDefined();
    // The `!html` marker is denied: rendered as escaped text, not live markup.
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    // The feature property is escaped unconditionally.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders `!html` escaped under a defaulted-absent policy (fail-closed)", () => {
    const map = mockMap();
    // No policy at all → DEFAULT_POLICY (untrusted).
    attachInteractions(map, projection(htmlPopup));
    fire(map, "click", hostileFeature);

    const html = popupInstance.setHTML.mock.calls[0]?.[0] as string;
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders `!html` as live markup under a trusted policy", () => {
    const map = mockMap();
    attachInteractions(map, projection(htmlPopup), { policy: trusted });
    fire(map, "click", hostileFeature);

    const html = popupInstance.setHTML.mock.calls[0]?.[0] as string;
    // Trusted grants the marker: the bold renders.
    expect(html).toContain("<b>bold</b>");
    // Feature-property escaping is unconditional — never live, even trusted.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("attachInteractions — AE2: binds and fires on a bare Map", () => {
  it("binds click + hover + mousemove listeners", () => {
    const map = mockMap();
    attachInteractions(
      map,
      projection({
        hover: { cursor: "pointer", highlight: true },
        click: { popup: [{ p: [{ str: "hi" }] }] },
      }),
      { policy: trusted }
    );

    const events = map.on.mock.calls.map((c: any[]) => c[0]).sort();
    expect(events).toEqual(["click", "mouseenter", "mousemove", "mouseleave"].sort());
  });

  it("opens a popup on click", () => {
    const map = mockMap();
    attachInteractions(
      map,
      projection({ click: { popup: [{ p: [{ property: "name" }] }] } }),
      { policy: trusted }
    );
    fire(map, "click", { properties: { name: "Grand Central" } });

    expect(popupInstance.setHTML).toHaveBeenCalledWith(
      expect.stringContaining("Grand Central")
    );
    expect(popupInstance.addTo).toHaveBeenCalled();
  });

  it("highlights on hover using the PROJECTED source id", () => {
    const map = mockMap();
    attachInteractions(
      map,
      projection({ hover: { highlight: true } }, "custom-source"),
      { policy: trusted }
    );
    fire(map, "mousemove", { id: 7, properties: {} });

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "custom-source", id: 7 },
      { hover: true }
    );
  });

  it("fits the camera on a zoomToFeature click", () => {
    const map = mockMap();
    attachInteractions(
      map,
      projection({ click: { zoomToFeature: { padding: 40 } } }),
      { policy: trusted }
    );
    fire(map, "click", {
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
      },
    });

    expect(map.fitBounds).toHaveBeenCalledWith(
      [[0, 0], [4, 4]],
      expect.objectContaining({ padding: 40 })
    );
  });

  it("sets the hover cursor on mouseenter", () => {
    const map = mockMap();
    const canvas = { style: { cursor: "" } };
    map.getCanvas = vi.fn(() => canvas);
    attachInteractions(map, projection({ hover: { cursor: "pointer" } }));

    const enter = map.on.mock.calls.find((c: any[]) => c[0] === "mouseenter");
    enter?.[2]?.({});
    expect(canvas.style.cursor).toBe("pointer");
  });
});

describe("attachInteractions — AE3: emit reaches the host, trust-gated", () => {
  const emitProjection = projection({
    click: { emit: { event: "select", payload: { id: { property: "bbl" } } } },
  });

  it("dispatches the projected payload to a registered handler under trusted", () => {
    const map = mockMap();
    const handler = vi.fn();
    attachInteractions(map, emitProjection, {
      policy: trusted,
      hostHandlers: { select: handler },
    });
    fire(map, "click", { properties: { bbl: "1000010001" } });

    expect(handler).toHaveBeenCalledWith({ id: "1000010001" });
  });

  it("is inert under an untrusted policy even with a registered handler", () => {
    const map = mockMap();
    const handler = vi.fn();
    // Even if a projection carried an emit block, the built-in's own trust gate
    // denies it under untrusted — defense-in-depth behind the projection drop.
    attachInteractions(map, emitProjection, {
      policy: untrusted,
      hostHandlers: { select: handler },
    });
    fire(map, "click", { properties: { bbl: "x" } });

    expect(handler).not.toHaveBeenCalled();
  });

  it("drops emit end-to-end when projected under an untrusted policy", () => {
    // The full AE3 path: projectInteractions(untrusted) omits the block, so
    // attach never even sees an emit to dispatch.
    const m = model([
      inlineLayer("parcels", {
        click: { emit: { event: "select", payload: { id: { property: "bbl" } } } },
      }),
    ]);
    const proj = projectInteractions(m, untrusted);
    const map = mockMap();
    const handler = vi.fn();
    attachInteractions(map, proj, {
      policy: trusted, // even a trusted attach can't resurrect a dropped block
      hostHandlers: { select: handler },
    });
    fire(map, "click", { properties: { bbl: "x" } });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("attachInteractions — AE4: unknown interaction name is denied", () => {
  it("warns during attach for a projection naming an unknown interaction", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = mockMap();
    attachInteractions(
      map,
      projection({ click: { notARealInteraction: { foo: 1 } } })
    );

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => /notARealInteraction/.test(String(c[0])))).toBe(
      true
    );
    warn.mockRestore();
  });

  it("does not warn for recognized interaction or reserved keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = mockMap();
    attachInteractions(
      map,
      projection({
        hover: { cursor: "pointer", highlight: true },
        click: { popup: [{ p: [{ str: "x" }] }], action: "custom", flyTo: { zoom: 5 } },
      }),
      { policy: trusted }
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("attachInteractions — AE6: lifecycle, no listener leak", () => {
  const fullInteractive = {
    hover: { cursor: "pointer", highlight: true },
    click: { popup: [{ p: [{ str: "x" }] }] },
  };

  it("destroy() offs every listener it bound", () => {
    const map = mockMap();
    const handle = attachInteractions(map, projection(fullInteractive), {
      policy: trusted,
    });
    const boundEvents = map.on.mock.calls.map((c: any[]) => `${c[0]}:${c[1]}`).sort();

    handle.destroy();

    const offEvents = map.off.mock.calls.map((c: any[]) => `${c[0]}:${c[1]}`).sort();
    expect(offEvents).toEqual(boundEvents);
    // Every bound listener is the exact function passed to `off`.
    for (const onCall of map.on.mock.calls) {
      const matching = map.off.mock.calls.find(
        (c: any[]) => c[0] === onCall[0] && c[1] === onCall[1]
      );
      expect(matching?.[2]).toBe(onCall[2]);
    }
  });

  it("detach(layerId) removes only that layer's listeners", () => {
    const map = mockMap();
    const proj: InteractionsProjection = {
      layers: {
        a: { source: "a-src", interactive: fullInteractive as any },
        b: { source: "b-src", interactive: { click: { popup: [{ p: [{ str: "y" }] }] } } as any },
      },
    };
    const handle = attachInteractions(map, proj, { policy: trusted });

    handle.detach("a");

    const offLayers = new Set(map.off.mock.calls.map((c: any[]) => c[1]));
    expect(offLayers.has("a")).toBe(true);
    expect(offLayers.has("b")).toBe(false);
  });

  it("resetFeatureState clears highlight state for a layer", () => {
    const map = mockMap();
    const handle = attachInteractions(
      map,
      projection({ hover: { highlight: true } }, "src"),
      { policy: trusted }
    );
    fire(map, "mousemove", { id: 7, properties: {} });
    map.setFeatureState.mockClear();

    handle.resetFeatureState("layer-1");

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "src", id: 7 },
      { hover: false }
    );
  });

  it("detaching a non-existent layer does not throw", () => {
    const map = mockMap();
    const handle = attachInteractions(map, projection(fullInteractive));
    expect(() => handle.detach("nope")).not.toThrow();
  });
});

describe("attachInteractions — parity with EventHandler (R9 go/no-go)", () => {
  // R9 is deferred: attach.ts and event-handler.ts are two live copies of the
  // map.on binding + dispatch logic. This parity test is the drift alarm.
  // Parametrized over a spread of interactive configs so the guard catches a
  // divergence that only shows up under a particular combination of triggers —
  // not just the one fixed config a single case would pin.
  const parityCases: Array<{ name: string; interactive: unknown }> = [
    {
      name: "click-only popup",
      interactive: { click: { popup: [{ p: [{ property: "name" }] }] } },
    },
    {
      name: "hover-only highlight",
      interactive: { hover: { cursor: "pointer", highlight: true } },
    },
    {
      name: "popup + flyTo + zoomToFeature",
      interactive: {
        click: {
          popup: [{ p: [{ property: "name" }] }],
          flyTo: { zoom: 12 },
          zoomToFeature: { padding: 40 },
        },
      },
    },
    {
      name: "all together (click popup+flyTo, hover cursor+highlight)",
      interactive: {
        hover: { cursor: "pointer", highlight: true },
        click: { popup: [{ p: [{ property: "name" }] }], flyTo: { zoom: 12 } },
      },
    },
  ];

  const tuples = (m: any) =>
    m.on.mock.calls.map((c: any[]) => `${c[0]}:${c[1]}`).sort();

  it.each(parityCases)(
    "binds the same listeners EventHandler wires: $name",
    ({ interactive }) => {
      const layer = {
        id: "parcels",
        type: "fill",
        source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        interactive,
      };

      // EventHandler path: bind the raw v1 layer.
      const mapA = mockMap();
      const handler = new EventHandler(mapA, {}, trusted);
      handler.attachEvents(layer as any);

      // attach path: project the model, then attach.
      const mapB = mockMap();
      attachInteractions(
        mapB,
        projectInteractions(normalizeMapBlock({
          id: "m",
          config: { center: [0, 0], zoom: 1 },
          layers: [layer],
        } as unknown as V1MapInput), trusted),
        { policy: trusted }
      );

      // Both paths must bind the identical set of (event:layer) listener tuples.
      expect(tuples(mapB)).toEqual(tuples(mapA));
      // And the set must be non-empty — an interactive config binds something,
      // so an empty-vs-empty match can never masquerade as parity.
      expect(tuples(mapA).length).toBeGreaterThan(0);
    }
  );

  it("resolves the same interaction set the registry hands EventHandler", () => {
    const registry = createInteractionRegistry();
    // The attach path dispatches through exactly these ordered sets.
    expect(registry.clickInteractions().map((i) => i.name)).toEqual([
      "popup",
      "flyTo",
      "zoomToFeature",
      "emit",
    ]);
    expect(registry.hoverInteractions().map((i) => i.name)).toEqual(["highlight"]);
  });
});

// --- helpers for the model-backed cases -------------------------------------

function model(layers: Record<string, unknown>[]) {
  return normalizeMapBlock({
    id: "m",
    config: { center: [0, 0], zoom: 1 },
    layers,
  } as unknown as V1MapInput);
}

function inlineLayer(id: string, interactive: unknown) {
  return {
    id,
    type: "circle",
    source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    interactive,
  };
}
