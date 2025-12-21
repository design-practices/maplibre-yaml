/**
 * @file Layer schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/layer
 *
 * @description
 * Zod schemas for all MapLibre layer types with paint/layout properties,
 * interactive events, popups, and legends.
 *
 * @example
 * ```typescript
 * import { LayerSchema, CircleLayerSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import {
  ColorOrExpressionSchema,
  NumberOrExpressionSchema,
  ExpressionSchema,
  ZoomLevelSchema,
} from "./base.schema";
import { LayerSourceSchema } from "./source.schema";

/**
 * Content item for popup or dynamic text rendering.
 *
 * @remarks
 * Supports static strings, dynamic property interpolation, and fallback values.
 *
 * **Properties:**
 * - `str` - Static text string
 * - `property` - Feature property name to interpolate
 * - `else` - Fallback value if property is missing
 * - `format` - Number format string (e.g., ",.0f" for thousands separator)
 * - `href` - Link URL (for anchor tags)
 * - `text` - Link text
 * - `src` - Image/iframe source URL
 * - `alt` - Image alt text
 *
 * @example Static Text
 * ```yaml
 * - str: "Population: "
 * ```
 *
 * @example Dynamic Property
 * ```yaml
 * - property: name
 *   else: "Unknown"
 * ```
 *
 * @example Formatted Number
 * ```yaml
 * - property: population
 *   format: ",.0f"
 * ```
 */
export const PopupContentItemSchema = z
  .object({
    str: z.string().optional().describe("Static text string"),
    property: z.string().optional().describe("Feature property name"),
    else: z.string().optional().describe("Fallback value if property missing"),
    format: z
      .string()
      .optional()
      .describe('Number format string (e.g., ",.0f")'),
    href: z.string().url().optional().describe("Link URL"),
    text: z.string().optional().describe("Link text"),
    src: z.string().url().optional().describe("Image/iframe source"),
    alt: z.string().optional().describe("Image alt text"),
  })
  .passthrough()
  .describe("Popup content item with static or dynamic values");

/** Inferred type for popup content item. */
export type PopupContentItem = z.infer<typeof PopupContentItemSchema>;

/**
 * Popup content structure.
 *
 * @remarks
 * Array of HTML elements where each element is `{ tagName: [items] }`.
 * Elements are rendered in order to build popup HTML.
 *
 * **Supported Tags:**
 * h1, h2, h3, h4, h5, h6, p, span, div, strong, em, code, pre,
 * a, img, iframe, ul, ol, li, blockquote, hr, br
 *
 * @example
 * ```yaml
 * popup:
 *   - h3:
 *       - property: name
 *         else: "Unknown"
 *   - p:
 *       - str: "Population: "
 *       - property: population
 *         format: ",.0f"
 *   - a:
 *       - href: "https://example.com"
 *         text: "Learn more"
 * ```
 *
 * **Output for `{ name: "NYC", population: 8336817 }`:**
 * ```html
 * <h3>NYC</h3>
 * <p>Population: 8,336,817</p>
 * <a href="https://example.com">Learn more</a>
 * ```
 */
export const PopupContentSchema = z
  .array(z.record(z.array(PopupContentItemSchema)))
  .describe("Popup content structure as array of HTML elements");

/** Inferred type for popup content. */
export type PopupContent = z.infer<typeof PopupContentSchema>;

/**
 * Interactive event configuration for layers.
 *
 * @remarks
 * Defines hover and click behaviors for map features.
 *
 * **Events:**
 * - `hover` - Cursor and highlight on mouseover
 * - `click` - Popup, actions, or navigation on click
 * - `mouseenter` - Custom action on mouse enter
 * - `mouseleave` - Custom action on mouse leave
 *
 * @example Hover Cursor
 * ```yaml
 * interactive:
 *   hover:
 *     cursor: pointer
 * ```
 *
 * @example Click Popup
 * ```yaml
 * interactive:
 *   click:
 *     popup:
 *       - h3:
 *           - property: name
 *       - p:
 *           - property: description
 * ```
 *
 * @example Click with FlyTo
 * ```yaml
 * interactive:
 *   click:
 *     flyTo:
 *       zoom: 15
 *       duration: 1000
 * ```
 */
