import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock maplibre-gl before import
vi.mock("maplibre-gl", () => ({
  default: {
    Popup: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
  },
}));

import { EventHandler } from "../../src/renderer/event-handler";

describe("EventHandler", () => {
  let mockMap: any;
  let handler: EventHandler;
  let callbacks: any;

  beforeEach(() => {
    mockMap = {
      on: vi.fn(),
      off: vi.fn(),
      getCanvas: vi.fn(() => ({
        style: { cursor: "" },
      })),
    };

    callbacks = {
      onClick: vi.fn(),
      onHover: vi.fn(),
    };

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
