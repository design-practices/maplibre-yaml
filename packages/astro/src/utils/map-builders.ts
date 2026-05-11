/**
 * @file Map configuration builders for collection item integration
 * @module @maplibre-yaml/astro/utils/map-builders
 *
 * @description
 * Utility functions for creating MapBlock configurations from simple
 * geographic data. These functions convert location points, polygons,
 * and routes into properly structured map configurations.
 *
 * ## Usage
 *
 * Use these builders to create map configurations from collection item frontmatter
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

import type { MapBlock, MapConfig, GlobalConfig } from "@maplibre-yaml/core";
import { resolveMapConfig } from "@maplibre-yaml/core";
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
 * Polygon-style metadata for a MultiPolygon. Coordinates follow the GeoJSON
 * MultiPolygon shape: an array of polygons, each polygon being an array of
 * linear rings (first ring is exterior, subsequent rings are holes).
 *
 * Style fields (`fillColor`, `strokeColor`, `fillOpacity`) come from the
 * single `RegionPolygon` schema so adding a new polygon style field there
 * lights up here automatically.
 */
export interface MultiRegionPolygon
  extends Omit<RegionPolygon, "coordinates"> {
  /** GeoJSON MultiPolygon coordinates */
  coordinates: [number, number][][][];
}

/**
 * Options for building MultiPolygon map configurations.
 */
export interface MultiPolygonMapOptions {
  /** MultiPolygon region data */
  region: MultiRegionPolygon;
  mapStyle?: string;
  zoom?: number;
  id?: string;
  interactive?: boolean;
}

/**
 * Line metadata for a MultiLineString. Coordinates follow the GeoJSON
 * MultiLineString shape: an array of LineStrings, each being an array of
 * coordinates.
 *
 * Style fields (`color`, `width`) come from the single `RouteLine` schema.
 */
export interface MultiRouteLine extends Omit<RouteLine, "coordinates"> {
  /** GeoJSON MultiLineString coordinates */
  coordinates: [number, number][][];
}

/**
 * Options for building MultiLineString map configurations.
 */
