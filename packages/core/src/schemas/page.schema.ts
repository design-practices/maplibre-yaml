/**
 * @file Page and root configuration schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/page
 *
 * @description
 * Zod schemas for pages, global configuration, and the root schema.
 * Includes recursive MixedBlock for complex layouts.
 *
 * @example
 * ```typescript
 * import { RootSchema, PageSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import { LngLatSchema } from "./base.schema";
import { ContentBlockSchema } from "./content.schema";
import { MapBlockSchema, MapFullPageBlockSchema } from "./map.schema";
import { ScrollytellingBlockSchema } from "./scrollytelling.schema";
import { LayerSchema } from "./layer.schema";
import { LayerSourceSchema } from "./source.schema";
/**
 * Mixed block for combining multiple block types.
 *
 * @remarks
 * MixedBlock allows you to create complex layouts by combining
 * content, map, and scrollytelling blocks. Uses z.lazy() for recursion.
 *
 * **Layout Options:**
 * - `row` - Horizontal layout (default)
 * - `column` - Vertical layout
 * - `grid` - CSS Grid layout
 *
 * @example Row Layout
 * ```yaml
 * - type: mixed
 *   layout: row
 *   blocks:
 *     - type: content
 *       content:
 *         - h2: [{ str: "Left Column" }]
 *     - type: map
 *       id: side-map
 *       config:
 *         center: [0, 0]
 *         zoom: 2
 *         mapStyle: "..."
 * ```
 *
 * @example Grid Layout
 * ```yaml
 * - type: mixed
 *   layout: grid
 *   style: "grid-template-columns: repeat(2, 1fr); gap: 20px;"
 *   blocks:
 *     - type: content
 *       content: [...]
 *     - type: content
 *       content: [...]
 *     - type: map
 *       id: map1
 *       config: {...}
 *     - type: map
 *       id: map2
 *       config: {...}
 * ```
 *
 * @example Nested Mixed Blocks
 * ```yaml
 * - type: mixed
 *   layout: column
 *   blocks:
 *     - type: content
 *       content: [...]
 *     - type: mixed
 *       layout: row
 *       blocks:
 *         - type: map
 *           id: left-map
 *           config: {...}
 *         - type: map
 *           id: right-map
 *           config: {...}
 * ```
 */
export const MixedBlockSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      type: z.literal("mixed").describe("Block type"),
      id: z.string().optional().describe("Unique block identifier"),
      className: z.string().optional().describe("CSS class name for container"),
      style: z.string().optional().describe("Inline CSS styles for container"),
      layout: z
        .enum(["row", "column", "grid"])
        .default("row")
        .describe("Layout direction"),
      gap: z
        .string()
        .optional()
        .describe("Gap between blocks (CSS gap property)"),
      blocks: z.array(BlockSchema).describe("Child blocks"),
    })
    .describe("Mixed block for combining multiple block types")
);

/** Inferred type for mixed block. */
export type MixedBlock = {
  type: "mixed";
  id?: string;
  className?: string;
  style?: string;
  layout?: "row" | "column" | "grid";
  gap?: string;
  blocks: Block[];
};

/**
 * Union of all block types.
 *
 * @remarks
 * Blocks are the building blocks of pages. Each page contains an
 * array of blocks that are rendered in order.
 *
 * **Block Types:**
 * - `content` - Rich text and media
 * - `map` - Standard map
 * - `map-fullpage` - Full viewport map
 * - `scrollytelling` - Narrative map story
 * - `mixed` - Layout container for other blocks
 */
export const BlockSchema: z.ZodType<any> = z.union([
  ContentBlockSchema,
  MapBlockSchema,
  MapFullPageBlockSchema,
  ScrollytellingBlockSchema,
  MixedBlockSchema,
]);

/** Inferred type for any block. */
export type Block = z.infer<typeof BlockSchema>;

