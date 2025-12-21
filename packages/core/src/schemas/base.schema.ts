/**
 * @file Base schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/base
 *
 * @description
 * Foundational Zod schemas for coordinates, colors, expressions, and other
 * primitive types used throughout the library.
 *
 * @example
 * ```typescript
 * import { LngLatSchema, ColorSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";

/**
 * Longitude value in degrees.
 *
 * @remarks
 * Valid range: -180 to 180 (inclusive)
 *
 * @example
 * ```typescript
 * const lng = LongitudeSchema.parse(-74.006);
 * ```
 */
export const LongitudeSchema = z
  .number()
  .min(-180, "Longitude must be >= -180")
  .max(180, "Longitude must be <= 180")
  .describe("Longitude in degrees (-180 to 180)");

/**
 * Latitude value in degrees.
 *
 * @remarks
 * Valid range: -90 to 90 (inclusive)
 *
 * @example
 * ```typescript
 * const lat = LatitudeSchema.parse(40.7128);
 * ```
 */
export const LatitudeSchema = z
  .number()
  .min(-90, "Latitude must be >= -90")
  .max(90, "Latitude must be <= 90")
  .describe("Latitude in degrees (-90 to 90)");

/**
 * Geographic coordinates as [longitude, latitude].
 *
 * @remarks
 * **Validation Rules:**
 * - Longitude: -180 to 180
 * - Latitude: -90 to 90
 * - Must be a 2-element tuple
 *
 * Follows GeoJSON convention (lng, lat), not (lat, lng).
 *
 * **Common Values:**
 * - `[0, 0]` - Null Island (Gulf of Guinea)
 * - `[-74.006, 40.7128]` - New York City
 * - `[139.6917, 35.6895]` - Tokyo
 *
 * @example YAML
 * ```yaml
 * center: [-74.006, 40.7128]
 * ```
 *
 * @example TypeScript
 * ```typescript
 * const coords = LngLatSchema.parse([-74.006, 40.7128]);
 * ```
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.1 | GeoJSON Position}
 */
export const LngLatSchema = z
  .tuple([LongitudeSchema, LatitudeSchema])
  .describe("Geographic coordinates as [longitude, latitude]");

/** Inferred type for geographic coordinates. */
export type LngLat = z.infer<typeof LngLatSchema>;

/**
 * Bounding box as [west, south, east, north].
 *
 * @remarks
 * Defines a rectangular geographic area. Corner order:
 * 1. West (min longitude)
 * 2. South (min latitude)
 * 3. East (max longitude)
 * 4. North (max latitude)
 *
 * @example YAML
 * ```yaml
 * maxBounds: [-74.3, 40.5, -73.7, 40.9]
 * ```
 *
 * @example TypeScript
 * ```typescript
 * // NYC bounding box
 * const bounds = LngLatBoundsSchema.parse([-74.3, 40.5, -73.7, 40.9]);
 * ```
 */
export const LngLatBoundsSchema = z
  .tuple([
    LongitudeSchema, // west
    LatitudeSchema, // south
    LongitudeSchema, // east
    LatitudeSchema, // north
  ])
  .describe("Bounding box as [west, south, east, north]");

/** Inferred type for bounding box. */
export type LngLatBounds = z.infer<typeof LngLatBoundsSchema>;

/**
 * CSS color value.
 *
 * @remarks
 * Supports multiple color formats:
 * - Hex: `#rgb`, `#rrggbb`, `#rrggbbaa`
 * - RGB: `rgb(255, 0, 0)`
 * - RGBA: `rgba(255, 0, 0, 0.5)`
 * - HSL: `hsl(0, 100%, 50%)`
 * - HSLA: `hsla(0, 100%, 50%, 0.5)`
 * - Named: `red`, `blue`, `transparent`, etc.
 *
 * @example YAML
 * ```yaml
 * paint:
 *   circle-color: "#ff0000"
 *   fill-color: "rgba(255, 0, 0, 0.5)"
 *   line-color: "hsl(120, 100%, 50%)"
 *   text-color: "blue"
 * ```
 *
 * @example TypeScript
 * ```typescript
 * const hex = ColorSchema.parse("#ff0000");
 * const rgba = ColorSchema.parse("rgba(255, 0, 0, 0.5)");
 * const named = ColorSchema.parse("red");
 * ```
 */