export const InteractiveConfigSchema = z
  .object({
    hover: z
      .object({
        cursor: z
          .string()
          .optional()
          .describe('CSS cursor style (e.g., "pointer")'),
        highlight: z
          .boolean()
          .optional()
          .describe("Highlight feature on hover"),
      })
      .optional()
      .describe("Hover behavior"),
    click: z
      .object({
        popup: PopupContentSchema.optional().describe(
          "Popup content to display"
        ),
        action: z.string().optional().describe("Custom action name to trigger"),
        flyTo: z
          .object({
            center: z.tuple([z.number(), z.number()]).optional(),
            zoom: ZoomLevelSchema.optional(),
            duration: z.number().optional(),
          })
          .optional()
          .describe("Fly to location on click"),
      })
      .optional()
      .describe("Click behavior"),
    mouseenter: z
      .object({
        action: z.string().optional().describe("Custom action on mouse enter"),
      })
      .optional(),
    mouseleave: z
      .object({
        action: z.string().optional().describe("Custom action on mouse leave"),
      })
      .optional(),
  })
  .optional()
  .describe("Interactive event configuration");

/** Inferred type for interactive config. */
export type InteractiveConfig = z.infer<typeof InteractiveConfigSchema>;

/**
 * Legend item for a layer.
 *
 * @remarks
 * Defines how the layer appears in the map legend.
 *
 * **Shape Options:**
 * - `circle` - Circular symbol
 * - `square` - Square symbol
 * - `line` - Line symbol
 * - `icon` - Custom icon
 *
 * @example
 * ```yaml
 * legend:
 *   color: "#ff0000"
 *   label: "Earthquakes"
 *   shape: circle
 * ```
 */
export const LegendItemSchema = z
  .object({
    color: z.string().describe("CSS color value"),
    label: z.string().describe("Legend label text"),
    shape: z
      .enum(["circle", "square", "line", "icon"])
      .default("square")
      .describe("Symbol shape"),
    icon: z.string().optional().describe("Icon name or URL (for shape: icon)"),
  })
  .describe("Legend item configuration");

/** Inferred type for legend item. */
export type LegendItem = z.infer<typeof LegendItemSchema>;

/**
 * Base properties shared by all layer types.
 *
 * @remarks
 * Common configuration that applies to every layer regardless of type.
 */
const BaseLayerPropertiesSchema = z.object({
  id: z.string().describe("Unique layer identifier"),
  label: z.string().optional().describe("Human-readable layer label"),
  source: z
    .union([LayerSourceSchema, z.string()])
    .describe("Layer source (inline definition or source ID reference)"),
  "source-layer": z
    .string()
    .optional()
    .describe("Source layer name (for vector sources)"),
  minzoom: ZoomLevelSchema.optional().describe(
    "Minimum zoom level to show layer"
  ),
  maxzoom: ZoomLevelSchema.optional().describe(
    "Maximum zoom level to show layer"
  ),
  filter: ExpressionSchema.optional().describe("MapLibre filter expression"),
  visible: z.boolean().default(true).describe("Initial visibility state"),
  toggleable: z
    .boolean()
    .default(true)
    .describe("Allow users to toggle visibility"),
  before: z
    .string()
    .optional()
    .describe("Layer ID to insert this layer before"),
  interactive: InteractiveConfigSchema.describe(
    "Interactive event configuration"
  ),
  legend: LegendItemSchema.optional().describe("Legend configuration"),
  metadata: z.record(z.any()).optional().describe("Custom metadata"),
});