export interface MultiLineStringMapOptions {
  /** MultiLineString route data */
  route: MultiRouteLine;
  mapStyle?: string;
  id?: string;
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
 * Build popup `richtext` content from optional name/description fields.
 * Returns `undefined` when both are empty so callers can drop the
 * `interactive` block entirely.
 *
 * @internal
 */
function buildPopupContent(
  name?: string,
  description?: string,
): Array<Record<string, unknown>> | undefined {
  if (!name && !description) return undefined;
  return [
    ...(name ? [{ h3: [{ str: name }] }] : []),
    ...(description ? [{ p: [{ str: description }] }] : []),
  ];
}

/**
 * Build the fill + outline layer pair shared by `buildPolygonMapConfig`
 * (Polygon geometry) and `buildMultiPolygonMapConfig` (MultiPolygon
 * geometry).
 *
 * Caller supplies the geometry type and matching coordinate shape; the
 * helper handles defaults, popup wiring, and the two-layer structure.
 *
 * @internal
 */
function buildPolygonLayers(
  geometry:
    | { type: "Polygon"; coordinates: [number, number][][] }
    | { type: "MultiPolygon"; coordinates: [number, number][][][] },
  region: {
    name?: string;
    description?: string;
    fillColor?: string;
    strokeColor?: string;
    fillOpacity?: number;
  },
): MapBlock["layers"] {
  const fillColor = region.fillColor ?? DEFAULT_FILL_COLOR;
  const strokeColor = region.strokeColor ?? fillColor;
  const fillOpacity = region.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const popupContent = buildPopupContent(region.name, region.description);

  return [
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
              geometry,
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
  ];
}

/**
 * Build the line + endpoints layer pair shared by `buildRouteMapConfig`
 * (LineString geometry) and `buildMultiLineStringMapConfig` (MultiLineString
 * geometry).
 *
 * Endpoint features differ between the two geometries: a single LineString
 * has one (start, end) pair, while a MultiLineString has (start, end) for
 * each segment. The caller passes those pre-computed.
 *
 * @internal
 */
function buildRouteLayers(
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "MultiLineString"; coordinates: [number, number][][] },
  route: { name?: string; description?: string; color?: string; width?: number },
  endpointFeatures: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { type: string };
  }>,
): MapBlock["layers"] {
  const lineColor = route.color ?? DEFAULT_LINE_COLOR;
  const lineWidth = route.width ?? DEFAULT_LINE_WIDTH;
  const popupContent = buildPopupContent(route.name, route.description);

  return [
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
              geometry,
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
    {
      id: "route-endpoints",
      type: "circle",
      source: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: endpointFeatures,
        },
      },
      paint: {
        "circle-radius": 6,
        "circle-color": lineColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
  ];
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
export function buildPointMapConfig(
  options: PointMapOptions,
  globalConfig?: GlobalConfig,
): MapBlock {
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

  const config = resolveMapConfig(
    {
      center: location.coordinates,
      zoom: zoom ?? location.zoom ?? 12,
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  return {
    type: "map",
    id: id ?? generateMapId("point-map"),
    config,
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
  globalConfig?: GlobalConfig,
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

  const config = resolveMapConfig(
    {
      center,
      zoom: 10, // Will be overridden by bounds
      bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  return {
    type: "map",
    id: id ?? generateMapId("multi-point-map"),
    config,
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
export function buildPolygonMapConfig(
  options: PolygonMapOptions,
  globalConfig?: GlobalConfig,
): MapBlock {
  const { region, mapStyle, zoom, id, interactive = true } = options;

  const allCoords = region.coordinates.flatMap((ring) => ring);
  const center = calculateCenter(allCoords);
  const bounds = calculateBounds(allCoords);

  const config = resolveMapConfig(
    {
      center,
      zoom: zoom ?? 12,
      bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  return {
    type: "map",
    id: id ?? generateMapId("polygon-map"),
    config,
    layers: buildPolygonLayers(
      { type: "Polygon", coordinates: region.coordinates },
      region,
    ),
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
export function buildRouteMapConfig(
  options: RouteMapOptions,
  globalConfig?: GlobalConfig,
): MapBlock {
  const { route, mapStyle, id, interactive = true } = options;

  const center = calculateCenter(route.coordinates);
  const bounds = calculateBounds(route.coordinates);

  const config = resolveMapConfig(
    {
      center,
      zoom: 10,
      bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  const endpointFeatures = [
    {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: route.coordinates[0],
      },
      properties: { type: "start" },
    },
    {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: route.coordinates[route.coordinates.length - 1],
      },
      properties: { type: "end" },
    },
  ];

  return {
    type: "map",
    id: id ?? generateMapId("route-map"),
    config,
    layers: buildRouteLayers(
      { type: "LineString", coordinates: route.coordinates },
      route,
      endpointFeatures,
    ),
  };
}

/**
 * Builds a MapBlock configuration for a MultiPolygon region.
 *
 * @param options - MultiPolygon map options
 * @param globalConfig - Optional global map config
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Renders ALL polygons in the MultiPolygon as a single feature with
 * `geometry.type === "MultiPolygon"`. This is preferred over splitting
 * into multiple features because MapLibre handles MultiPolygon natively
 * and a single feature keeps interaction (popups, hover) cohesive.
 *
 * Bounds are computed across all rings in all polygons, so the map fits
 * the entire multi-region by default.
 *
 * @example
 * ```typescript
 * const config = buildMultiPolygonMapConfig({
 *   region: {
 *     coordinates: [
 *       [[[-73.99, 40.68], [-73.98, 40.68], [-73.98, 40.67], [-73.99, 40.68]]],
 *       [[[-73.97, 40.66], [-73.96, 40.66], [-73.96, 40.65], [-73.97, 40.66]]],
 *     ],
 *     name: "Two zones",
 *     fillColor: "#3388ff",
 *   },
 * });
 * ```
 */
export function buildMultiPolygonMapConfig(
  options: MultiPolygonMapOptions,
  globalConfig?: GlobalConfig,
): MapBlock {
  const { region, mapStyle, zoom, id, interactive = true } = options;

  const allCoords = region.coordinates.flatMap((polygon) =>
    polygon.flatMap((ring) => ring),
  );
  if (allCoords.length === 0) {
    throw new Error("buildMultiPolygonMapConfig: region.coordinates is empty");
  }
  const center = calculateCenter(allCoords);
  const bounds = calculateBounds(allCoords);

  const config = resolveMapConfig(
    {
      center,
      zoom: zoom ?? 12,
      bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  return {
    type: "map",
    id: id ?? generateMapId("multi-polygon-map"),
    config,
    layers: buildPolygonLayers(
      { type: "MultiPolygon", coordinates: region.coordinates },
      region,
    ),
  };
}

/**
 * Builds a MapBlock configuration for a MultiLineString route.
 *
 * @param options - MultiLineString map options
 * @param globalConfig - Optional global map config
 * @returns Complete MapBlock configuration
 *
 * @remarks
 * Renders ALL line segments in the MultiLineString as a single feature
 * with `geometry.type === "MultiLineString"`. The endpoints layer marks
 * the start/end of each segment.
 *
 * Bounds are computed across all segments.
 *
 * @example
 * ```typescript
 * const config = buildMultiLineStringMapConfig({
 *   route: {
 *     coordinates: [
 *       [[-73.99, 40.68], [-73.98, 40.68]],
 *       [[-73.97, 40.66], [-73.96, 40.66]],
 *     ],
 *     name: "Two paths",
 *     color: "#3498db",
 *   },
 * });
 * ```
 */
export function buildMultiLineStringMapConfig(
  options: MultiLineStringMapOptions,
  globalConfig?: GlobalConfig,
): MapBlock {
  const { route, mapStyle, id, interactive = true } = options;

  const allCoords = route.coordinates.flatMap((line) => line);
  if (allCoords.length === 0) {
    throw new Error("buildMultiLineStringMapConfig: route.coordinates is empty");
  }
  const center = calculateCenter(allCoords);
  const bounds = calculateBounds(allCoords);

  const config = resolveMapConfig(
    {
      center,
      zoom: 10,
      bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  // (start, end) pair per segment, skipping empty segments.
  const endpointFeatures = route.coordinates.flatMap((segment) => {
    if (segment.length === 0) return [];
    return [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: segment[0] },
        properties: { type: "start" },
      },
      {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: segment[segment.length - 1],
        },
        properties: { type: "end" },
      },
    ];
  });

  return {
    type: "map",
    id: id ?? generateMapId("multi-route-map"),
    config,
    layers: buildRouteLayers(
      { type: "MultiLineString", coordinates: route.coordinates },
      route,
      endpointFeatures,
    ),
  };
}
