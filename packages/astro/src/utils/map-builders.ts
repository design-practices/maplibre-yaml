/**
 * @file Map configuration builders for blog integration
 * @module @maplibre-yaml/astro/utils/map-builders
 *
 * @description
 * Utility functions for creating MapBlock configurations from simple
 * geographic data. These functions convert location points, polygons,
 * and routes into properly structured map configurations.
 *
 * ## Usage
 *
 * Use these builders to create map configurations from blog frontmatter
 * data without manually constructing the full MapBlock structure.
 *
 * @example Point Map from Location
 * ```astro
 * ---
 * import { Map } from '@maplibre-yaml/astro';
 * import { buildPointMapConfig } from '@maplibre-yaml/astro/utils';
 *
 * const { location } = Astro.props.entry.data;
 * const mapConfig = buildPointMapConfig({
 *   location,
 *   mapStyle: 'https://demotiles.maplibre.org/style.json'
 * });
 * ---
 * <Map config={mapConfig} height="300px" />
 * ```
 */

import type { MapBlock, MapConfig } from "@maplibre-yaml/core";
import type {
  LocationPoint,
  RegionPolygon,
  RouteLine,
} from "./collections-schemas";

/**
 * Default marker color for point maps.
 */
const DEFAULT_MARKER_COLOR = "#3388ff";

/**
 * Default polygon fill color.
 */
const DEFAULT_FILL_COLOR = "#3388ff";

/**
 * Default polygon fill opacity.
 */
const DEFAULT_FILL_OPACITY = 0.3;

/**
 * Default line color for routes.
 */
const DEFAULT_LINE_COLOR = "#3388ff";

/**
 * Default line width for routes.
 */
const DEFAULT_LINE_WIDTH = 3;

/**
 * Options for building point map configurations.
 */
export interface PointMapOptions {
  /** Location data with coordinates and optional metadata */
  location: LocationPoint;
  /** MapLibre style URL (required if no global default) */
  mapStyle?: string;
  /** Override zoom level (defaults to location.zoom or 12) */
  zoom?: number;
  /** Map ID for the block */
  id?: string;
  /** Whether the map should be interactive */
  interactive?: boolean;
}

/**
 * Options for building multi-point map configurations.
 */
export interface MultiPointMapOptions {
  /** Array of location points */
  locations: LocationPoint[];
  /** MapLibre style URL (required if no global default) */
  mapStyle?: string;
  /** Padding around bounds in pixels */
  padding?: number;
  /** Map ID for the block */
  id?: string;
  /** Whether the map should be interactive */
  interactive?: boolean;
}

/**
 * Options for building polygon map configurations.
 */
export interface PolygonMapOptions {
  /** Polygon region data */
  region: RegionPolygon;
  /** MapLibre style URL (required if no global default) */
  mapStyle?: string;
  /** Override zoom level */
  zoom?: number;
  /** Map ID for the block */
  id?: string;
  /** Whether the map should be interactive */
  interactive?: boolean;
}

/**
 * Options for building route/line map configurations.
 */
export interface RouteMapOptions {
  /** Route line data */
  route: RouteLine;
  /** MapLibre style URL (required if no global default) */
  mapStyle?: string;
  /** Padding around bounds in pixels */
  padding?: number;
  /** Map ID for the block */
  id?: string;
  /** Whether the map should be interactive */
  interactive?: boolean;
}

/**
 * Calculates the center point of an array of coordinates.
 *
 * @param coordinates - Array of [lng, lat] coordinate pairs
 * @returns Center coordinate [lng, lat]
 *
 * @example
 * ```typescript
 * const center = calculateCenter([
 *   [-74.0, 40.7],
 *   [-73.9, 40.8],
 *   [-74.1, 40.6]
 * ]);
 * // center ≈ [-74.0, 40.7]
 * ```
 */
export function calculateCenter(
  coordinates: [number, number][],
): [number, number] {
  if (coordinates.length === 0) {
    throw new Error("Cannot calculate center of empty coordinates array");
  }

  if (coordinates.length === 1) {
    return coordinates[0];
  }

  const sum = coordinates.reduce(
    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]],
    [0, 0],
  );

  return [sum[0] / coordinates.length, sum[1] / coordinates.length];
}

/**
 * Calculates the bounding box of an array of coordinates.
 *
 * @param coordinates - Array of [lng, lat] coordinate pairs
 * @returns Bounds as [[minLng, minLat], [maxLng, maxLat]]
 *
 * @example
 * ```typescript
 * const bounds = calculateBounds([
 *   [-74.0, 40.7],
 *   [-73.9, 40.8],
 *   [-74.1, 40.6]
 * ]);
 * // bounds = [[-74.1, 40.6], [-73.9, 40.8]]
 * ```
 */