/**
 * Circle layer for point data.
 *
 * @remarks
 * Renders points as circles. Supports data-driven styling via
 * MapLibre expressions for all paint properties.
 *
 * **Common Paint Properties:**
 * - `circle-radius` - Size in pixels
 * - `circle-color` - Fill color
 * - `circle-opacity` - Fill opacity (0-1)
 * - `circle-stroke-width` - Border width
 * - `circle-stroke-color` - Border color
 *
 * @example Basic Circle
 * ```yaml
 * - id: points
 *   type: circle
 *   source:
 *     type: geojson
 *     url: "https://example.com/points.geojson"
 *   paint:
 *     circle-radius: 8
 *     circle-color: "#ff0000"
 * ```
 *
 * @example Data-Driven Radius
 * ```yaml
 * paint:
 *   circle-radius:
 *     - interpolate
 *     - ["linear"]
 *     - ["get", "magnitude"]
 *     - 0
 *     - 4
 *     - 10
 *     - 20
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#circle | MapLibre Circle Layer}
 */
export const CircleLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("circle").describe("Layer type"),
  paint: z
    .object({
      "circle-radius": NumberOrExpressionSchema.optional(),
      "circle-color": ColorOrExpressionSchema.optional(),
      "circle-blur": NumberOrExpressionSchema.optional(),
      "circle-opacity": NumberOrExpressionSchema.optional(),
      "circle-stroke-width": NumberOrExpressionSchema.optional(),
      "circle-stroke-color": ColorOrExpressionSchema.optional(),
      "circle-stroke-opacity": NumberOrExpressionSchema.optional(),
      "circle-pitch-scale": z.enum(["map", "viewport"]).optional(),
      "circle-pitch-alignment": z.enum(["map", "viewport"]).optional(),
      "circle-translate": z.tuple([z.number(), z.number()]).optional(),
      "circle-translate-anchor": z.enum(["map", "viewport"]).optional(),
    })
    .passthrough()
    .optional()
    .describe("Circle paint properties"),
  layout: z
    .object({})
    .passthrough()
    .optional()
    .describe("Circle layout properties"),
}).passthrough();

/** Inferred type for circle layer. */
export type CircleLayer = z.infer<typeof CircleLayerSchema>;

/**
 * Line layer for linear features.
 *
 * @remarks
 * Renders lines from LineString or Polygon geometries.
 * Supports dash patterns, gradients, and data-driven styling.
 *
 * @example Basic Line
 * ```yaml
 * - id: roads
 *   type: line
 *   source:
 *     type: geojson
 *     url: "https://example.com/roads.geojson"
 *   paint:
 *     line-color: "#333333"
 *     line-width: 2
 * ```
 *
 * @example Dashed Line
 * ```yaml
 * paint:
 *   line-color: "#0000ff"
 *   line-width: 3
 *   line-dasharray: [2, 1]
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#line | MapLibre Line Layer}
 */
export const LineLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("line").describe("Layer type"),
  paint: z
    .object({
      "line-opacity": NumberOrExpressionSchema.optional(),
      "line-color": ColorOrExpressionSchema.optional(),
      "line-width": NumberOrExpressionSchema.optional(),
      "line-gap-width": NumberOrExpressionSchema.optional(),
      "line-offset": NumberOrExpressionSchema.optional(),
      "line-blur": NumberOrExpressionSchema.optional(),
      "line-dasharray": z.array(z.number()).optional(),
      "line-pattern": z.string().optional(),
      "line-gradient": ColorOrExpressionSchema.optional(),
      "line-translate": z.tuple([z.number(), z.number()]).optional(),
      "line-translate-anchor": z.enum(["map", "viewport"]).optional(),
    })
    .passthrough()
    .optional()
    .describe("Line paint properties"),
  layout: z
    .object({
      "line-cap": z.enum(["butt", "round", "square"]).optional(),
      "line-join": z.enum(["bevel", "round", "miter"]).optional(),
      "line-miter-limit": z.number().optional(),
      "line-round-limit": z.number().optional(),
      "line-sort-key": NumberOrExpressionSchema.optional(),
    })
    .passthrough()
    .optional()
    .describe("Line layout properties"),
}).passthrough();

