/**
 * @file Tests for config-resolver utilities
 * @module @maplibre-yaml/core/tests/utils/config-resolver
 */

import { describe, it, expect } from "vitest";
import {
  resolveMapConfig,
  resolveMapBlock,
  isMapConfigComplete,
  createSimpleMapConfig,
  ConfigResolutionError,
} from "../../src/utils/config-resolver";
import type { MapConfig, GlobalConfig, MapBlock } from "../../src/schemas";

// ── Helpers ──────────────────────────────────────────────────────────

function makeMapConfig(
  overrides: Partial<MapConfig> = {},
): Partial<MapConfig> & { center: [number, number]; zoom: number } {
  return {
    center: [-74.006, 40.7128],
    zoom: 12,
    mapStyle: "https://demotiles.maplibre.org/style.json",
    ...overrides,
  };
}

function makeGlobalConfig(
  overrides: Partial<GlobalConfig> = {},
): GlobalConfig {
  return {
    theme: "light" as const,
    ...overrides,
  };
}

// ── Baseline tests (existing behavior) ──────────────────────────────

describe("resolveMapConfig", () => {
  describe("baseline: current behavior", () => {
    it("returns all fields unchanged when fully specified", () => {
      const config = makeMapConfig();
      const result = resolveMapConfig(config);

      expect(result.center).toEqual([-74.006, 40.7128]);
      expect(result.zoom).toBe(12);
      expect(result.mapStyle).toBe(
        "https://demotiles.maplibre.org/style.json",
      );
      expect(result.interactive).toBe(true);
      expect(result.pitch).toBe(0);
      expect(result.bearing).toBe(0);
    });

    it("throws ConfigResolutionError when mapStyle is missing", () => {
      const config = makeMapConfig({ mapStyle: undefined });

      expect(() => resolveMapConfig(config)).toThrow(ConfigResolutionError);
      try {
        resolveMapConfig(config);
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigResolutionError);
        expect((e as ConfigResolutionError).missingFields).toContain(
          "mapStyle",
        );
      }
    });

    it("inherits mapStyle from globalConfig when not set", () => {
      const config = makeMapConfig({ mapStyle: undefined });
      const global = makeGlobalConfig({
        defaultMapStyle: "https://global.example.com/style.json",
      });

      const result = resolveMapConfig(config, global);

      expect(result.mapStyle).toBe("https://global.example.com/style.json");
    });

    it("prefers explicit mapStyle over globalConfig default", () => {
      const config = makeMapConfig({
        mapStyle: "https://explicit.example.com/style.json",
      });
      const global = makeGlobalConfig({
        defaultMapStyle: "https://global.example.com/style.json",
      });

      const result = resolveMapConfig(config, global);

      expect(result.mapStyle).toBe("https://explicit.example.com/style.json");
    });

    it("applies defaults for interactive, pitch, bearing", () => {
      const config = makeMapConfig();
      const result = resolveMapConfig(config);

      expect(result.interactive).toBe(true);
      expect(result.pitch).toBe(0);
      expect(result.bearing).toBe(0);
    });

    it("preserves explicit interactive, pitch, bearing values", () => {
      const config = makeMapConfig({
        interactive: false,
        pitch: 45,
        bearing: 90,
      });

      const result = resolveMapConfig(config);

      expect(result.interactive).toBe(false);
      expect(result.pitch).toBe(45);
      expect(result.bearing).toBe(90);
    });
  });

  describe("zoom/center inheritance from globalConfig", () => {
    const globalWithDefaults = makeGlobalConfig({
      defaultMapStyle: "https://global.example.com/style.json",
      defaultCenter: [-74.006, 40.7128] as [number, number],
      defaultZoom: 10,
    });

    it("inherits center from globalConfig when not set in mapConfig", () => {
      const result = resolveMapConfig(
        { zoom: 12, mapStyle: "https://example.com/style.json" },
        globalWithDefaults,
      );

      expect(result.center).toEqual([-74.006, 40.7128]);
    });

    it("inherits zoom from globalConfig when not set in mapConfig", () => {
      const result = resolveMapConfig(
        {
          center: [2.3522, 48.8566] as [number, number],
          mapStyle: "https://example.com/style.json",
        },
        globalWithDefaults,
      );

      expect(result.zoom).toBe(10);
    });

    it("prefers mapConfig center/zoom over globalConfig defaults", () => {
      const result = resolveMapConfig(
        {
          center: [2.3522, 48.8566] as [number, number],
          zoom: 15,
          mapStyle: "https://example.com/style.json",
        },
        globalWithDefaults,
      );

      expect(result.center).toEqual([2.3522, 48.8566]);
      expect(result.zoom).toBe(15);
    });

    it("throws when neither mapConfig nor globalConfig provides center", () => {
      const globalNoCenter = makeGlobalConfig({
        defaultMapStyle: "https://global.example.com/style.json",
        defaultZoom: 10,
      });

      expect(() =>
        resolveMapConfig(
          { zoom: 12, mapStyle: "https://example.com/style.json" },
          globalNoCenter,
        ),
      ).toThrow(ConfigResolutionError);

      try {
        resolveMapConfig(
          { zoom: 12, mapStyle: "https://example.com/style.json" },
          globalNoCenter,
        );
      } catch (e) {
        expect((e as ConfigResolutionError).missingFields).toContain("center");
      }
    });

    it("throws when neither mapConfig nor globalConfig provides zoom", () => {
      const globalNoZoom = makeGlobalConfig({
        defaultMapStyle: "https://global.example.com/style.json",
        defaultCenter: [-74.006, 40.7128] as [number, number],
      });

      expect(() =>
        resolveMapConfig(
          {
            center: [0, 0] as [number, number],
            mapStyle: "https://example.com/style.json",
          },
          globalNoZoom,
        ),
      ).toThrow(ConfigResolutionError);

      try {
        resolveMapConfig(
          {
            center: [0, 0] as [number, number],
            mapStyle: "https://example.com/style.json",
          },
          globalNoZoom,
        );
      } catch (e) {
        expect((e as ConfigResolutionError).missingFields).toContain("zoom");
      }
    });

    it("cross-inherits: center from mapConfig, zoom from globalConfig", () => {
      const result = resolveMapConfig(
        {
          center: [2.3522, 48.8566] as [number, number],
          mapStyle: "https://example.com/style.json",
        },
        globalWithDefaults,
      );

      expect(result.center).toEqual([2.3522, 48.8566]);
      expect(result.zoom).toBe(10);
    });

    it("handles globalConfig without defaultCenter/defaultZoom", () => {
      const globalMinimal = makeGlobalConfig({
        defaultMapStyle: "https://global.example.com/style.json",
      });

      // Should still work when mapConfig provides center/zoom
      const result = resolveMapConfig(
        makeMapConfig({ mapStyle: undefined }),
        globalMinimal,
      );

      expect(result.center).toEqual([-74.006, 40.7128]);
      expect(result.zoom).toBe(12);
      expect(result.mapStyle).toBe("https://global.example.com/style.json");
    });

    it("error message lists all missing fields", () => {
      try {
        resolveMapConfig({}, makeGlobalConfig());
      } catch (e) {
        const err = e as ConfigResolutionError;
        expect(err.missingFields).toContain("mapStyle");
        expect(err.missingFields).toContain("center");
        expect(err.missingFields).toContain("zoom");
        expect(err.message).toContain("defaultCenter");
        expect(err.message).toContain("defaultZoom");
      }
    });

    it("inherits all three: mapStyle, center, zoom from globalConfig", () => {
      const result = resolveMapConfig({}, globalWithDefaults);

      expect(result.mapStyle).toBe("https://global.example.com/style.json");
      expect(result.center).toEqual([-74.006, 40.7128]);
      expect(result.zoom).toBe(10);
    });
  });
});

