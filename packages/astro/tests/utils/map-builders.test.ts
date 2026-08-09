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
import {
  ConfigResolutionError,
  expandGeoSugar,
  project,
  isSugarError,
} from "@maplibre-yaml/core";
import type { SugarKey } from "@maplibre-yaml/core";

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
    expect(result.layers[0]!.type).toBe("line");
    expect(result.layers[1]!.type).toBe("circle");
  });

  it("places line-cap and line-join in layout (NOT paint)", () => {
    // Regression: MapLibre v5 rejects unknown paint properties; line-cap and
    // line-join are layout properties per the style spec. Putting them in
    // paint causes the line layer to render with degraded styling (or, in
    // some versions, not at all -- the user reported "renders as two points
    // instead of a line" on the showcase page).
    const result = buildRouteMapConfig({ route, mapStyle: STYLE_URL });
    const lineLayer = result.layers[0] as {
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    };

    expect(lineLayer.paint).toBeDefined();
    expect(lineLayer.paint!["line-color"]).toBeDefined();
    expect(lineLayer.paint!["line-width"]).toBeDefined();
    expect(lineLayer.paint!["line-cap"]).toBeUndefined();
    expect(lineLayer.paint!["line-join"]).toBeUndefined();

    expect(lineLayer.layout).toBeDefined();
    expect(lineLayer.layout!["line-cap"]).toBe("round");
    expect(lineLayer.layout!["line-join"]).toBe("round");
  });
});

// ── Core-expander shape agreement (R7 / U4, ml-4jq) ─────────────────
//
// Each Astro builder inlines the base Feature that core's `expandGeoSugar`
// also produces. These tests pin that the two agree on geometry +
// `{name,description}`, so `location:`/`region:`/`route:` mean the same thing
// authored in YAML (core) or via the Astro helper. The Astro node carries
// paint/camera fields the expander rejects (R4/KTD2), so agreement is asserted
// against the *projected* node — `expandGeoSugar(project(node), key).value` —
// per KTD4. (Delegation — builders calling the expander — is deferred to a
// follow-up; the base Feature is entangled with the shared Multi* helpers and
// the multi-point `markerColor`-in-properties, so a straight substitution is
// not clean. Coverage-only prevents drift by test, not by construction.)

/** Loose GeoJSON shapes for assertions (core does not re-export geojson types). */
interface GeoFeature {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown>;
}
interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/**
 * Project a richer Astro node, expand it via core, and return the built
 * GeoJSON value — throwing if the expander reports a structural error (which
 * would itself be a real disagreement worth failing on).
 */
function expandValue(node: unknown, key: SugarKey): GeoFeature | GeoFeatureCollection {
  const result = expandGeoSugar(project(node), key);
  if (isSugarError(result)) {
    throw new Error(`expandGeoSugar(${key}) unexpectedly errored: ${result.message}`);
  }
  return result.value as unknown as GeoFeature | GeoFeatureCollection;
}

/** Pull the base Feature out of a builder layer's inline geojson source. */
function baseFeatures(layer: unknown): GeoFeature[] {
  const source = (layer as { source?: unknown }).source;
  const data = (source as { data?: { features?: GeoFeature[] } }).data;
  return data!.features!;
}