/** Inferred type for line layer. */
export type LineLayer = z.infer<typeof LineLayerSchema>;

/**
 * Fill layer for polygon data.
 *
 * @remarks
 * Renders filled polygons with optional outlines.
 *
 * @example Basic Fill
 * ```yaml
 * - id: parks
 *   type: fill
 *   source:
 *     type: geojson
 *     url: "https://example.com/parks.geojson"
 *   paint:
 *     fill-color: "#228B22"
 *     fill-opacity: 0.5
 *     fill-outline-color: "#006400"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#fill | MapLibre Fill Layer}
 */
export const FillLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("fill").describe("Layer type"),
  paint: z
    .object({
      "fill-antialias": z.boolean().optional(),
      "fill-opacity": NumberOrExpressionSchema.optional(),
      "fill-color": ColorOrExpressionSchema.optional(),
      "fill-outline-color": ColorOrExpressionSchema.optional(),
      "fill-translate": z.tuple([z.number(), z.number()]).optional(),
      "fill-translate-anchor": z.enum(["map", "viewport"]).optional(),
      "fill-pattern": z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe("Fill paint properties"),
  layout: z
    .object({
      "fill-sort-key": NumberOrExpressionSchema.optional(),
    })
    .passthrough()
    .optional()
    .describe("Fill layout properties"),
}).passthrough();

/** Inferred type for fill layer. */
export type FillLayer = z.infer<typeof FillLayerSchema>;

/**
 * Symbol layer for icons and text.
 *
 * @remarks
 * Renders icons, text labels, or both. Most complex layer type with
 * extensive styling options for typography and icon placement.
 *
 * @example Icon
 * ```yaml
 * - id: markers
 *   type: symbol
 *   source:
 *     type: geojson
 *     url: "https://example.com/markers.geojson"
 *   layout:
 *     icon-image: "marker-15"
 *     icon-size: 1.5
 * ```
 *
 * @example Text Label
 * ```yaml
 * layout:
 *   text-field: ["get", "name"]
 *   text-size: 12
 *   text-anchor: top
 * paint:
 *   text-color: "#000000"
 *   text-halo-color: "#ffffff"
 *   text-halo-width: 2
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#symbol | MapLibre Symbol Layer}
 */
