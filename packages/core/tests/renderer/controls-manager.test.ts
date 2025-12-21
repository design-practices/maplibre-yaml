import { describe, it, expect, beforeEach, vi } from "vitest";
import { ControlsManager } from "../../src/renderer/controls-manager";

// Mock maplibre-gl
vi.mock("maplibre-gl", () => ({
  default: {
    NavigationControl: vi.fn(() => ({ type: "navigation" })),
    GeolocateControl: vi.fn(() => ({ type: "geolocate" })),
    ScaleControl: vi.fn(() => ({ type: "scale" })),
    FullscreenControl: vi.fn(() => ({ type: "fullscreen" })),
  },
}));

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
