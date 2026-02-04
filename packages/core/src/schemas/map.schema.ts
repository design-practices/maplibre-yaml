/**
 * @file Map block schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/map
 *
 * @description
 * Zod schemas for map configuration, controls, legends, and map blocks.
 *
 * @example
 * ```typescript
 * import { MapConfigSchema, MapBlockSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import {
  LngLatSchema,
  LngLatBoundsSchema,
  ZoomLevelSchema,
} from "./base.schema";
import { LayerOrReferenceSchema } from "./layer.schema";

/**
 * Control position on the map.
 *
 * @remarks
 * Controls can be positioned in any of the four corners.
 */
export const ControlPositionSchema = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

/** Inferred type for control position. */
export type ControlPosition = z.infer<typeof ControlPositionSchema>;

/**
 * Individual control configuration.
 *
 * @remarks
 * Can be a boolean (uses default position) or an object with position.
 */
const ControlConfigSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean().describe("Whether control is enabled"),
    position: ControlPositionSchema.optional().describe("Control position"),
  }),
]);

/**
 * Map controls configuration.
 *
 * @remarks
 * Configure which controls are displayed and their positions.
 *
 * **Available Controls:**
 * - `navigation` - Zoom and rotation controls (default: top-right)
 * - `geolocate` - User geolocation (default: top-right)
 * - `scale` - Distance scale (default: bottom-left)
 * - `fullscreen` - Fullscreen toggle (default: top-right)
 * - `attribution` - Attribution text (default: bottom-right)
 *
 * @example Enable All Controls
 * ```yaml
 * controls:
 *   navigation: true
 *   geolocate: true
 *   scale: true
 *   fullscreen: true
 * ```
 *
 * @example Custom Positions
 * ```yaml
 * controls:
 *   navigation:
 *     enabled: true
 *     position: top-left
 *   scale:
 *     enabled: true
 *     position: bottom-right
 * ```
 */
export const ControlsConfigSchema = z
  .object({
    navigation: ControlConfigSchema.optional().describe(
      "Navigation controls (zoom, rotation)"
    ),
    geolocate: ControlConfigSchema.optional().describe("Geolocation control"),
    scale: ControlConfigSchema.optional().describe("Scale control"),
    fullscreen: ControlConfigSchema.optional().describe("Fullscreen control"),
    attribution: ControlConfigSchema.optional().describe("Attribution control"),
  })
  .describe("Map controls configuration");

/** Inferred type for controls config. */
export type ControlsConfig = z.infer<typeof ControlsConfigSchema>;

/**
 * Legend configuration.
 *
 * @remarks
 * The legend displays layer information and can be positioned anywhere.
 * If `items` is not provided, legend items are automatically extracted
 * from layers with `legend` configuration.
 *
 * @example Automatic Legend
 * ```yaml
 * legend:
 *   title: "Map Legend"
 *   position: top-left
 * ```
 *
 * @example Custom Legend Items
 * ```yaml
 * legend:
 *   title: "Features"
 *   position: top-left
 *   collapsed: false
 *   items:
 *     - color: "#ff0000"
 *       label: "High Priority"
 *       shape: circle
 *     - color: "#00ff00"
 *       label: "Low Priority"
 *       shape: circle
 * ```
 */
export const LegendConfigSchema = z
  .object({
    position:
      ControlPositionSchema.default("top-left").describe("Legend position"),
    title: z.string().optional().describe("Legend title"),
    collapsed: z.boolean().default(false).describe("Start collapsed"),
    items: z
      .array(
        z.object({
          color: z.string().describe("Item color"),
          label: z.string().describe("Item label"),
          shape: z
            .enum(["circle", "square", "line", "icon"])
            .default("square")
            .describe("Symbol shape"),
          icon: z
            .string()
            .optional()
            .describe("Icon name/URL (for shape: icon)"),
        })
      )
      .optional()
      .describe("Custom legend items (overrides layer legends)"),
  })
  .describe("Legend configuration");

/** Inferred type for legend config. */
export type LegendConfig = z.infer<typeof LegendConfigSchema>;