export const SymbolLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("symbol").describe("Layer type"),
  layout: z
    .object({
      "symbol-placement": z.enum(["point", "line", "line-center"]).optional(),
      "symbol-spacing": z.number().optional(),
      "symbol-avoid-edges": z.boolean().optional(),
      "symbol-sort-key": NumberOrExpressionSchema.optional(),
      "symbol-z-order": z.enum(["auto", "viewport-y", "source"]).optional(),
      "icon-allow-overlap": z.boolean().optional(),
      "icon-ignore-placement": z.boolean().optional(),
      "icon-optional": z.boolean().optional(),
      "icon-rotation-alignment": z.enum(["map", "viewport", "auto"]).optional(),
      "icon-size": NumberOrExpressionSchema.optional(),
      "icon-text-fit": z.enum(["none", "width", "height", "both"]).optional(),
      "icon-text-fit-padding": z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional(),
      "icon-image": z.union([z.string(), ExpressionSchema]).optional(),
      "icon-rotate": NumberOrExpressionSchema.optional(),
      "icon-padding": z.number().optional(),
      "icon-keep-upright": z.boolean().optional(),
      "icon-offset": z.tuple([z.number(), z.number()]).optional(),
      "icon-anchor": z
        .enum([
          "center",
          "left",
          "right",
          "top",
          "bottom",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ])
        .optional(),
      "icon-pitch-alignment": z.enum(["map", "viewport", "auto"]).optional(),
      "text-pitch-alignment": z.enum(["map", "viewport", "auto"]).optional(),
      "text-rotation-alignment": z.enum(["map", "viewport", "auto"]).optional(),
      "text-field": z.union([z.string(), ExpressionSchema]).optional(),
      "text-font": z.array(z.string()).optional(),
      "text-size": NumberOrExpressionSchema.optional(),
      "text-max-width": NumberOrExpressionSchema.optional(),
      "text-line-height": z.number().optional(),
      "text-letter-spacing": z.number().optional(),
      "text-justify": z.enum(["auto", "left", "center", "right"]).optional(),
      "text-radial-offset": z.number().optional(),
      "text-variable-anchor": z
        .array(
          z.enum([
            "center",
            "left",
            "right",
            "top",
            "bottom",
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ])
        )
        .optional(),
      "text-anchor": z
        .enum([
          "center",
          "left",
          "right",
          "top",
          "bottom",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ])
        .optional(),
      "text-max-angle": z.number().optional(),
      "text-rotate": NumberOrExpressionSchema.optional(),
      "text-padding": z.number().optional(),
      "text-keep-upright": z.boolean().optional(),
      "text-transform": z.enum(["none", "uppercase", "lowercase"]).optional(),
      "text-offset": z.tuple([z.number(), z.number()]).optional(),
      "text-allow-overlap": z.boolean().optional(),
      "text-ignore-placement": z.boolean().optional(),
      "text-optional": z.boolean().optional(),
    })
    .passthrough()
    .optional()
    .describe("Symbol layout properties"),
  paint: z
    .object({
      "icon-opacity": NumberOrExpressionSchema.optional(),
      "icon-color": ColorOrExpressionSchema.optional(),
      "icon-halo-color": ColorOrExpressionSchema.optional(),
      "icon-halo-width": NumberOrExpressionSchema.optional(),
      "icon-halo-blur": NumberOrExpressionSchema.optional(),
      "icon-translate": z.tuple([z.number(), z.number()]).optional(),
      "icon-translate-anchor": z.enum(["map", "viewport"]).optional(),
      "text-opacity": NumberOrExpressionSchema.optional(),
      "text-color": ColorOrExpressionSchema.optional(),
      "text-halo-color": ColorOrExpressionSchema.optional(),
      "text-halo-width": NumberOrExpressionSchema.optional(),
      "text-halo-blur": NumberOrExpressionSchema.optional(),
      "text-translate": z.tuple([z.number(), z.number()]).optional(),
      "text-translate-anchor": z.enum(["map", "viewport"]).optional(),
    })
    .passthrough()
    .optional()
    .describe("Symbol paint properties"),
}).passthrough();

/** Inferred type for symbol layer. */
export type SymbolLayer = z.infer<typeof SymbolLayerSchema>;

/**
 * Raster layer for raster tiles or images.
 *
 * @remarks
 * Renders raster imagery with opacity and blending controls.
 *
 * @example
 * ```yaml
 * - id: satellite
 *   type: raster
 *   source:
 *     type: raster
 *     tiles: ["https://tile.example.com/{z}/{x}/{y}.png"]
 *   paint:
 *     raster-opacity: 0.8
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#raster | MapLibre Raster Layer}
 */
export const RasterLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("raster").describe("Layer type"),
  paint: z
    .object({
      "raster-opacity": NumberOrExpressionSchema.optional(),
      "raster-hue-rotate": NumberOrExpressionSchema.optional(),
      "raster-brightness-min": NumberOrExpressionSchema.optional(),
      "raster-brightness-max": NumberOrExpressionSchema.optional(),
      "raster-saturation": NumberOrExpressionSchema.optional(),
      "raster-contrast": NumberOrExpressionSchema.optional(),
      "raster-resampling": z.enum(["linear", "nearest"]).optional(),
      "raster-fade-duration": z.number().optional(),
    })
    .passthrough()
    .optional()
    .describe("Raster paint properties"),
  layout: z
    .object({})
    .passthrough()
    .optional()
    .describe("Raster layout properties"),
}).passthrough();

