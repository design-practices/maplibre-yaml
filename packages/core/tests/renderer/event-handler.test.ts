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

    it("isolates highlight state across layers attached incrementally (ml-wx2)", () => {
      // Two layers share this EventHandler's interaction runtimes — built once
      // in the constructor and reused per attachEvents (bindLayerInteractions).
      // highlight tracks its lit feature per layerId, so hovering one layer must
      // not disturb the other's state. Pins the shared-runtime property the
      // bind-core convergence rests on, on the incremental attachEvents path.
      handler.attachEvents(
        hoverLayer({ highlight: true }, "src-a") as any
      );
      // Second layer needs a distinct id + source; hoverLayer hardcodes the id,
      // so build B explicitly.
      handler.attachEvents({
        id: "layer-b",
        type: "circle",
        source: "src-b",
        interactive: { hover: { highlight: true } },
      } as any);

      const fireFor = (layerId: string, feature: any) => {
        const call = mockMap.on.mock.calls.find(
          (c: any[]) => c[0] === "mousemove" && c[1] === layerId
        );
        call?.[2]?.({ features: [feature], lngLat: LNGLAT });
      };

      fireFor("test-layer", { id: 7, properties: {} });
      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "src-a", id: 7 },
        { hover: true }
      );
      mockMap.setFeatureState.mockClear();

      // Hovering layer B lights B's feature and never touches layer A's lit one.
      fireFor("layer-b", { id: 8, properties: {} });
      expect(mockMap.setFeatureState).toHaveBeenCalledWith(
        { source: "src-b", id: 8 },
        { hover: true }
      );
      expect(mockMap.setFeatureState).not.toHaveBeenCalledWith(
        { source: "src-a", id: 7 },
        expect.anything()
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

  describe("click.emit honors the trust gate on the shared bind path", () => {
    // KD3/KD4: once `EventHandler` threads `policy` + `hostHandlers` into its
    // interaction deps (the shared-core path), the emit built-in's trust gate is
    // reachable under the live renderer. This block replaces the pre-R9
    // "emit is inert even when trusted" characterization: emit is no longer
    // unconditionally inert — it is trust-gated, and the fail-closed default
    // (the only thing `MapRenderer`/`<ml-map>` supplies) keeps it inert there.

    const emitLayer = () => ({
      id: "test-layer",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
      },
      interactive: {
        click: {
          emit: { event: "select", payload: { id: { property: "bbl" } } },
        },
      },
    });

    /** Fire the click listener the handler registered on `map`. */
    const fireEmitClick = (h: EventHandler) => {
      h.attachEvents(emitLayer() as any);
      const registered = mockMap.on.mock.calls.find(
        (c: any[]) => c[0] === "click"
      );
      registered?.[2]?.({
        features: [{ properties: { bbl: "x" } }],
        lngLat: { lng: 0, lat: 0 },
      });
    };

    it("trusted + no registered handler now WARNS, and dispatch continues", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Trusted policy, but no host handler map. The trust gate passes, so the
      // emit built-in reaches closed-world resolution, finds no handler for
      // "select", and warns — the `built-ins.ts` missing-handler warning, now
      // reachable under the renderer (was silent pre-R9).
      const trustedHandler = new EventHandler(
        mockMap,
        callbacks,
        { trust: "trusted" } as any
      );

      expect(() => fireEmitClick(trustedHandler)).not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/no registered host handler/i);
      // Dispatch continued past the denied emit — the click callback still ran.
      expect(callbacks.onClick).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("trusted + a registered handler DISPATCHES the projected payload", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onSelect = vi.fn();

      // Trusted policy AND a host handler for "select": the event dispatches,
      // carrying the payload projected from the clicked feature's properties.
      const trustedHandler = new EventHandler(
        mockMap,
        callbacks,
        { trust: "trusted" } as any,
        { select: onSelect }
      );

      fireEmitClick(trustedHandler);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith({ id: "x" });
      // A resolved handler means no missing-handler warning.
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("untrusted + click.emit denies SILENTLY (no dispatch, no warn) — unchanged", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onSelect = vi.fn();

      // Untrusted denies at the trust gate before resolution, so even a
      // supplied handler never runs and nothing warns (R5, unchanged behavior).
      const untrustedHandler = new EventHandler(
        mockMap,
        callbacks,
        { trust: "untrusted" } as any,
        { select: onSelect }
      );

      fireEmitClick(untrustedHandler);

      expect(onSelect).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      // Dispatch still continued to the raw-event callback.
      expect(callbacks.onClick).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("SECURITY (fail-closed default): no policy + no hostHandlers keeps emit inert", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // This is the `MapRenderer`/`<ml-map>` path: no `capabilities` and no
      // `hostHandlers` reach the constructor, so the policy defaults to
      // untrusted and emit is denied at the trust gate — no dispatch, no warn.
      // Pinned so a future change forwarding either can't silently make emit
      // live under `<ml-map>` (security-review residual).
      const defaultHandler = new EventHandler(mockMap, callbacks);

      expect(() => fireEmitClick(defaultHandler)).not.toThrow();

      // Inert: gated off before touching a handler map, so no warning either.
      expect(warn).not.toHaveBeenCalled();
      // Dispatch continued past the inert emit — the click callback still ran.
      expect(callbacks.onClick).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("SECURITY: an untrusted policy still ESCAPES an !html popup via the shared core", () => {
      // The popup XSS gate must survive the delegation, not just the emit gate:
      // an untrusted `PopupBuilder(policy)` escapes an `!html` marker rather
      // than rendering it as live markup, on the same shared-core path.
      const untrustedHandler = new EventHandler(
        mockMap,
        callbacks,
        { trust: "untrusted" } as any
      );
      const layer = {
        id: "test-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
        interactive: {
          click: {
            popup: [
              { p: [{ str: { $html: "<b>bold</b>" } }, { property: "name" }] },
            ],
          },
        },
      };

      untrustedHandler.attachEvents(layer as any);
      const registered = mockMap.on.mock.calls.find(
        (c: any[]) => c[0] === "click"
      );
      registered?.[2]?.({
        features: [{ properties: { name: "<script>alert(1)</script>" } }],
        lngLat: { lng: 0, lat: 0 },
      });

      const html = popupInstance.setHTML.mock.calls[0]?.[0] as string;
      expect(html).toBeDefined();
      // The `!html` marker is denied: escaped text, not live markup.
      expect(html).not.toContain("<b>bold</b>");
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      // The feature property is escaped unconditionally.
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
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