/**
 * Map configuration with MapLibre options.
 *
 * @remarks
 * Core map configuration including initial view, style, and interaction settings.
 * Uses `.passthrough()` to allow any MapLibre GL JS options.
 *
 * **Required:**
 * - `center` - Initial map center [lng, lat]
 * - `zoom` - Initial zoom level (0-24)
 *
 * **Optional (with global fallback):**
 * - `mapStyle` - MapLibre style URL or object. When omitted, inherits from
 *   global `config.defaultMapStyle`. Required if no global default is set.
 *
 * **View Options:**
 * - `pitch` - Camera tilt angle (0-85)
 * - `bearing` - Camera rotation (0-360)
 * - `bounds` - Fit to bounds
 * - `minZoom`, `maxZoom` - Zoom constraints
 * - `minPitch`, `maxPitch` - Pitch constraints
 * - `maxBounds` - Geographic bounds constraint
 *
 * **Interaction:**
 * - `interactive` - Enable/disable all interactions
 * - `scrollZoom`, `boxZoom`, `dragRotate`, `dragPan` - Individual controls
 * - `keyboard`, `doubleClickZoom`, `touchZoomRotate`, `touchPitch`
 *
 * @example Basic Map (explicit style)
 * ```yaml
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @example Map with Global Style Inheritance
 * ```yaml
 * # Root config sets default style
 * config:
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 *
 * pages:
 *   - blocks:
 *       - type: map
 *         id: simple-map
 *         config:
 *           center: [-74.006, 40.7128]
 *           zoom: 12
 *           # mapStyle inherited from config.defaultMapStyle
 * ```
 *
 * @example 3D View
 * ```yaml
 * config:
 *   center: [-122.4194, 37.7749]
 *   zoom: 15
 *   pitch: 60
 *   bearing: 30
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @example Constrained Map
 * ```yaml
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   minZoom: 8
 *   maxZoom: 18
 *   maxBounds: [-74.3, 40.5, -73.7, 40.9]
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @example Non-Interactive Map
 * ```yaml
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   interactive: false
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/ | MapLibre Map Options}
 */
export const MapConfigSchema = z
  .object({
    // Required
    center: LngLatSchema.describe("Initial map center [longitude, latitude]"),
    zoom: ZoomLevelSchema.describe("Initial zoom level (0-24)"),
    mapStyle: z
      .union([z.string().url(), z.any()])
      .optional()
      .describe(
        "MapLibre style URL or style object. " +
          "Optional when global config.defaultMapStyle is set."
      ),

    // View
    pitch: z
      .number()
      .min(0)
      .max(85)
      .default(0)
      .describe("Camera pitch angle in degrees (0-85)"),
    bearing: z
      .number()
      .min(-180)
      .max(180)
      .default(0)
      .describe("Camera bearing (rotation) in degrees (-180 to 180)"),
    bounds: z
      .union([LngLatBoundsSchema, z.array(z.number())])
      .optional()
      .describe("Fit map to bounds"),

    // Constraints
    minZoom: ZoomLevelSchema.optional().describe("Minimum zoom level"),
    maxZoom: ZoomLevelSchema.optional().describe("Maximum zoom level"),
    minPitch: z.number().min(0).max(85).optional().describe("Minimum pitch"),
    maxPitch: z.number().min(0).max(85).optional().describe("Maximum pitch"),
    maxBounds: LngLatBoundsSchema.optional().describe(
      "Maximum geographic bounds"
    ),

    // Interaction
    interactive: z.boolean().default(true).describe("Enable map interaction"),
    scrollZoom: z.boolean().optional().describe("Enable scroll to zoom"),
    boxZoom: z.boolean().optional().describe("Enable box zoom (shift+drag)"),
    dragRotate: z.boolean().optional().describe("Enable drag to rotate"),
    dragPan: z.boolean().optional().describe("Enable drag to pan"),
    keyboard: z.boolean().optional().describe("Enable keyboard shortcuts"),
    doubleClickZoom: z
      .boolean()
      .optional()
      .describe("Enable double-click zoom"),
    touchZoomRotate: z
      .boolean()
      .optional()
      .describe("Enable touch zoom/rotate"),
    touchPitch: z.boolean().optional().describe("Enable touch pitch"),

    // Display
    hash: z.boolean().optional().describe("Sync map state with URL hash"),
    attributionControl: z
      .boolean()
      .optional()
      .describe("Show attribution control"),
    logoPosition: ControlPositionSchema.optional().describe(
      "MapLibre logo position"
    ),
    fadeDuration: z
      .number()
      .optional()
      .describe("Fade duration in milliseconds"),
    crossSourceCollisions: z
      .boolean()
      .optional()
      .describe("Check for cross-source collisions"),

    // Rendering
    antialias: z.boolean().optional().describe("Enable antialiasing"),
    refreshExpiredTiles: z
      .boolean()
      .optional()
      .describe("Refresh expired tiles"),
    renderWorldCopies: z
      .boolean()
      .optional()
      .describe("Render multiple world copies"),
    locale: z.record(z.string()).optional().describe("Localization strings"),

    // Performance
    maxTileCacheSize: z.number().optional().describe("Maximum tiles to cache"),
    localIdeographFontFamily: z
      .string()
      .optional()
      .describe("Font for CJK characters"),
    trackResize: z.boolean().optional().describe("Track container resize"),
    preserveDrawingBuffer: z
      .boolean()
      .optional()
      .describe("Preserve drawing buffer"),
    failIfMajorPerformanceCaveat: z
      .boolean()
      .optional()
      .describe("Fail if major performance caveat"),
  })
  .passthrough()
  .describe("Map configuration with MapLibre options");