/** Inferred type for raster layer. */
export type RasterLayer = z.infer<typeof RasterLayerSchema>;

/**
 * Fill extrusion layer for 3D buildings and structures.
 *
 * @remarks
 * Renders filled polygons extruded in 3D space.
 *
 * @example 3D Buildings
 * ```yaml
 * - id: buildings
 *   type: fill-extrusion
 *   source:
 *     type: vector
 *     url: "https://example.com/buildings.json"
 *   source-layer: buildings
 *   paint:
 *     fill-extrusion-color: "#aaaaaa"
 *     fill-extrusion-height: ["get", "height"]
 *     fill-extrusion-base: ["get", "min_height"]
 *     fill-extrusion-opacity: 0.8
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#fill-extrusion | MapLibre Fill Extrusion Layer}
 */
export const FillExtrusionLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("fill-extrusion").describe("Layer type"),
  paint: z
    .object({
      "fill-extrusion-opacity": NumberOrExpressionSchema.optional(),
      "fill-extrusion-color": ColorOrExpressionSchema.optional(),
      "fill-extrusion-translate": z.tuple([z.number(), z.number()]).optional(),
      "fill-extrusion-translate-anchor": z.enum(["map", "viewport"]).optional(),
      "fill-extrusion-pattern": z.string().optional(),
      "fill-extrusion-height": NumberOrExpressionSchema.optional(),
      "fill-extrusion-base": NumberOrExpressionSchema.optional(),
      "fill-extrusion-vertical-gradient": z.boolean().optional(),
    })
    .passthrough()
    .optional()
    .describe("Fill extrusion paint properties"),
  layout: z
    .object({})
    .passthrough()
    .optional()
    .describe("Fill extrusion layout properties"),
}).passthrough();

/** Inferred type for fill extrusion layer. */
export type FillExtrusionLayer = z.infer<typeof FillExtrusionLayerSchema>;

/**
 * Heatmap layer for point density visualization.
 *
 * @remarks
 * Renders point data as a smooth heatmap with color gradients.
 *
 * @example
 * ```yaml
 * - id: earthquakes-heat
 *   type: heatmap
 *   source:
 *     type: geojson
 *     url: "https://example.com/earthquakes.geojson"
 *   paint:
 *     heatmap-intensity: 1
 *     heatmap-radius: 20
 *     heatmap-color:
 *       - interpolate
 *       - ["linear"]
 *       - ["heatmap-density"]
 *       - 0
 *       - "rgba(0,0,255,0)"
 *       - 0.5
 *       - "yellow"
 *       - 1
 *       - "red"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#heatmap | MapLibre Heatmap Layer}
 */
export const HeatmapLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("heatmap").describe("Layer type"),
  paint: z
    .object({
      "heatmap-radius": NumberOrExpressionSchema.optional(),
      "heatmap-weight": NumberOrExpressionSchema.optional(),
      "heatmap-intensity": NumberOrExpressionSchema.optional(),
      "heatmap-color": ColorOrExpressionSchema.optional(),
      "heatmap-opacity": NumberOrExpressionSchema.optional(),
    })
    .passthrough()
    .optional()
    .describe("Heatmap paint properties"),
  layout: z
    .object({})
    .passthrough()
    .optional()
    .describe("Heatmap layout properties"),
}).passthrough();

/** Inferred type for heatmap layer. */
export type HeatmapLayer = z.infer<typeof HeatmapLayerSchema>;

/**
 * Hillshade layer for terrain visualization.
 *
 * @remarks
 * Renders raster DEM data as hillshading.
 *
 * @example
 * ```yaml
 * - id: hillshade
 *   type: hillshade
 *   source:
 *     type: raster-dem
 *     url: "https://example.com/terrain.json"
 *   paint:
 *     hillshade-illumination-direction: 315
 *     hillshade-exaggeration: 0.5
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#hillshade | MapLibre Hillshade Layer}
 */