export const ColorSchema = z
  .string()
  .refine(
    (val) => {
      // Hex color (#rgb, #rrggbb, #rrggbbaa)
      if (val.startsWith("#")) {
        return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val);
      }
      // rgb/rgba
      if (val.startsWith("rgb")) {
        return /^rgba?\s*\([^)]+\)$/.test(val);
      }
      // hsl/hsla
      if (val.startsWith("hsl")) {
        return /^hsla?\s*\([^)]+\)$/.test(val);
      }
      // Named colors (accept any other string, browser will validate)
      return true;
    },
    {
      message:
        "Invalid color format. Use hex (#rgb, #rrggbb), rgb(), rgba(), hsl(), hsla(), or named colors.",
    }
  )
  .describe("CSS color value");

/** Inferred type for color values. */
export type Color = z.infer<typeof ColorSchema>;

/**
 * MapLibre expression for data-driven styling.
 *
 * @remarks
 * MapLibre expressions provide powerful data-driven styling capabilities.
 * An expression is an array where the first element is the operator name.
 *
 * **Common Operators:**
 * - `get` - Get feature property
 * - `interpolate` - Interpolate between values
 * - `match` - Match values
 * - `case` - Conditional logic
 * - `step` - Step function
 *
 * This schema provides basic validation (array starting with string).
 * Full expression syntax is validated by MapLibre at runtime.
 *
 * @example Get Property
 * ```yaml
 * text-field: ["get", "name"]
 * ```
 *
 * @example Interpolate by Zoom
 * ```yaml
 * circle-radius:
 *   - interpolate
 *   - ["linear"]
 *   - ["zoom"]
 *   - 5
 *   - 2
 *   - 15
 *   - 10
 * ```
 *
 * @example Match Values
 * ```yaml
 * circle-color:
 *   - match
 *   - ["get", "type"]
 *   - "park"
 *   - "#228B22"
 *   - "water"
 *   - "#4169E1"
 *   - "#808080"
 * ```
 *
 * @see {@link https://maplibre.org/maplibre-style-spec/expressions/ | MapLibre Expressions}
 */
export const ExpressionSchema: z.ZodType<any[]> = z
  .array(z.any())
  .refine((val) => val.length > 0 && typeof val[0] === "string", {
    message:
      'Expression must be an array starting with a string operator (e.g., ["get", "property"])',
  })
  .describe("MapLibre expression for data-driven styling");

/** Inferred type for expressions. */
export type Expression = z.infer<typeof ExpressionSchema>;

/**
 * Number value or MapLibre expression.
 *
 * @remarks
 * Accepts either a static number or a dynamic expression.
 * Use expressions for data-driven or zoom-dependent values.
 *
 * @example Static Value
 * ```yaml
 * circle-radius: 8
 * ```
 *
 * @example Expression
 * ```yaml
 * circle-radius:
 *   - interpolate
 *   - ["linear"]
 *   - ["get", "magnitude"]
 *   - 0
 *   - 4
 *   - 10
 *   - 20
 * ```
 */
export const NumberOrExpressionSchema = z
  .union([z.number(), ExpressionSchema])
  .describe("Number value or MapLibre expression");

/** Inferred type for number or expression. */
export type NumberOrExpression = z.infer<typeof NumberOrExpressionSchema>;

/**
 * Color value or MapLibre expression.
 *
 * @remarks
 * Accepts either a static color or a dynamic expression.
 * Use expressions for data-driven colors.
 *
 * @example Static Color
 * ```yaml
 * circle-color: "#ff0000"
 * ```
 *
 * @example Expression
 * ```yaml
 * circle-color:
 *   - match
 *   - ["get", "severity"]
 *   - "high"
 *   - "#ff0000"
 *   - "medium"
 *   - "#ffaa00"
 *   - "low"
 *   - "#00ff00"
 *   - "#808080"
 * ```
 */
export const ColorOrExpressionSchema = z
  .union([ColorSchema, ExpressionSchema])
  .describe("Color value or MapLibre expression");

/** Inferred type for color or expression. */
export type ColorOrExpression = z.infer<typeof ColorOrExpressionSchema>;

/**
 * Map zoom level.
 *
 * @remarks
 * Valid range: 0 to 24
 *
 * **Common Values:**
 * - 0 - Whole world
 * - 5 - Continent
 * - 10 - City
 * - 15 - Streets
 * - 20 - Buildings
 *
 * @example
 * ```yaml
 * zoom: 12
 * minZoom: 8
 * maxZoom: 18
 * ```
 */
export const ZoomLevelSchema = z
  .number()
  .min(0, "Zoom level must be >= 0")
  .max(24, "Zoom level must be <= 24")
  .describe("Map zoom level (0-24)");

/** Inferred type for zoom level. */
export type ZoomLevel = z.infer<typeof ZoomLevelSchema>;