/** Inferred type for map config. */
export type MapConfig = z.infer<typeof MapConfigSchema>;

/**
 * Standard map block.
 *
 * @remarks
 * Creates a map within a page layout. Can be sized using CSS via
 * `className` and `style` properties.
 *
 * @example Basic Map Block
 * ```yaml
 * - type: map
 *   id: main-map
 *   config:
 *     center: [-74.006, 40.7128]
 *     zoom: 12
 *     mapStyle: "https://demotiles.maplibre.org/style.json"
 *   layers:
 *     - id: points
 *       type: circle
 *       source:
 *         type: geojson
 *         url: "https://example.com/points.geojson"
 *       paint:
 *         circle-radius: 8
 *         circle-color: "#ff0000"
 * ```
 *
 * @example Map with Controls and Legend
 * ```yaml
 * - type: map
 *   id: interactive-map
 *   config:
 *     center: [-74.006, 40.7128]
 *     zoom: 12
 *     mapStyle: "https://demotiles.maplibre.org/style.json"
 *   layers:
 *     - $ref: "#/layers/bikeLayer"
 *     - $ref: "#/layers/parkLayer"
 *   controls:
 *     navigation: true
 *     scale: true
 *   legend:
 *     title: "Map Features"
 *     position: top-left
 * ```
 *
 * @example Sized Map
 * ```yaml
 * - type: map
 *   id: small-map
 *   className: "map-container"
 *   style: "height: 400px; width: 100%;"
 *   config:
 *     center: [0, 0]
 *     zoom: 2
 *     mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 */
export const MapBlockSchema: z.ZodObject<any> = z
  .object({
    type: z.literal("map").describe("Block type"),
    id: z.string().describe("Unique block identifier"),
    className: z.string().optional().describe("CSS class name for container"),
    style: z.string().optional().describe("Inline CSS styles for container"),
    config: MapConfigSchema.describe("Map configuration"),
    layers: z.array(LayerOrReferenceSchema).default([]).describe("Map layers"),
    controls: ControlsConfigSchema.optional().describe("Map controls"),
    legend: LegendConfigSchema.optional().describe("Legend configuration"),
  })
  .describe("Standard map block");

/** Inferred type for map block. */
export type MapBlock = z.infer<typeof MapBlockSchema>;

/**
 * Full-page map block.
 *
 * @remarks
 * Creates a map that fills the entire viewport. Automatically handles
 * viewport sizing and positioning. Ideal for map-focused pages.
 *
 * @example Full-Page Map
 * ```yaml
 * - type: map-fullpage
 *   id: fullpage-map
 *   config:
 *     center: [-122.4194, 37.7749]
 *     zoom: 13
 *     pitch: 45
 *     mapStyle: "https://demotiles.maplibre.org/style.json"
 *   layers:
 *     - id: buildings
 *       type: fill-extrusion
 *       source:
 *         type: vector
 *         url: "https://example.com/buildings.json"
 *       source-layer: buildings
 *       paint:
 *         fill-extrusion-color: "#aaa"
 *         fill-extrusion-height: ["get", "height"]
 *   controls:
 *     navigation: true
 *     fullscreen: true
 * ```
 */
export const MapFullPageBlockSchema: z.ZodObject<any> = z
  .object({
    type: z.literal("map-fullpage").describe("Block type"),
    id: z.string().describe("Unique block identifier"),
    className: z.string().optional().describe("CSS class name for container"),
    style: z.string().optional().describe("Inline CSS styles for container"),
    config: MapConfigSchema.describe("Map configuration"),
    layers: z.array(LayerOrReferenceSchema).default([]).describe("Map layers"),
    controls: ControlsConfigSchema.optional().describe("Map controls"),
    legend: LegendConfigSchema.optional().describe("Legend configuration"),
  })
  .describe("Full-page map block");

/** Inferred type for full-page map block. */
export type MapFullPageBlock = z.infer<typeof MapFullPageBlockSchema>;
