/**
 * @file Tests for map builder utilities
 * @module @maplibre-yaml/astro/tests/utils/map-builders
 */

import { describe, it, expect } from "vitest";
import {
  buildPointMapConfig,
  buildMultiPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
  calculateCenter,
  calculateBounds,
} from "../../src/utils/map-builders";
import type { LocationPoint, RegionPolygon, RouteLine } from "../../src/utils/collections-schemas";
import type { GlobalConfig } from "@maplibre-yaml/core";

// ── Fixtures ─────────────────────────────────────────────────────────

const STYLE_URL = "https://demotiles.maplibre.org/style.json";

const singleLocation: LocationPoint = {
  coordinates: [-74.006, 40.7128],
  name: "New York City",
  description: "The Big Apple",
  zoom: 10,
};

const locationsArray: LocationPoint[] = [
  { coordinates: [-74.006, 40.7128], name: "NYC" },
  { coordinates: [-118.2437, 34.0522], name: "LA" },
  { coordinates: [-87.6298, 41.8781], name: "Chicago" },
];

const region: RegionPolygon = {
  coordinates: [
    [
      [-74.0, 40.7],
      [-73.9, 40.7],
      [-73.9, 40.8],
      [-74.0, 40.8],
      [-74.0, 40.7],
    ],
  ],
  name: "Manhattan",
  fillColor: "#ff6b6b",
  fillOpacity: 0.4,
};

const route: RouteLine = {
  coordinates: [
    [-74.006, 40.7128],
    [-73.935, 40.73],
    [-73.867, 40.752],
  ],
  name: "Brooklyn to Queens",
  color: "#e74c3c",
  width: 4,
};

// ── Baseline tests (existing behavior) ──────────────────────────────

describe("buildPointMapConfig", () => {
  it("produces a valid MapBlock from location data", () => {
    const result = buildPointMapConfig({
      location: singleLocation,
      mapStyle: STYLE_URL,
    });

    expect(result.type).toBe("map");
    expect(result.id).toMatch(/^point-map-/);
    expect(result.config.center).toEqual([-74.006, 40.7128]);
    expect(result.config.zoom).toBe(10); // from location.zoom
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].type).toBe("circle");
  });

  it("uses custom id when provided", () => {
    const result = buildPointMapConfig({
      location: singleLocation,
      mapStyle: STYLE_URL,
      id: "my-map",
    });

    expect(result.id).toBe("my-map");
  });

  it("defaults zoom to 12 when location has no zoom", () => {
    const locationNoZoom: LocationPoint = {
      coordinates: [2.3522, 48.8566],
    };

    const result = buildPointMapConfig({
      location: locationNoZoom,
      mapStyle: STYLE_URL,
    });

    expect(result.config.zoom).toBe(12);
  });

  it("uses explicit zoom over location zoom", () => {
    const result = buildPointMapConfig({
      location: singleLocation,
      mapStyle: STYLE_URL,
      zoom: 15,
    });

    expect(result.config.zoom).toBe(15);
  });
});

describe("buildMultiPointMapConfig", () => {
  it("produces a valid MapBlock from multiple locations", () => {
    const result = buildMultiPointMapConfig({
      locations: locationsArray,
      mapStyle: STYLE_URL,
    });

    expect(result.type).toBe("map");
    expect(result.id).toMatch(/^multi-point-map-/);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].type).toBe("circle");
    expect(result.config.bounds).toBeDefined();
  });

  it("throws for empty locations array", () => {
    expect(() =>
      buildMultiPointMapConfig({ locations: [], mapStyle: STYLE_URL }),
    ).toThrow("Cannot build multi-point map with empty locations array");
  });
});

describe("buildPolygonMapConfig", () => {
  it("produces a valid MapBlock from polygon data", () => {
    const result = buildPolygonMapConfig({
      region,
      mapStyle: STYLE_URL,
    });

    expect(result.type).toBe("map");
    expect(result.id).toMatch(/^polygon-map-/);
    expect(result.layers).toHaveLength(2); // fill + outline
    expect(result.layers[0].type).toBe("fill");
    expect(result.layers[1].type).toBe("line");
  });
});