export const HillshadeLayerSchema = BaseLayerPropertiesSchema.extend({
  type: z.literal("hillshade").describe("Layer type"),
  paint: z
    .object({
      "hillshade-illumination-direction": z.number().optional(),
      "hillshade-illumination-anchor": z.enum(["map", "viewport"]).optional(),
      "hillshade-exaggeration": NumberOrExpressionSchema.optional(),
      "hillshade-shadow-color": ColorOrExpressionSchema.optional(),
      "hillshade-highlight-color": ColorOrExpressionSchema.optional(),
      "hillshade-accent-color": ColorOrExpressionSchema.optional(),
    })
    .passthrough()
    .optional()
    .describe("Hillshade paint properties"),
  layout: z
    .object({})
    .passthrough()
    .optional()
    .describe("Hillshade layout properties"),
}).passthrough();

/** Inferred type for hillshade layer. */
export type HillshadeLayer = z.infer<typeof HillshadeLayerSchema>;

/**
 * Background layer for solid color backgrounds.
 *
 * @remarks
 * Renders a solid color or pattern as the map background.
 * Only one background layer is typically used per style.
 *
 * @example
 * ```yaml
 * - id: background
 *   type: background
 *   paint:
 *     background-color: "#f0f0f0"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/layers/#background | MapLibre Background Layer}
 */
export const BackgroundLayerSchema = z
  .object({
    id: z.string().describe("Unique layer identifier"),
    type: z.literal("background").describe("Layer type"),
    paint: z
      .object({
        "background-color": ColorOrExpressionSchema.optional(),
        "background-pattern": z.string().optional(),
        "background-opacity": NumberOrExpressionSchema.optional(),
      })
      .passthrough()
      .optional()
      .describe("Background paint properties"),
    layout: z
      .object({})
      .passthrough()
      .optional()
      .describe("Background layout properties"),
    metadata: z.record(z.any()).optional().describe("Custom metadata"),
  })
  .passthrough();

/** Inferred type for background layer. */
export type BackgroundLayer = z.infer<typeof BackgroundLayerSchema>;

/**
 * Union of all layer types.
 *
 * @remarks
 * Use the `type` field to determine which layer type is being used.
 *
 * @example
 * ```typescript
 * const layer: Layer = {
 *   id: 'my-layer',
 *   type: 'circle',
 *   source: { type: 'geojson', url: '...' },
 *   paint: { 'circle-radius': 8 }
 * };
 * ```
 */
export const LayerSchema = z.union([
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  FillExtrusionLayerSchema,
  HeatmapLayerSchema,
  HillshadeLayerSchema,
  BackgroundLayerSchema,
]);

/** Inferred type for any layer. */
export type Layer = z.infer<typeof LayerSchema>;

/**
 * Layer reference for reusing global layer definitions.
 *
 * @remarks
 * References a layer defined in the global `layers` object using
 * JSON Pointer-like syntax: `#/layers/layerName`
 *
 * @example
 * ```yaml
 * # Global definition
 * layers:
 *   bikeLayer:
 *     id: bikes
 *     type: line
 *     # ...
 *
 * # Reference in map
 * pages:
 *   - blocks:
 *       - layers:
 *           - $ref: "#/layers/bikeLayer"
 * ```
 */
export const LayerReferenceSchema = z
  .object({
    $ref: z
      .string()
      .describe('Reference to global layer (e.g., "#/layers/bikeLayer")'),
  })
  .describe("Layer reference");

/** Inferred type for layer reference. */
export type LayerReference = z.infer<typeof LayerReferenceSchema>;

/**
 * Union of layer or layer reference.
 *
 * @remarks
 * Layers can be defined inline or referenced from global definitions.
 */
export const LayerOrReferenceSchema = z.union([
  LayerSchema,
  LayerReferenceSchema,
]);

/** Inferred type for layer or reference. */
export type LayerOrReference = z.infer<typeof LayerOrReferenceSchema>;
