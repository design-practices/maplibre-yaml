/**
 * @file Scrollytelling schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/scrollytelling
 *
 * @description
 * Zod schemas for narrative scrollytelling maps with chapters, animations,
 * and layer transitions.
 *
 * @example
 * ```typescript
 * import { ScrollytellingBlockSchema, ChapterSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";
import { LngLatSchema, ExpressionSchema } from "./base.schema";
import { MapConfigSchema, MapBlockSchema } from "./map.schema";
import { LayerOrReferenceSchema } from "./layer.schema";
import { STORY_MAP_KEYS } from "../scrollytelling/keys";

export { STORY_MAP_KEYS };

/**
 * A chapter's `image`/`video`: an http(s) URL, or a path to a file on the
 * site — root-relative (`/images/fuji.jpg`, a file in an Astro or Vite
 * `public/` folder), protocol-relative, explicitly relative (`./clip.mp4`) or
 * bare relative (`images/fuji.jpg`).
 *
 * @remarks
 * This used to be `z.string().url()`, which rejected the root-relative path
 * every static-site author reaches for ("Invalid URL format") while
 * accepting `javascript:` and `data:` (well-formed to `new URL()`). The
 * renderers already took relative paths (`safeMediaSrc`); the schema now
 * agrees with them (ml-aot.6). Same shape as the source-URL rule in
 * `source.schema.ts` — a regex, so it stays a `ZodString` and emits a
 * `pattern` into the JSON Schema — but scheme-restricted to http(s): a media
 * element has no use for other schemes, and the trust model keeps
 * `javascript:`/`data:` out of author-supplied media. A bare relative path is
 * accepted (ml-zft) only when nothing before its first `/`, `?` or `#`
 * contains a `:`, so `javascript:x` and `data:image/png,...` stay rejected.
 * Relative paths resolve against the page, not the YAML file.
 */