/**
 * Page configuration.
 *
 * @remarks
 * A page represents a single route/URL in your application.
 * Pages contain blocks that define the content and maps.
 *
 * **Required:**
 * - `path` - URL path (e.g., "/", "/about", "/map")
 * - `title` - Page title (used for browser tab and SEO)
 * - `blocks` - Array of content/map blocks
 *
 * **Optional:**
 * - `description` - Meta description for SEO
 *
 * @example Home Page
 * ```yaml
 * - path: "/"
 *   title: "Home"
 *   description: "Welcome to our mapping application"
 *   blocks:
 *     - type: content
 *       content:
 *         - h1: [{ str: "Welcome" }]
 *     - type: map
 *       id: home-map
 *       config:
 *         center: [0, 0]
 *         zoom: 2
 *         mapStyle: "..."
 * ```
 *
 * @example Story Page
 * ```yaml
 * - path: "/story"
 *   title: "Our Story"
 *   description: "An interactive map story"
 *   blocks:
 *     - type: scrollytelling
 *       id: main-story
 *       config: {...}
 *       chapters: [...]
 * ```
 *
 * @example Complex Layout
 * ```yaml
 * - path: "/dashboard"
 *   title: "Dashboard"
 *   blocks:
 *     - type: content
 *       content:
 *         - h1: [{ str: "Dashboard" }]
 *     - type: mixed
 *       layout: row
 *       blocks:
 *         - type: map
 *           id: map1
 *           config: {...}
 *         - type: map
 *           id: map2
 *           config: {...}
 * ```
 */
export const PageSchema = z
  .object({
    path: z.string().describe('URL path (e.g., "/", "/about")'),
    title: z.string().describe("Page title"),
    description: z.string().optional().describe("Page description for SEO"),
    blocks: z.array(BlockSchema).describe("Page content blocks"),
  })
  .describe("Page configuration");

/** Inferred type for page. */
export type Page = z.infer<typeof PageSchema>;

/**
 * Global configuration.
 *
 * @remarks
 * Global settings that apply across all pages.
 *
 * **General:**
 * - `title` - Application title
 * - `description` - Application description
 * - `defaultMapStyle` - Default map style for all maps
 * - `theme` - Default theme (light/dark)
 *
 * **Data Fetching:**
 * - `defaultStrategy` - Default fetch strategy (runtime, build, hybrid)
 * - `timeout` - Default fetch timeout
 * - `retryAttempts` - Default retry attempts
 *
 * @example Basic Config
 * ```yaml
 * config:
 *   title: "My Map App"
 *   description: "Interactive maps and stories"
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @example With Data Fetching
 * ```yaml
 * config:
 *   title: "My Map App"
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 *   theme: dark
 *   dataFetching:
 *     defaultStrategy: build
 *     timeout: 15000
 *     retryAttempts: 5
 * ```
 */
export const GlobalConfigSchema = z
  .object({
    title: z.string().optional().describe("Application title"),
    description: z.string().optional().describe("Application description"),
    defaultMapStyle: z
      .string()
      .url()
      .optional()
      .describe("Default map style URL"),
    theme: z.enum(["light", "dark"]).default("light").describe("Default theme"),
    defaultZoom: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe("Default zoom level for all maps"),
    defaultCenter: LngLatSchema.optional().describe(
      "Default center [lng, lat] for all maps",
    ),
    dataFetching: z
      .object({
        defaultStrategy: z
          .enum(["runtime", "build", "hybrid"])
          .default("runtime")
          .describe("Default fetch strategy"),
        timeout: z
          .number()
          .min(1000)
          .default(30000)
          .describe("Default timeout in milliseconds"),
        retryAttempts: z
          .number()
          .int()
          .min(0)
          .default(3)
          .describe("Default retry attempts"),
      })
      .optional()
      .describe("Data fetching configuration"),
  })
  .describe("Global configuration");