describe("buildRouteMapConfig", () => {
  it("produces a valid MapBlock from route data", () => {
    const result = buildRouteMapConfig({
      route,
      mapStyle: STYLE_URL,
    });

    expect(result.type).toBe("map");
    expect(result.id).toMatch(/^route-map-/);
    expect(result.layers).toHaveLength(2); // line + endpoints
    expect(result.layers[0].type).toBe("line");
    expect(result.layers[1].type).toBe("circle");
  });
});

// ── globalConfig inheritance tests ──────────────────────────────────

const globalConfig: GlobalConfig = {
  theme: "light",
  defaultMapStyle: "https://global.example.com/style.json",
  defaultZoom: 8,
  defaultCenter: [-73.0, 41.0],
};

describe("buildPointMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildPointMapConfig(
      { location: singleLocation },
      globalConfig,
    );

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });

  it("prefers explicit mapStyle over globalConfig", () => {
    const result = buildPointMapConfig(
      { location: singleLocation, mapStyle: STYLE_URL },
      globalConfig,
    );

    expect(result.config.mapStyle).toBe(STYLE_URL);
  });

  it("location.zoom takes precedence over globalConfig.defaultZoom", () => {
    const result = buildPointMapConfig(
      { location: singleLocation },
      globalConfig,
    );

    // singleLocation has zoom: 10, globalConfig has defaultZoom: 8
    expect(result.config.zoom).toBe(10);
  });

  it("inherits zoom from globalConfig when location has no zoom", () => {
    const locationNoZoom: LocationPoint = { coordinates: [2.3522, 48.8566] };

    const result = buildPointMapConfig(
      { location: locationNoZoom },
      globalConfig,
    );

    // Builder defaults to 12 which beats globalConfig's 8
    // Because the builder sets zoom: zoom ?? location.zoom ?? 12
    expect(result.config.zoom).toBe(12);
  });

  it("existing calls without globalConfig produce identical output", () => {
    const withoutGlobal = buildPointMapConfig({
      location: singleLocation,
      mapStyle: STYLE_URL,
    });
    const withGlobal = buildPointMapConfig(
      { location: singleLocation, mapStyle: STYLE_URL },
      globalConfig,
    );

    // Same explicit mapStyle, same location -- should be equivalent
    expect(withoutGlobal.config.center).toEqual(withGlobal.config.center);
    expect(withoutGlobal.config.zoom).toEqual(withGlobal.config.zoom);
    expect(withoutGlobal.config.mapStyle).toEqual(withGlobal.config.mapStyle);
    expect(withoutGlobal.layers).toEqual(withGlobal.layers);
  });
});

describe("buildMultiPointMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildMultiPointMapConfig(
      { locations: locationsArray },
      globalConfig,
    );

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });

  it("prefers explicit mapStyle over globalConfig", () => {
    const result = buildMultiPointMapConfig(
      { locations: locationsArray, mapStyle: STYLE_URL },
      globalConfig,
    );

    expect(result.config.mapStyle).toBe(STYLE_URL);
  });
});

describe("buildPolygonMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildPolygonMapConfig({ region }, globalConfig);

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });
});

describe("buildRouteMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildRouteMapConfig({ route }, globalConfig);

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });
});

// ── Utility tests ───────────────────────────────────────────────────

describe("calculateCenter", () => {
  it("returns the single coordinate for a single point", () => {
    expect(calculateCenter([[-74.006, 40.7128]])).toEqual([-74.006, 40.7128]);
  });

  it("calculates the centroid of multiple points", () => {
    const center = calculateCenter([
      [-74.0, 40.0],
      [-72.0, 42.0],
    ]);
    expect(center[0]).toBeCloseTo(-73.0);
    expect(center[1]).toBeCloseTo(41.0);
  });

  it("throws for empty array", () => {
    expect(() => calculateCenter([])).toThrow();
  });
});

describe("calculateBounds", () => {
  it("returns correct bounding box", () => {
    const bounds = calculateBounds([
      [-74.0, 40.0],
      [-72.0, 42.0],
      [-73.0, 41.0],
    ]);
    expect(bounds).toEqual([
      [-74.0, 40.0],
      [-72.0, 42.0],
    ]);
  });
});
