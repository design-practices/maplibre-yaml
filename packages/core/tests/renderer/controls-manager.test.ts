import { describe, it, expect, beforeEach, vi } from "vitest";
import { ControlsManager } from "../../src/renderer/controls-manager";

// Mock maplibre-gl
vi.mock("maplibre-gl", () => {
  const NavigationControl = vi.fn(() => ({ type: "navigation" }));
  const GeolocateControl = vi.fn(() => ({ type: "geolocate" }));
  const ScaleControl = vi.fn(() => ({ type: "scale" }));
  const FullscreenControl = vi.fn(() => ({ type: "fullscreen" }));
  const AttributionControl = vi.fn((options) => ({ type: "attribution", options }));
  return {
    default: { NavigationControl, GeolocateControl, ScaleControl, FullscreenControl, AttributionControl },
    NavigationControl,
    GeolocateControl,
    ScaleControl,
    FullscreenControl,
    AttributionControl,
  };
});

describe("ControlsManager", () => {
  let mockMap: any;
  let manager: ControlsManager;

  beforeEach(() => {
    mockMap = {
      addControl: vi.fn(),
      removeControl: vi.fn(),
    };

    manager = new ControlsManager(mockMap);
  });

  describe("addControls", () => {
    it("adds navigation control", () => {
      const config = {
        navigation: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "navigation" }),
        "top-right"
      );
    });

    it("adds geolocate control", () => {
      const config = {
        geolocate: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "geolocate" }),
        "top-right"
      );
    });

    it("adds scale control", () => {
      const config = {
        scale: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "scale" }),
        "bottom-left"
      );
    });

    it("adds fullscreen control", () => {
      const config = {
        fullscreen: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "fullscreen" }),
        "top-right"
      );
    });

    it("adds multiple controls", () => {
      const config = {
        navigation: true,
        scale: true,
        fullscreen: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledTimes(3);
    });

    it("does nothing for empty config", () => {
      const config = {};

      manager.addControls(config);

      expect(mockMap.addControl).not.toHaveBeenCalled();
    });

    it("respects custom positions", () => {
      const config = {
        navigation: {
          position: "bottom-right" as const,
        },
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.any(Object),
        "bottom-right"
      );
    });

    it("adds attribution control at bottom-right by default", () => {
      const config = {
        attribution: true,
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledTimes(1);
      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "attribution" }),
        "bottom-right"
      );
    });

    it("respects a custom attribution position", () => {
      const config = {
        attribution: {
          position: "top-left" as const,
        },
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({ type: "attribution" }),
        "top-left"
      );
    });

    it("passes compact and customAttribution to the attribution control", () => {
      const config = {
        attribution: {
          compact: true,
          customAttribution: "© Example",
        },
      };

      manager.addControls(config);

      expect(mockMap.addControl).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "attribution",
          options: expect.objectContaining({
            compact: true,
            customAttribution: "© Example",
          }),
        }),
        "bottom-right"
      );
    });
  });

  describe("removeAllControls", () => {
    it("removes all added controls", () => {
      const config = {
        navigation: true,
        scale: true,
        geolocate: true,
      };

      manager.addControls(config);
      manager.removeAllControls();

      expect(mockMap.removeControl).toHaveBeenCalledTimes(3);
    });

    it("handles calling removeAllControls when no controls added", () => {
      expect(() => manager.removeAllControls()).not.toThrow();
    });
  });
});