export function calculateBounds(
  coordinates: [number, number][],
): [[number, number], [number, number]] {
  if (coordinates.length === 0) {
    throw new Error("Cannot calculate bounds of empty coordinates array");
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Generates a unique ID for map blocks.
 * @internal
 */
function generateMapId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Builds a MapBlock configuration for a single location point.
 *
 * @param options - Point map options
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Creates a circle layer for the point marker with optional popup
 * showing the location name and description.
 *
 * @example Basic Point Map
 * ```typescript
 * const config = buildPointMapConfig({
 *   location: {
 *     coordinates: [-74.006, 40.7128],
 *     name: 'New York City'
 *   },
 *   mapStyle: 'https://demotiles.maplibre.org/style.json'
 * });
 * ```
 *
 * @example With Custom Zoom
 * ```typescript
 * const config = buildPointMapConfig({
 *   location: { coordinates: [-74.006, 40.7128] },
 *   mapStyle: 'https://demotiles.maplibre.org/style.json',
 *   zoom: 15
 * });
 * ```
 */
export function buildPointMapConfig(options: PointMapOptions): MapBlock {
  const { location, mapStyle, zoom, id, interactive = true } = options;
  const markerColor = location.markerColor ?? DEFAULT_MARKER_COLOR;

  // Build popup content if name or description provided
  const popupContent =
    location.name || location.description
      ? [
          ...(location.name ? [{ h3: [{ str: location.name }] }] : []),
          ...(location.description
            ? [{ p: [{ str: location.description }] }]
            : []),
        ]
      : undefined;

  const mapConfig: Partial<MapConfig> = {
    center: location.coordinates,
    zoom: zoom ?? location.zoom ?? 12,
    interactive,
  };

  // Only include mapStyle if provided (allows global inheritance)
  if (mapStyle) {
    mapConfig.mapStyle = mapStyle;
  }

  return {
    type: "map",
    id: id ?? generateMapId("point-map"),
    config: mapConfig as MapConfig,
    layers: [
      {
        id: "location-marker",
        type: "circle",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: location.coordinates,
                },
                properties: {
                  name: location.name ?? "",
                  description: location.description ?? "",
                },
              },
            ],
          },
        },
        paint: {
          "circle-radius": 8,
          "circle-color": markerColor,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
        ...(popupContent
          ? {
              interactive: {
                hover: { cursor: "pointer" },
                click: { popup: popupContent },
              },
            }
          : {}),
      },
    ],
  };
}

/**
 * Builds a MapBlock configuration for multiple location points.
 *
 * @param options - Multi-point map options
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Creates a circle layer with all points and automatically fits
 * the map bounds to show all locations.
 *
 * @example Multiple Locations
 * ```typescript
 * const config = buildMultiPointMapConfig({
 *   locations: [
 *     { coordinates: [-74.006, 40.7128], name: 'NYC' },
 *     { coordinates: [-118.2437, 34.0522], name: 'LA' },
 *     { coordinates: [-87.6298, 41.8781], name: 'Chicago' }
 *   ],
 *   mapStyle: 'https://demotiles.maplibre.org/style.json',
 *   padding: 50
 * });
 * ```
 */
export function buildMultiPointMapConfig(
  options: MultiPointMapOptions,
): MapBlock {
  const { locations, mapStyle, padding = 50, id, interactive = true } = options;

  if (locations.length === 0) {
    throw new Error("Cannot build multi-point map with empty locations array");
  }

  const coordinates = locations.map((loc) => loc.coordinates);
  const bounds = calculateBounds(coordinates);
  const center = calculateCenter(coordinates);

  const features = locations.map((location) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: location.coordinates,
    },
    properties: {
      name: location.name ?? "",
      description: location.description ?? "",
      markerColor: location.markerColor ?? DEFAULT_MARKER_COLOR,
    },
  }));

  const mapConfig: Partial<MapConfig> = {
    center,
    zoom: 10, // Will be overridden by bounds
    bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    interactive,
  };

  if (mapStyle) {
    mapConfig.mapStyle = mapStyle;
  }

  return {
    type: "map",
    id: id ?? generateMapId("multi-point-map"),
    config: mapConfig as MapConfig,
    layers: [
      {
        id: "location-markers",
        type: "circle",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features,
          },
        },
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "markerColor"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
        interactive: {
          hover: { cursor: "pointer" },
          click: {
            popup: [
              { h3: [{ property: "name", else: "Location" }] },
              { p: [{ property: "description" }] },
            ],
          },
        },
      },
    ],
  };
}