// Spelled case-insensitively without the `i` flag, which JSON Schema
// `pattern` cannot carry: editors and zod must agree.
const MEDIA_REFERENCE =
  /^(?:[hH][tT][tT][pP][sS]?:\/\/|\/|\.\.?\/|[^\s:/?#][^:/?#]*(?:[/?#]|$))/;

const MediaURLSchema = (what: "image" | "video") =>
  z
    .string()
    .regex(
      MEDIA_REFERENCE,
      `Must be an http(s) URL (https://example.com/${what === "image" ? "photo.jpg" : "clip.mp4"}) ` +
        `or a path to a file on your site (${what === "image" ? "images/photo.jpg" : "videos/clip.mp4"}, ` +
        `or /${what === "image" ? "images/photo.jpg" : "videos/clip.mp4"} for a file in public/)`
    );

/**
 * Chapter action for map state changes.
 *
 * @remarks
 * Actions are triggered when entering or exiting a chapter.
 * They can modify layer properties, filters, or trigger animations.
 *
 * **Action Types:**
 * - `setFilter` - Update layer filter
 * - `setPaintProperty` - Update layer paint property
 * - `setLayoutProperty` - Update layer layout property
 * - `flyTo` - Fly to location (handled by chapter config)
 * - `easeTo` - Ease to location (handled by chapter config)
 * - `fitBounds` - Fit to bounds
 * - `custom` - Custom action (handled by application)
 *
 * @example Set Filter
 * ```yaml
 * onChapterEnter:
 *   - action: setFilter
 *     layer: earthquakes
 *     filter: [">=", ["get", "magnitude"], 5]
 * ```
 *
 * @example Set Paint Property
 * ```yaml
 * onChapterEnter:
 *   - action: setPaintProperty
 *     layer: buildings
 *     property: fill-extrusion-height
 *     value: ["get", "height"]
 * ```
 *
 * @example Fit Bounds
 * ```yaml
 * onChapterEnter:
 *   - action: fitBounds
 *     bounds: [-74.3, 40.5, -73.7, 40.9]
 *     options:
 *       padding: 50
 *       duration: 1000
 * ```
 */
export const ChapterActionSchema = z
  .object({
    action: z
      .enum([
        "setFilter",
        "setPaintProperty",
        "setLayoutProperty",
        "flyTo",
        "easeTo",
        "fitBounds",
        "custom",
      ])
      .describe("Action type"),
    layer: z.string().optional().describe("Target layer ID"),
    property: z
      .string()
      .optional()
      .describe("Property name (for setPaintProperty/setLayoutProperty)"),
    value: z.any().optional().describe("Property value"),
    filter: ExpressionSchema.nullable()
      .optional()
      .describe("Filter expression (for setFilter, null to clear)"),
    bounds: z
      .array(z.number())
      .optional()
      .describe("Bounds array (for fitBounds)"),
    options: z.record(z.any()).optional().describe("Additional options"),
  })
  .describe("Chapter action for map state changes");

/** Inferred type for chapter action. */
export type ChapterAction = z.infer<typeof ChapterActionSchema>;

/**
 * Chapter layer visibility configuration.
 *
 * @remarks
 * Controls which layers are visible during this chapter.
 *
 * @example
 * ```yaml
 * layers:
 *   show:
 *     - earthquakes
 *     - fault-lines
 *   hide:
 *     - buildings
 * ```
 */
export const ChapterLayersSchema = z
  .object({
    show: z.array(z.string()).default([]).describe("Layer IDs to show"),
    hide: z.array(z.string()).default([]).describe("Layer IDs to hide"),
  })
  .describe("Chapter layer visibility configuration");

/** Inferred type for chapter layers. */
export type ChapterLayers = z.infer<typeof ChapterLayersSchema>;

/**
 * Scrollytelling chapter.
 *
 * @remarks
 * A chapter represents one section of the scrollytelling narrative.
 * As the user scrolls, the map transitions between chapters with
 * camera animations and layer changes.
 *
 * **Required:**
 * - `id` - Unique chapter identifier
 * - `title` - Chapter title
 * - `center` - Map center for this chapter
 * - `zoom` - Zoom level for this chapter
 *
 * **Content:**
 * - `description` - HTML description (supports markdown)
 * - `image` - Hero image: http(s) URL or site path (`/images/x.jpg`)
 * - `video` - Video: http(s) URL or site path
 *
 * **Camera:**
 * - `pitch` - Camera tilt (0-85)
 * - `bearing` - Camera rotation (-180 to 180)
 * - `animation` - Animation type (flyTo, easeTo, jumpTo)
 * - `speed`, `curve` - Animation parameters
 *
 * **Layout:**
 * - `alignment` - Content position (left, right, center, full)
 * - `hidden` - Hide chapter content (map-only)
 *
 * **Interactivity:**
 * - `layers` - Show/hide layers
 * - `onChapterEnter`, `onChapterExit` - Actions
 *
 * @example Basic Chapter
 * ```yaml
 * - id: intro
 *   title: "Welcome"
 *   description: "This is the introduction."
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 * ```
 *
 * @example Chapter with 3D View
 * ```yaml
 * - id: downtown
 *   title: "Downtown"
 *   description: "Explore the city center in 3D."
 *   center: [-74.006, 40.7128]
 *   zoom: 16
 *   pitch: 60
 *   bearing: 30
 * ```
 *
 * @example Chapter with Media
 * ```yaml
 * - id: overview
 *   title: "City Overview"
 *   description: "A bird's eye view of the city."
 *   image: "https://example.com/overview.jpg"
 *   center: [-74.006, 40.7128]
 *   zoom: 10
 * ```
 *
 * @example Chapter with Layer Control
 * ```yaml
 * - id: earthquakes
 *   title: "Recent Earthquakes"
 *   description: "Major earthquakes in the last month."
 *   center: [-120, 35]
 *   zoom: 6
 *   layers:
 *     show:
 *       - earthquakes
 *       - fault-lines
 *     hide:
 *       - cities
 * ```
 *
 * @example Chapter with Actions
 * ```yaml
 * - id: filtered
 *   title: "High Magnitude Events"
 *   center: [-120, 35]
 *   zoom: 6
 *   onChapterEnter:
 *     - action: setFilter
 *       layer: earthquakes
 *       filter: [">=", ["get", "magnitude"], 5]
 *   onChapterExit:
 *     - action: setFilter
 *       layer: earthquakes
 *       filter: null
 * ```
 *
 * @example Full-Width Chapter
 * ```yaml
 * - id: fullwidth
 *   title: "Immersive View"
 *   alignment: full
 *   center: [-74.006, 40.7128]
 *   zoom: 14
 *   pitch: 45
 * ```
 */
export const ChapterSchema = z
  .object({
    // Required
    id: z.string().describe("Unique chapter identifier"),
    title: z.string().describe("Chapter title"),
    center: LngLatSchema.describe("Map center [longitude, latitude]"),
    zoom: z.number().describe("Zoom level"),

    // Content
    description: z
      .string()
      .optional()
      .describe("Chapter text as HTML (markdown is not converted)"),
    image: MediaURLSchema("image")
      .optional()
      .describe("Hero image: an http(s) URL or a site path such as /images/photo.jpg"),
    video: MediaURLSchema("video")
      .optional()
      .describe("Video: an http(s) URL or a site path such as /videos/clip.mp4"),

    // Camera
    pitch: z
      .number()
      .min(0)
      .max(85)
      .default(0)
      .describe("Camera pitch angle (0-85)"),
    bearing: z
      .number()
      .min(-180)
      .max(180)
      .default(0)
      .describe("Camera bearing (-180 to 180)"),
    speed: z
      .number()
      .min(0)
      .max(2)
      .default(0.6)
      .describe("Animation speed multiplier (0-2)"),
    curve: z
      .number()
      .min(0)
      .max(2)
      .default(1)
      .describe("Animation curve (0=linear, 1=default, 2=steep)"),
    animation: z
      .enum(["flyTo", "easeTo", "jumpTo"])
      .default("flyTo")
      .describe("Animation type"),

    // Rotation animation
    rotateAnimation: z
      .boolean()
      .optional()
      .describe("Enable continuous rotation animation"),
    spinGlobe: z
      .boolean()
      .optional()
      .describe(
        "Slowly pan the camera westward while this chapter is active (paused under prefers-reduced-motion). Globe projection itself is the map-level `projection:`"
      ),

    // Layout
    alignment: z
      .enum(["left", "right", "center", "full"])
      .default("center")
      .describe("Content alignment"),
    hidden: z
      .boolean()
      .default(false)
      .describe("Hide chapter content (map-only)"),
    padding: z
      .union([
        z.number().min(0),
        z.object({
          top: z.number().min(0).default(0).describe("Pixels kept clear at the top"),
          right: z.number().min(0).default(0).describe("Pixels kept clear on the right"),
          bottom: z.number().min(0).default(0).describe("Pixels kept clear at the bottom"),
          left: z.number().min(0).default(0).describe("Pixels kept clear on the left"),
        }),
      ])
      .optional()
      .describe(
        "Camera padding in pixels for this chapter, used as written instead of the automatic offset that keeps `center` clear of the card"
      ),

    // Layers
    layers: ChapterLayersSchema.optional().describe("Layer visibility control"),

    // Actions
    onChapterEnter: z
      .array(ChapterActionSchema)
      .default([])
      .describe("Actions when entering chapter"),
    onChapterExit: z
      .array(ChapterActionSchema)
      .default([])
      .describe("Actions when exiting chapter"),

    // Custom
    callback: z.string().optional().describe("Custom callback function name"),
  })
  .describe("Scrollytelling chapter");

/** Inferred type for chapter. */
export type Chapter = z.infer<typeof ChapterSchema>;

/** The schemas of {@link STORY_MAP_KEYS}, taken from `MapBlockSchema`. */
function storyMapKeysShape(): Record<(typeof STORY_MAP_KEYS)[number], z.ZodTypeAny> {
  const shape = MapBlockSchema.shape as Record<string, z.ZodTypeAny>;
  return Object.fromEntries(STORY_MAP_KEYS.map((key) => [key, shape[key]])) as Record<
    (typeof STORY_MAP_KEYS)[number],
    z.ZodTypeAny
  >;
}

/**
 * Scrollytelling block for narrative map stories.
 *
 * @remarks
 * Creates an immersive scrollytelling experience where the map
 * transitions between chapters as the user scrolls through content.
 *
 * **Features:**
 * - Smooth camera transitions
 * - Layer show/hide animations
 * - Dynamic property updates
 * - Chapter-based narrative structure
 * - Customizable themes and markers
 *
 * **Structure:**
 * 1. Base map configuration (persistent)
 * 2. Persistent layers (visible throughout)
 * 3. Chapters (individual story sections)
 * 4. Optional footer
 * 5. Optional map-level keys shared with `type: map` documents
 *    (`sources`, `markers`, `legend`, `state`/`parameters`, `images`, ...)
 *
 * @example Basic Scrollytelling
 * ```yaml
 * - type: scrollytelling
 *   id: story
 *   config:
 *     center: [-74.006, 40.7128]
 *     zoom: 12
 *     mapStyle: "https://tiles.openfreemap.org/styles/liberty"
 *   chapters:
 *     - id: intro
 *       title: "Introduction"
 *       description: "Welcome to our story."
 *       center: [-74.006, 40.7128]
 *       zoom: 12
 *     - id: detail
 *       title: "A Closer Look"
 *       description: "Let's zoom in."
 *       center: [-74.006, 40.7128]
 *       zoom: 16
 * ```
 *
 * @example Themed Scrollytelling
 * ```yaml
 * - type: scrollytelling
 *   id: dark-story
 *   theme: dark
 *   showMarkers: true
 *   markerColor: "#ff0000"
 *   config:
 *     center: [0, 0]
 *     zoom: 2
 *     mapStyle: "https://tiles.openfreemap.org/styles/liberty"
 *   chapters:
 *     - id: chapter1
 *       title: "Chapter 1"
 *       center: [0, 0]
 *       zoom: 3
 * ```
 *
 * @example With Persistent Layers
 * ```yaml
 * - type: scrollytelling
 *   id: earthquake-story
 *   config:
 *     center: [-120, 35]
 *     zoom: 5
 *     mapStyle: "https://tiles.openfreemap.org/styles/liberty"
 *   layers:
 *     - id: base-layer
 *       type: circle
 *       source:
 *         type: geojson
 *         url: "https://example.com/data.geojson"
 *       paint:
 *         circle-radius: 6
 *         circle-color: "#888888"
 *   chapters:
 *     - id: overview
 *       title: "Overview"
 *       center: [-120, 35]
 *       zoom: 5
 *     - id: detail
 *       title: "Major Event"
 *       center: [-118, 34]
 *       zoom: 10
 *       layers:
 *         show:
 *           - base-layer
 * ```
 *
 * @example With Footer
 * ```yaml
 * - type: scrollytelling
 *   id: story
 *   config:
 *     center: [0, 0]
 *     zoom: 2
 *     mapStyle: "https://tiles.openfreemap.org/styles/liberty"
 *   chapters:
 *     - id: chapter1
 *       title: "Chapter 1"
 *       center: [0, 0]
 *       zoom: 3
 *   footer: |
 *     <p>Data sources: ...</p>
 *     <p>Created with maplibre-yaml</p>
 * ```
 */
export const ScrollytellingBlockSchema: z.ZodObject<any> = z
  .object({
    type: z.literal("scrollytelling").describe("Block type"),
    id: z.string().describe("Unique block identifier"),
    className: z.string().optional().describe("CSS class name for container"),
    style: z.string().optional().describe("Inline CSS styles for container"),

    // Base config. Use MapConfigSchema directly (no re-describe) so its
    // open-passthrough identity is preserved and MapLibre options passed
    // through the map config are not flagged as unknown keys.
    config: MapConfigSchema,

    // Theme
    theme: z.enum(["light", "dark"]).default("light").describe("Visual theme"),

    // Markers
    showMarkers: z
      .boolean()
      .default(false)
      .describe("Show chapter markers on map"),
    markerColor: z.string().default("#3FB1CE").describe("Chapter marker color"),

    // Layout helpers (both on by default)
    cameraOffset: z
      .boolean()
      .default(true)
      .describe(
        "Offset the camera so each chapter's `center` is not under its card (false: centre it in the whole map)"
      ),
    moveChrome: z
      .boolean()
      .default(true)
      .describe(
        "Move the legend and corner slots out of a card's way as it scrolls past (false: they stay in their corners)"
      ),

    // Layers (persistent across all chapters)
    layers: z
      .array(LayerOrReferenceSchema)
      .default([])
      .describe("Persistent layers (visible throughout story)"),

    // Chapters
    chapters: z
      .array(ChapterSchema)
      .min(1, "At least one chapter is required for scrollytelling")
      .describe("Story chapters"),

    // Footer
    footer: z.string().optional().describe("Footer content (HTML)"),

    // The rest of the map document (ml-t2x). The story's map is rendered by
    // an `<ml-map>`, so every map-level key a `type: map` document takes
    // works here too, with the same schema: named `sources:`, standalone
    // `markers:`, `legend:`, the params panel (`state:` + `parameters:`),
    // `images:`, `controls:`, and the 3D/globe keys.
    ...storyMapKeysShape(),
  })
  .describe("Scrollytelling block for narrative map stories");

/** Inferred type for scrollytelling block. */
export type ScrollytellingBlock = z.infer<typeof ScrollytellingBlockSchema>;
