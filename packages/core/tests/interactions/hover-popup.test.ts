/**
 * @file The hover popup built-in (U7, R10, KTD8)
 *
 * @description
 * Proves the four contract points: per-feature dedupe (once per entered
 * feature, not per mousemove), the chromeless popup options, the id-less
 * geometry-key fallback (warn-once, never dead), and dismissal on
 * clearLayer. Coexistence (a pinned click popup suppresses hover popups
 * until dismissed) lives in the HOSTS' one-popup slot and is tested against
 * both hosts below.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const popupInstances: any[] = [];

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn((options?: unknown) => {
    const handlers = new Map<string, Function[]>();
    const instance = {
      options,
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      // Real maplibre fires 'close' SYNCHRONOUSLY on remove() — the mock
      // must too, or the slot's close-listener ordering goes untested.
      remove: vi.fn(() => {
        for (const cb of handlers.get("close") ?? []) cb();
      }),
      on: vi.fn((event: string, cb: Function) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      }),
    };
    popupInstances.push(instance);
    return instance;
  });
  return { default: { Popup }, Popup };
});

import { HOVER_INTERACTIONS } from "../../src/interactions/built-ins";
import { attachInteractions } from "../../src/interactions/attach";
import type {
  InteractionDeps,
  PopupContent,
} from "../../src/interactions/types";
import type { InteractionsProjection } from "../../src/interactions/manifest";

const LNGLAT = { lng: 1, lat: 2 } as any;

const hoverPopup = HOVER_INTERACTIONS.find(
  (i) => i.name === "popup"
)!;

function makeDeps() {
  return {
    showPopup: vi.fn(),
    hidePopup: vi.fn(),
  } as unknown as InteractionDeps & { showPopup: any; hidePopup: any };
}

const CONTENT: PopupContent = [{ p: [{ text: "hi" }] }] as any;

describe("hover popup built-in (unit)", () => {
  beforeEach(() => {
    popupInstances.length = 0;
    vi.clearAllMocks();
  });

  it("shows once per entered feature, not per mousemove", () => {
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);
    const ctx = { layerId: "pts", feature: { id: 7 }, lngLat: LNGLAT, map: {} } as any;

    runtime.run(CONTENT, ctx);
    runtime.run(CONTENT, ctx); // same feature: mousemove churn
    runtime.run(CONTENT, ctx);

    expect(deps.showPopup).toHaveBeenCalledTimes(1);
    expect(deps.showPopup).toHaveBeenCalledWith(CONTENT, ctx.feature, LNGLAT, {
      closeButton: false,
      closeOnClick: false,
      kind: "hover",
    });
  });

  it("shows again for a new feature", () => {
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);

    runtime.run(CONTENT, { layerId: "pts", feature: { id: 1 }, lngLat: LNGLAT } as any);
    runtime.run(CONTENT, { layerId: "pts", feature: { id: 2 }, lngLat: LNGLAT } as any);

    expect(deps.showPopup).toHaveBeenCalledTimes(2);
  });

  it("id-less features fall back to geometry keying with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);
    const feature = { geometry: { type: "Point", coordinates: [3, 4] } };

    runtime.run(CONTENT, { layerId: "pts", feature, lngLat: LNGLAT } as any);
    runtime.run(CONTENT, { layerId: "pts", feature, lngLat: LNGLAT } as any);

    expect(deps.showPopup).toHaveBeenCalledTimes(1); // deduped by geometry
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("generateId");
    warn.mockRestore();
  });

  it("clearLayer (mouseleave) hides the popup and re-arms the dedupe", () => {
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);
    const ctx = { layerId: "pts", feature: { id: 7 }, lngLat: LNGLAT } as any;

    runtime.run(CONTENT, ctx);
    runtime.clearLayer!("pts", {} as any);
    runtime.run(CONTENT, ctx); // re-entering the same feature shows again

    expect(deps.hidePopup).toHaveBeenCalledTimes(1);
    expect(deps.showPopup).toHaveBeenCalledTimes(2);
  });

  it("clearLayer for ANOTHER layer leaves this layer's popup alone", () => {
    // Runtimes are shared across layers and every hover-configured layer's
    // mouseleave (and every live-data resetFeatureState) calls clearLayer —
    // dismissal must be scoped to the layer that owns the popup.
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);

    runtime.run(CONTENT, { layerId: "a", feature: { id: 1 }, lngLat: LNGLAT } as any);
    runtime.clearLayer!("b", {} as any); // leaving/refreshing an unrelated layer

    expect(deps.hidePopup).not.toHaveBeenCalled();

    runtime.clearLayer!("a", {} as any);
    expect(deps.hidePopup).toHaveBeenCalledTimes(1);
  });

  it("a preview suppressed by a pin shows once the pin is dismissed, without mouseleave", () => {
    const deps = makeDeps();
    // Simulate the host slot: suppressed (false) while pinned, then free.
    deps.showPopup.mockReturnValueOnce(false);
    const runtime = hoverPopup.create(deps);
    const ctx = { layerId: "pts", feature: { id: 7 }, lngLat: LNGLAT } as any;

    runtime.run(CONTENT, ctx); // suppressed — must NOT consume the dedupe key
    runtime.run(CONTENT, ctx); // pin dismissed (keyboard), pointer never moved

    expect(deps.showPopup).toHaveBeenCalledTimes(2);
  });

  it("id-less non-Point features key by properties, surviving tile-clipped geometry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps();
    const runtime = hoverPopup.create(deps);
    // The same id-less polygon, clipped differently by two tiles: geometry
    // coordinates differ, properties are identical — one popup, no flicker.
    const tileA = {
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] },
      properties: { name: "park" },
    };
    const tileB = {
      geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1]]] },
      properties: { name: "park" },
    };

    runtime.run(CONTENT, { layerId: "polys", feature: tileA, lngLat: LNGLAT } as any);
    runtime.run(CONTENT, { layerId: "polys", feature: tileB, lngLat: LNGLAT } as any);

    expect(deps.showPopup).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

/** A one-layer projection with hover.popup + click.popup on the same layer. */
const BOTH_POPUPS: InteractionsProjection = {
  layers: {
    pts: {
      source: "pts-src",
      interactive: {
        hover: { popup: [{ p: [{ text: "preview" }] }] },
        click: { popup: [{ p: [{ text: "pinned" }] }] },
      },
    },
  },
} as InteractionsProjection;