/**
 * Builds a MapBlock configuration for a polygon region.
 *
 * @param options - Polygon map options
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Creates a fill layer for the polygon with configurable styling.
 * The map centers on the polygon with appropriate zoom.
 *
 * @example Region Map
 * ```typescript
 * const config = buildPolygonMapConfig({
 *   region: {
 *     coordinates: [[
 *       [-74.0, 40.7], [-73.9, 40.7],
 *       [-73.9, 40.8], [-74.0, 40.8],
 *       [-74.0, 40.7]
 *     ]],
 *     name: 'Manhattan',
 *     fillColor: '#ff6b6b',
 *     fillOpacity: 0.4
 *   },
 *   mapStyle: 'https://demotiles.maplibre.org/style.json'
 * });
 * ```
 */
export function buildPolygonMapConfig(options: PolygonMapOptions): MapBlock {
  const { region, mapStyle, zoom, id, interactive = true } = options;

  // Flatten coordinates to calculate center/bounds
  const allCoords = region.coordinates.flatMap((ring) => ring);
  const center = calculateCenter(allCoords);
  const bounds = calculateBounds(allCoords);

  const fillColor = region.fillColor ?? DEFAULT_FILL_COLOR;
  const strokeColor = region.strokeColor ?? fillColor;
  const fillOpacity = region.fillOpacity ?? DEFAULT_FILL_OPACITY;

  const popupContent =
    region.name || region.description
      ? [
          ...(region.name ? [{ h3: [{ str: region.name }] }] : []),
          ...(region.description ? [{ p: [{ str: region.description }] }] : []),
        ]
      : undefined;

  const mapConfig: Partial<MapConfig> = {
    center,
    zoom: zoom ?? 12,
    bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    interactive,
  };

  if (mapStyle) {
    mapConfig.mapStyle = mapStyle;
  }

  return {
    type: "map",
    id: id ?? generateMapId("polygon-map"),
    config: mapConfig as MapConfig,
    layers: [
      {
        id: "region-fill",
        type: "fill",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: region.coordinates,
                },
                properties: {
                  name: region.name ?? "",
                  description: region.description ?? "",
                },
              },
            ],
          },
        },
        paint: {
          "fill-color": fillColor,
          "fill-opacity": fillOpacity,
        },
        ...(popupContent
          ? {
              interactive: {
                hover: { cursor: "pointer" },
                click: { popup: popupContent },
              },
            }
          : {}),
      },
      {
        id: "region-outline",
        type: "line",
        source: "region-fill",
        paint: {
          "line-color": strokeColor,
          "line-width": 2,
        },
      },
    ],
  };
}

/**
 * Builds a MapBlock configuration for a route/line.
 *
 * @param options - Route map options
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Creates a line layer for the route with configurable styling.
 * Automatically fits bounds to show the entire route.
 *
 * @example Route Map
 * ```typescript
 * const config = buildRouteMapConfig({
 *   route: {
 *     coordinates: [
 *       [-74.006, 40.7128],
 *       [-73.935, 40.730],
 *       [-73.867, 40.752]
 *     ],
 *     name: 'Brooklyn to Queens',
 *     color: '#e74c3c',
 *     width: 4
 *   },
 *   mapStyle: 'https://demotiles.maplibre.org/style.json'
 * });
 * ```
 */
export function buildRouteMapConfig(options: RouteMapOptions): MapBlock {
  const { route, mapStyle, padding = 50, id, interactive = true } = options;

  const center = calculateCenter(route.coordinates);
  const bounds = calculateBounds(route.coordinates);

  const lineColor = route.color ?? DEFAULT_LINE_COLOR;
  const lineWidth = route.width ?? DEFAULT_LINE_WIDTH;

  const popupContent =
    route.name || route.description
      ? [
          ...(route.name ? [{ h3: [{ str: route.name }] }] : []),
          ...(route.description ? [{ p: [{ str: route.description }] }] : []),
        ]
      : undefined;

  const mapConfig: Partial<MapConfig> = {
    center,
    zoom: 10,
    bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    interactive,
  };

  if (mapStyle) {
    mapConfig.mapStyle = mapStyle;
  }

  return {
    type: "map",
    id: id ?? generateMapId("route-map"),
    config: mapConfig as MapConfig,
    layers: [
      {
        id: "route-line",
        type: "line",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: route.coordinates,
                },
                properties: {
                  name: route.name ?? "",
                  description: route.description ?? "",
                },
              },
            ],
          },
        },
        paint: {
          "line-color": lineColor,
          "line-width": lineWidth,
          "line-cap": "round",
          "line-join": "round",
        },
        ...(popupContent
          ? {
              interactive: {
                hover: { cursor: "pointer" },
                click: { popup: popupContent },
              },
            }
          : {}),
      },
      // Add start/end markers
      {
        id: "route-endpoints",
        type: "circle",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: route.coordinates[0],
                },
                properties: { type: "start" },
              },
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: route.coordinates[route.coordinates.length - 1],
                },
                properties: { type: "end" },
              },
            ],
          },
        },
        paint: {
          "circle-radius": 6,
          "circle-color": lineColor,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      },
    ],
  };
}