describe("resolveMapBlock", () => {
  it("resolves config within a map block", () => {
    const block: MapBlock = {
      type: "map",
      id: "test-map",
      config: makeMapConfig({ mapStyle: undefined }) as MapConfig,
      layers: [],
    };
    const global = makeGlobalConfig({
      defaultMapStyle: "https://global.example.com/style.json",
    });

    const result = resolveMapBlock(block, global);

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
    expect(result.id).toBe("test-map");
    expect(result.layers).toEqual([]);
  });
});

describe("isMapConfigComplete", () => {
  it("returns true when all required fields present", () => {
    const config = makeMapConfig();
    expect(isMapConfigComplete(config)).toBe(true);
  });

  it("returns false when center is missing", () => {
    expect(
      isMapConfigComplete({
        zoom: 12,
        mapStyle: "https://example.com/style.json",
      }),
    ).toBe(false);
  });

  it("returns false when zoom is missing", () => {
    expect(
      isMapConfigComplete({
        center: [0, 0],
        mapStyle: "https://example.com/style.json",
      }),
    ).toBe(false);
  });

  it("returns false when mapStyle is missing", () => {
    expect(isMapConfigComplete({ center: [0, 0], zoom: 12 })).toBe(false);
  });
});

describe("createSimpleMapConfig", () => {
  it("creates config with defaults", () => {
    const result = createSimpleMapConfig({
      center: [-74.006, 40.7128],
      mapStyle: "https://example.com/style.json",
    });

    expect(result.center).toEqual([-74.006, 40.7128]);
    expect(result.zoom).toBe(12);
    expect(result.mapStyle).toBe("https://example.com/style.json");
    expect(result.pitch).toBe(0);
    expect(result.bearing).toBe(0);
    expect(result.interactive).toBe(true);
  });

  it("respects explicit overrides", () => {
    const result = createSimpleMapConfig({
      center: [-74.006, 40.7128],
      mapStyle: "https://example.com/style.json",
      zoom: 8,
      pitch: 30,
      bearing: 45,
      interactive: false,
    });

    expect(result.zoom).toBe(8);
    expect(result.pitch).toBe(30);
    expect(result.bearing).toBe(45);
    expect(result.interactive).toBe(false);
  });

  it("inherits mapStyle from globalConfig", () => {
    const global = makeGlobalConfig({
      defaultMapStyle: "https://global.example.com/style.json",
    });

    const result = createSimpleMapConfig(
      { center: [-74.006, 40.7128] },
      global,
    );

    expect(result.mapStyle).toBe("https://global.example.com/style.json");
  });
});