/** Fire the listener registered for `event` on the mock map. */
function fire(map: any, event: string, feature: any) {
  const call = map.on.mock.calls.find((c: any[]) => c[0] === event);
  call?.[2]?.({ features: feature ? [feature] : [], lngLat: LNGLAT });
}

function mockMap() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    setFeatureState: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  } as any;
}

describe("coexistence through attachInteractions (the one-popup slot)", () => {
  beforeEach(() => {
    popupInstances.length = 0;
    vi.clearAllMocks();
  });

  it("hover previews chromeless; click pins; hover is suppressed while pinned; dismissal restores it", () => {
    const map = mockMap();
    attachInteractions(map, BOTH_POPUPS);

    // Hover a feature: a chromeless popup appears.
    fire(map, "mousemove", { id: 1, properties: {} });
    expect(popupInstances).toHaveLength(1);
    expect(popupInstances[0].options).toMatchObject({
      closeButton: false,
      closeOnClick: false,
    });

    // Click pins: the hover popup is replaced by a default-chrome popup.
    fire(map, "click", { id: 1, properties: {} });
    expect(popupInstances[0].remove).toHaveBeenCalled();
    expect(popupInstances).toHaveLength(2);
    const pinned = popupInstances[1];

    // Hovering another feature while pinned: NO new popup (suppressed).
    fire(map, "mousemove", { id: 2, properties: {} });
    expect(popupInstances).toHaveLength(2);
    expect(pinned.remove).not.toHaveBeenCalled();

    // mouseleave must not dismiss the pinned popup either.
    fire(map, "mouseleave", null);
    expect(pinned.remove).not.toHaveBeenCalled();

    // The user dismisses the pinned popup (the host listens for 'close').
    const closeHandler = pinned.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
    closeHandler?.();

    // Hover works again — enter a fresh feature.
    fire(map, "mousemove", { id: 3, properties: {} });
    expect(popupInstances).toHaveLength(3);
    expect(popupInstances[2].options).toMatchObject({ closeButton: false });
  });
});
