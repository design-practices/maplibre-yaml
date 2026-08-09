import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock maplibre-gl before import. The Popup instance is hoisted so tests can
// observe the popup that showPopup actually builds, rather than stubbing the
// method out and asserting only that it was called.
const popupInstance = {
  setLngLat: vi.fn().mockReturnThis(),
  setHTML: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => popupInstance);
  return {
    default: { Popup },
    Popup,
  };
});

import { EventHandler } from "../../src/renderer/event-handler";

describe("EventHandler", () => {
  let mockMap: any;
  let handler: EventHandler;
  let callbacks: any;

  beforeEach(() => {
    mockMap = {
      on: vi.fn(),
      off: vi.fn(),
      flyTo: vi.fn(),
      setFeatureState: vi.fn(),
      removeFeatureState: vi.fn(),
      getCanvas: vi.fn(() => ({
        style: { cursor: "" },
      })),
    };

    callbacks = {
      onClick: vi.fn(),
      onHover: vi.fn(),
    };

    // The popup mock is module-scoped, so its call history outlives each test.
    popupInstance.setLngLat.mockClear();
    popupInstance.setHTML.mockClear();
    popupInstance.addTo.mockClear();
    popupInstance.remove.mockClear();

    handler = new EventHandler(mockMap, callbacks);
  });

  describe("attachEvents", () => {
    it("attaches hover events", () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          hover: {
            cursor: "pointer",
          },
        },
      };

      handler.attachEvents(layer);

      expect(mockMap.on).toHaveBeenCalledWith(
        "mouseenter",
        "test-layer",
        expect.any(Function)
      );
      expect(mockMap.on).toHaveBeenCalledWith(
        "mouseleave",
        "test-layer",
        expect.any(Function)
      );
    });

    it("attaches click events", () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          click: {
            popup: [{ h3: [{ property: "name" }] }],
          },
        },
      };

      handler.attachEvents(layer);

      expect(mockMap.on).toHaveBeenCalledWith(
        "click",
        "test-layer",
        expect.any(Function)
      );
    });

    it("does nothing for layers without interactive config", () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      };

      handler.attachEvents(layer);

      expect(mockMap.on).not.toHaveBeenCalled();
    });

    it("handles both hover and click events", () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          hover: { cursor: "pointer" },
          click: { popup: [{ p: [{ str: "Test" }] }] },
        },
      };

      handler.attachEvents(layer);

      expect(mockMap.on).toHaveBeenCalledTimes(3); // mouseenter, mouseleave, click
    });
  });

  describe("hover.highlight", () => {
    const LNGLAT = { lng: 1, lat: 2 } as any;

    const hoverLayer = (hover: any, source: any = {
      type: "geojson" as const,
      data: { type: "FeatureCollection" as const, features: [] },
    }) => ({
      id: "test-layer",
      type: "circle" as const,
      source,
      interactive: { hover },
    });

    /** Fire the listener registered for `event` with a synthetic feature. */
    const fire = (event: string, feature: any) => {
      const registered = mockMap.on.mock.calls.find(
        (call: any[]) => call[0] === event
      );
      registered?.[2]?.({ features: feature ? [feature] : [], lngLat: LNGLAT });
    };

    it("sets hover feature-state for the hovered feature", () => {
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 7, properties: {} });

      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 7 },
        { hover: true }
      );
    });

    it("clears the previous feature when moving to an adjacent one", () => {
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 7, properties: {} });
      mockMap.setFeatureState.mockClear();
      fire("mousemove", { id: 8, properties: {} });

      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 7 },
        { hover: false }
      );
      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 8 },
        { hover: true }
      );
    });

    it("does not re-set state while hovering the same feature", () => {
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 7, properties: {} });
      mockMap.setFeatureState.mockClear();
      fire("mousemove", { id: 7, properties: {} });

      expect(mockMap.setFeatureState).not.toHaveBeenCalled();
    });

    it("clears highlight on mouseleave", () => {
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 7, properties: {} });
      mockMap.setFeatureState.mockClear();

      const leave = mockMap.on.mock.calls.find((c: any[]) => c[0] === "mouseleave");
      leave?.[2]?.({});

      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 7 },
        { hover: false }
      );
    });

    it("clears highlight on detachEvents and on destroy", () => {
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 7, properties: {} });
      mockMap.setFeatureState.mockClear();

      handler.detachEvents("test-layer");
      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 7 },
        { hover: false }
      );

      // Re-attach, hover again, then destroy.
      handler.attachEvents(hoverLayer({ highlight: true }) as any);
      fire("mousemove", { id: 9, properties: {} });
      mockMap.setFeatureState.mockClear();
      handler.destroy();
      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "test-layer-source", id: 9 },
        { hover: false }
      );
    });

    it("resolves a named source by name, matching LayerManager", () => {
      handler.attachEvents(hoverLayer({ highlight: true }, "shared-src") as any);
      fire("mousemove", { id: 3, properties: {} });

      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "shared-src", id: 3 },
        { hover: true }
      );
    });

    it("warns once and skips features with no id", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      handler.attachEvents(hoverLayer({ highlight: true }) as any);

      fire("mousemove", { properties: {} });
      fire("mousemove", { properties: {} });

      expect(mockMap.setFeatureState).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/id/i);
      warn.mockRestore();
    });

    it("does not highlight when highlight is false", () => {
      handler.attachEvents(hoverLayer({ highlight: false, cursor: "pointer" }) as any);
      fire("mousemove", { id: 7, properties: {} });

      expect(mockMap.setFeatureState).not.toHaveBeenCalled();
    });

    it("leaves hover.cursor behavior intact when highlight is also configured", () => {
      const canvas = { style: { cursor: "" } };
      mockMap.getCanvas = vi.fn(() => canvas);
      handler.attachEvents(
        hoverLayer({ highlight: true, cursor: "pointer" }) as any
      );

      const enter = mockMap.on.mock.calls.find((c: any[]) => c[0] === "mouseenter");
      enter?.[2]?.({ features: [{ id: 1, properties: {} }], lngLat: LNGLAT });
      expect(canvas.style.cursor).toBe("pointer");

      const leave = mockMap.on.mock.calls.find((c: any[]) => c[0] === "mouseleave");
      leave?.[2]?.({});
      expect(canvas.style.cursor).toBe("");
    });
  });

  describe("click.flyTo", () => {
    const CLICKED_LNGLAT = { lng: -74.006, lat: 40.7128 } as any;

    /** Build a layer whose click config is exactly `click`. */
    const layerWithClick = (click: any) => ({
      id: "test-layer",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
      },
      interactive: { click },
    });

    /**
     * Attach the layer, then fire the click listener the handler registered.
     * Asserting on registration alone can't prove dispatch — the handler must
     * actually run for `flyTo` to be observable.
     */
    const fireClick = (click: any, feature: any = { properties: { name: "Test" } }) => {
      handler.attachEvents(layerWithClick(click) as any);
      const registered = mockMap.on.mock.calls.find(
        (call: any[]) => call[0] === "click"
      );
      const clickHandler = registered?.[2];
      clickHandler?.({ features: [feature], lngLat: CLICKED_LNGLAT });
      return clickHandler;
    };

    it("flies to the clicked point with the configured zoom", () => {
      fireClick({ flyTo: { zoom: 12 } });

      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: CLICKED_LNGLAT, zoom: 12 })
      );
    });

    it("uses an explicit center over the clicked point", () => {
      fireClick({ flyTo: { center: [10, 20], zoom: 8 } });

      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [10, 20] })
      );
    });

    it("passes duration through", () => {
      fireClick({ flyTo: { zoom: 5, duration: 2000 } });

      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 2000 })
      );
    });

    it("does not call flyTo for a layer without flyTo configured", () => {
      fireClick({ popup: [{ p: [{ str: "Test" }] }] });

      expect(mockMap.flyTo).not.toHaveBeenCalled();
    });

    it("opens the popup before starting the animation when both are configured", () => {
      fireClick({ popup: [{ p: [{ str: "Test" }] }], flyTo: { zoom: 12 } });

      // Ordering asserted across the two real collaborators — no stubbing — so
      // this survives popup becoming a fully registry-owned interaction.
      expect(popupInstance.addTo.mock.invocationCallOrder[0]).toBeLessThan(
        mockMap.flyTo.mock.invocationCallOrder[0]
      );
    });

    it("builds the popup at the clicked point with the rendered content", () => {
      fireClick({ popup: [{ p: [{ property: "name" }] }] }, {
        properties: { name: "Grand Central" },
      });

      // Guards the registry's popup entry end-to-end: a wrong `select` key or
      // wrong run() arguments would leave this green under a spy-only check.
      expect(popupInstance.setLngLat).toHaveBeenCalledWith(CLICKED_LNGLAT);
      expect(popupInstance.setHTML).toHaveBeenCalledWith(
        expect.stringContaining("Grand Central")
      );
      expect(popupInstance.addTo).toHaveBeenCalled();
    });

    it("honors a zoom of 0", () => {
      fireClick({ flyTo: { zoom: 0 } });

      // 0 is a valid whole-world zoom; a truthiness guard would drop it.
      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ zoom: 0 })
      );
    });

    it("honors a duration of 0", () => {
      fireClick({ flyTo: { duration: 0 } });

      expect(mockMap.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 0 })
      );
    });

    it("omits unset options so MapLibre's defaults apply", () => {
      fireClick({ flyTo: {} });

      // Exact equality, not objectContaining: pinning a default zoom here would
      // be a regression for anyone configuring duration alone.
      expect(mockMap.flyTo).toHaveBeenCalledWith({ center: CLICKED_LNGLAT });
    });

    it("treats a disabled interaction as not configured", () => {
      // `hover.highlight` is a plain boolean in the schema, so a present-but-
      // false config must not run. Pins the dispatch skip rule.
      fireClick({ popup: false as any, flyTo: { zoom: 12 } });

      expect(popupInstance.addTo).not.toHaveBeenCalled();
      expect(mockMap.flyTo).toHaveBeenCalled();
    });

    it("still fires the onClick callback when flyTo is configured", () => {
      fireClick({ flyTo: { zoom: 12 } });

      expect(callbacks.onClick).toHaveBeenCalledWith(
        "test-layer",
        expect.anything(),
        CLICKED_LNGLAT
      );
    });

    it("does nothing when the click hits no feature", () => {
      handler.attachEvents(layerWithClick({ flyTo: { zoom: 12 } }) as any);
      const registered = mockMap.on.mock.calls.find(
        (call: any[]) => call[0] === "click"
      );
      registered?.[2]?.({ features: [], lngLat: CLICKED_LNGLAT });

      expect(mockMap.flyTo).not.toHaveBeenCalled();
    });
  });

  describe("click.emit is inert under the live renderer (R9 deferred)", () => {
    it("does not dispatch or warn for a click.emit, even with a trusted policy", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Constructed trusted, yet `interactionDeps` omits policy + hostHandlers,
      // so the emit built-in's trust gate falls back to DEFAULT_POLICY
      // (untrusted) and emit is inert: no dispatch, and no missing-handler
      // warning (it returns at the gate before touching a host handler map).
      // This is the documented pre-R9 no-op. When R9 threads policy +
      // hostHandlers into these deps, this test's expectations must change
      // consciously — a trusted click.emit with no handler would then WARN.
      const trustedHandler = new EventHandler(
        mockMap,
        callbacks,
        { trust: "trusted" } as any
      );
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          click: { emit: { event: "select", payload: { id: { property: "bbl" } } } },
        },
      };

      trustedHandler.attachEvents(layer as any);
      const registered = mockMap.on.mock.calls.find(
        (c: any[]) => c[0] === "click"
      );
      expect(() =>
        registered?.[2]?.({
          features: [{ properties: { bbl: "x" } }],
          lngLat: { lng: 0, lat: 0 },
        })
      ).not.toThrow();

      // Inert: no host-hook warning today.
      expect(warn).not.toHaveBeenCalled();
      // Dispatch continued past the inert emit — the click callback still ran.
      expect(callbacks.onClick).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("detachEvents", () => {
    it("removes event listeners", () => {
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          hover: { cursor: "pointer" },
          click: { popup: [{ p: [{ str: "Test" }] }] },
        },
      };

      handler.attachEvents(layer);
      handler.detachEvents("test-layer");

      expect(mockMap.off).toHaveBeenCalledWith(
        "mouseenter",
        "test-layer",
        expect.any(Function)
      );
      expect(mockMap.off).toHaveBeenCalledWith(
        "mouseleave",
        "test-layer",
        expect.any(Function)
      );
      expect(mockMap.off).toHaveBeenCalledWith(
        "click",
        "test-layer",
        expect.any(Function)
      );
    });

    it("handles detaching non-existent layer gracefully", () => {
      expect(() => handler.detachEvents("non-existent")).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("cleans up all event handlers", () => {
      const layer1 = {
        id: "layer1",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          click: { popup: [{ p: [{ str: "Test" }] }] },
        },
      };

      const layer2 = {
        id: "layer2",
        type: "line" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          hover: { cursor: "pointer" },
        },
      };

      handler.attachEvents(layer1);
      handler.attachEvents(layer2);

      mockMap.off.mockClear();

      handler.destroy();

      // Should detach events from all attached layers
      expect(mockMap.off).toHaveBeenCalled();
    });
  });
});