/** Inferred type for global config. */
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/**
 * Root configuration schema.
 *
 * @remarks
 * The root schema represents the entire maplibre-yaml configuration.
 * This is the top-level structure for YAML files.
 *
 * **Structure:**
 * 1. `config` - Global settings (optional)
 * 2. `layers` - Named layer definitions for reuse (optional)
 * 3. `sources` - Named source definitions for reuse (optional)
 * 4. `pages` - Page definitions (required, minimum 1)
 *
 * **Global Layers and Sources:**
 * Define layers and sources once, reference them anywhere using `$ref`.
 *
 * @example Minimal Configuration
 * ```yaml
 * pages:
 *   - path: "/"
 *     title: "Home"
 *     blocks:
 *       - type: map
 *         id: main-map
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 *           mapStyle: "https://demotiles.maplibre.org/style.json"
 * ```
 *
 * @example With Global Config
 * ```yaml
 * config:
 *   title: "My App"
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 *
 * pages:
 *   - path: "/"
 *     title: "Home"
 *     blocks:
 *       - type: map
 *         id: main-map
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 * ```
 *
 * @example With Global Layers
 * ```yaml
 * config:
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 *
 * layers:
 *   bikeLayer:
 *     id: bikes
 *     type: line
 *     source:
 *       type: geojson
 *       url: "https://example.com/bikes.geojson"
 *     paint:
 *       line-color: "#00ff00"
 *       line-width: 2
 *
 *   parkLayer:
 *     id: parks
 *     type: fill
 *     source:
 *       type: geojson
 *       url: "https://example.com/parks.geojson"
 *     paint:
 *       fill-color: "#228B22"
 *       fill-opacity: 0.5
 *
 * pages:
 *   - path: "/"
 *     title: "Home"
 *     blocks:
 *       - type: map
 *         id: main-map
 *         config:
 *           center: [-74.006, 40.7128]
 *           zoom: 12
 *         layers:
 *           - $ref: "#/layers/bikeLayer"
 *           - $ref: "#/layers/parkLayer"
 * ```
 *
 * @example With Global Sources
 * ```yaml
 * sources:
 *   earthquakeSource:
 *     type: geojson
 *     url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
 *     refreshInterval: 60000
 *
 * layers:
 *   earthquakes:
 *     id: earthquakes
 *     type: circle
 *     source: earthquakeSource
 *     paint:
 *       circle-radius: 8
 *       circle-color: "#ff0000"
 *
 * pages:
 *   - path: "/"
 *     title: "Earthquakes"
 *     blocks:
 *       - type: map
 *         id: quake-map
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 *           mapStyle: "..."
 *         layers:
 *           - $ref: "#/layers/earthquakes"
 * ```
 *
 * @example Multi-Page Application
 * ```yaml
 * config:
 *   title: "Multi-Page Map App"
 *   defaultMapStyle: "https://demotiles.maplibre.org/style.json"
 *
 * pages:
 *   - path: "/"
 *     title: "Home"
 *     blocks:
 *       - type: content
 *         content:
 *           - h1: [{ str: "Welcome" }]
 *
 *   - path: "/map"
 *     title: "Interactive Map"
 *     blocks:
 *       - type: map
 *         id: main-map
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 *
 *   - path: "/story"
 *     title: "Our Story"
 *     blocks:
 *       - type: scrollytelling
 *         id: story
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 *         chapters:
 *           - id: intro
 *             title: "Introduction"
 *             center: [0, 0]
 *             zoom: 3
 * ```
 */
export const RootSchema: z.ZodType<any> = z
  .object({
    config: GlobalConfigSchema.optional().describe("Global configuration"),
    layers: z
      .record(LayerSchema)
      .optional()
      .describe("Named layer definitions for reuse"),
    sources: z
      .record(LayerSourceSchema)
      .optional()
      .describe("Named source definitions for reuse"),
    pages: z
      .array(PageSchema)
      .min(1, "At least one page is required")
      .describe("Page definitions"),
  })
  .describe("Root configuration schema");

/** Inferred type for root configuration. */
export type RootConfig = z.infer<typeof RootSchema>;