describe("core-expander shape agreement (R7)", () => {
  it("buildPointMapConfig base Feature equals expandGeoSugar(project(location))", () => {
    const result = buildPointMapConfig({
      location: singleLocation,
      mapStyle: STYLE_URL,
    });

    const builderFeature = baseFeatures(result.layers[0])[0];
    expect(builderFeature).toEqual(expandValue(singleLocation, "location"));
  });

  it("buildPolygonMapConfig region-fill base Feature equals expandGeoSugar(project(region))", () => {
    const result = buildPolygonMapConfig({ region, mapStyle: STYLE_URL });

    // region-fill is the first layer; region-outline (line) is the second.
    expect(result.layers[0]!.id).toBe("region-fill");
    const builderFeature = baseFeatures(result.layers[0])[0];
    expect(builderFeature).toEqual(expandValue(region, "region"));
  });

  it("buildRouteMapConfig route-line base Feature equals expandGeoSugar(project(route))", () => {
    const result = buildRouteMapConfig({ route, mapStyle: STYLE_URL });

    // route-line is the first layer; route-endpoints (circle) is the second.
    expect(result.layers[0]!.id).toBe("route-line");
    const builderFeature = baseFeatures(result.layers[0])[0];
    expect(builderFeature).toEqual(expandValue(route, "route"));
  });

  it("buildMultiPointMapConfig base Features agree on geometry + name/description; markerColor is a builder-side extra", () => {
    const result = buildMultiPointMapConfig({
      locations: locationsArray,
      mapStyle: STYLE_URL,
    });

    const builderFeatures = baseFeatures(result.layers[0]);
    const expanded = expandValue(locationsArray, "locations") as GeoFeatureCollection;

    expect(builderFeatures).toHaveLength(expanded.features.length);

    builderFeatures.forEach((bf, i) => {
      const ef = expanded.features[i];
      // Geometry agrees exactly.
      expect(bf.geometry).toEqual(ef.geometry);
      // name/description agree; the expander carries only these.
      expect({
        name: bf.properties.name,
        description: bf.properties.description,
      }).toEqual({
        name: ef.properties.name,
        description: ef.properties.description,
      });
      // markerColor is a builder-side extra the expander does NOT carry.
      expect(ef.properties).not.toHaveProperty("markerColor");
      expect(bf.properties.markerColor).toBe("#3388ff");
    });
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

    // globalConfig.defaultZoom (8) beats the builder's built-in 12
    expect(result.config.zoom).toBe(8);
  });

  it("explicit zoom takes precedence over globalConfig.defaultZoom", () => {
    const locationNoZoom: LocationPoint = { coordinates: [2.3522, 48.8566] };

    const result = buildPointMapConfig(
      { location: locationNoZoom, zoom: 15 },
      globalConfig,
    );

    expect(result.config.zoom).toBe(15);
  });

  it("falls back to 12 when neither location nor globalConfig provide zoom", () => {
    const locationNoZoom: LocationPoint = { coordinates: [2.3522, 48.8566] };
    const globalNoZoom: GlobalConfig = {
      theme: "light",
      defaultMapStyle: "https://global.example.com/style.json",
    };

    const result = buildPointMapConfig(
      { location: locationNoZoom },
      globalNoZoom,
    );

    expect(result.config.zoom).toBe(12);
  });

  it("location coordinates take precedence over globalConfig.defaultCenter", () => {
    const result = buildPointMapConfig(
      { location: singleLocation },
      globalConfig,
    );

    // globalConfig.defaultCenter is [-73.0, 41.0]; location wins
    expect(result.config.center).toEqual([-74.006, 40.7128]);
  });

  it("throws ConfigResolutionError when mapStyle is missing everywhere", () => {
    expect(() =>
      buildPointMapConfig({ location: singleLocation }),
    ).toThrow(ConfigResolutionError);
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

  it("inherits zoom from globalConfig.defaultZoom", () => {
    const result = buildMultiPointMapConfig(
      { locations: locationsArray },
      globalConfig,
    );

    // bounds still take precedence when rendering, but the config value
    // inherits the global default rather than the hardcoded 10
    expect(result.config.zoom).toBe(8);
  });
});

describe("buildPolygonMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildPolygonMapConfig({ region }, globalConfig);

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });

  it("inherits zoom from globalConfig.defaultZoom", () => {
    const result = buildPolygonMapConfig({ region }, globalConfig);

    expect(result.config.zoom).toBe(8);
  });

  it("explicit zoom takes precedence over globalConfig.defaultZoom", () => {
    const result = buildPolygonMapConfig({ region, zoom: 14 }, globalConfig);

    expect(result.config.zoom).toBe(14);
  });

  it("falls back to 12 when neither options nor globalConfig provide zoom", () => {
    const result = buildPolygonMapConfig({ region, mapStyle: STYLE_URL });

    expect(result.config.zoom).toBe(12);
  });
});

describe("buildRouteMapConfig with globalConfig", () => {
  it("inherits mapStyle from globalConfig", () => {
    const result = buildRouteMapConfig({ route }, globalConfig);

    expect(result.config.mapStyle).toBe(
      "https://global.example.com/style.json",
    );
  });

  it("inherits zoom from globalConfig.defaultZoom", () => {
    const result = buildRouteMapConfig({ route }, globalConfig);

    expect(result.config.zoom).toBe(8);
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
