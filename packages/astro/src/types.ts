/**
 * @file TypeScript type definitions for Astro components
 * @module @maplibre-yaml/astro/types
 *
 * @description
 * Component prop types for Astro components in the maplibre-yaml library.
 * These types define the public API for the Map, FullPageMap, Scrollytelling,
 * and Chapter components.
 *
 * @example
 * ```typescript
 * import type { MapProps, ScrollytellingProps } from '@maplibre-yaml/astro';
 * ```
 */

import type { MapBlock, ScrollytellingBlock } from "@maplibre-yaml/core";

/**
 * Props for Map component.
 *
 * @remarks
 * The Map component accepts either a `src` prop pointing to a YAML file,
 * or a pre-parsed `config` object. One of these is required.
 *
 * **Data Loading:**
 * - `src` - Runtime loading from public directory
 * - `config` - Pre-parsed at build time (better performance)
 *
 * **Styling:**
 * - `height` - Container height (default: "400px")
 * - `class` - Additional CSS classes
 * - `style` - Inline CSS styles
 *
 * @example Using src prop
 * ```astro
 * <Map src="/configs/my-map.yaml" height="500px" />
 * ```
 *
 * @example Using config prop
 * ```astro
 * ---
 * import { loadMapConfig } from '@maplibre-yaml/astro/utils';
 * const config = await loadMapConfig('./src/configs/map.yaml');
 * ---
 * <Map config={config} height="500px" />
 * ```
 */
export interface MapProps {
  /** Path to YAML config file (in public directory) */
  src?: string;
  /** Pre-parsed configuration object */
  config?: MapBlock;
  /** Map container height */
  height?: string;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: string;
  /**
   * Where the paths in the map document start (`<ml-map base>`). Defaults to
   * the site's `import.meta.env.BASE_URL`, so `url: "/data/x.geojson"` and
   * `url: "data/x.geojson"` both load `public/data/x.geojson` on every page,
   * with or without a `base` in `astro.config`. Pass a path to override it,
   * or `false` to have relative paths resolve against the page instead (the
   * behaviour before `@maplibre-yaml/astro` 0.6).
   */
  base?: string | false;
  /**
   * Hide the on-page notices for non-fatal problems (`<ml-map quiet>`): the
   * "Part of this map couldn't load" notice (a data file that 404'd, a layer
   * that failed) and the zero-height hint. The problems are still logged to
   * the browser console, and a fatal problem (a document that doesn't
   * validate, a basemap that never loads) still shows its error card. For a
   * finished site whose visitors shouldn't see author-facing details.
   */
  quiet?: boolean;
  /**
   * Show author hints on the page wherever it is served (`<ml-map debug>`).
   * The notice always lists failures; hints — did-you-mean suggestions, a
   * key nested under `config:`, coordinates that look swapped, a string
   * starting with the reserved `=` — show only while you develop (in
   * `astro dev`, and on `localhost` with `astro preview`). Set `debug` to
   * check a deployed site. `quiet` still hides everything.
   */
  debug?: boolean;
}

/**
 * Props for FullPageMap component.
 *
 * @remarks
 * Extends MapProps with additional features for full-viewport maps:
 * - Navigation controls
 * - Legend display and positioning
 * - Full-screen layout
 *
 * @example
 * ```astro
 * <FullPageMap
 *   src="/configs/dashboard.yaml"
 *   showControls={true}
 *   showLegend={true}
 *   legendPosition="bottom-right"
 * />
 * ```
 */
export interface FullPageMapProps extends MapProps {
  /** Show navigation controls (zoom, reset) */
  showControls?: boolean;
  /** Show legend */
  showLegend?: boolean;
  /** Legend position */
  legendPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

/**
 * Props for Scrollytelling component.
 *
 * @remarks
 * Creates an immersive scrollytelling experience where the map
 * transitions between chapters as the user scrolls.
 *
 * **Configuration:**
 * - `src` - Path to YAML file (runtime loading)
 * - `config` - Pre-parsed configuration (build-time)
 *
 * **Features:**
 * - Smooth camera transitions
 * - Layer visibility control
 * - Chapter-based narrative
 * - Optional chapter markers
 * - Debug mode for development
 *
 * @example Using src
 * ```astro
 * <Scrollytelling src="/stories/earthquake.yaml" />
 * ```
 *
 * @example With config and debug
 * ```astro
 * ---
 * import { loadScrollytellingConfig } from '@maplibre-yaml/astro/utils';
 * const config = await loadScrollytellingConfig('./src/stories/climate.yaml');
 * ---
 * <Scrollytelling config={config} debug={true} />
 * ```
 */
export interface ScrollytellingProps {
  /** Path to YAML config file (in public directory) */
  src?: string;
  /** Pre-parsed scrollytelling configuration */
  config?: ScrollytellingBlock;
  /** Additional CSS class for container */
  class?: string;
  /**
   * Debug mode: outlines the chapter boundaries and shows author hints on
   * the story's map wherever the page is served (`<ml-scrollytelling
   * debug>`). Without it, hints show only while you develop (`astro dev`,
   * `localhost`); failures always show.
   */
  debug?: boolean;
  /**
   * Where the story's paths start (`<ml-scrollytelling base>`): `src`, every
   * path in the story's map document, and chapter `image`/`video`. Defaults to
   * the site's `import.meta.env.BASE_URL`, as on `Map`, so `/images/x.jpg`
   * and `/data/x.geojson` load from `public/` on a site under a subpath
   * (GitHub Pages). Pass a path to override it, or `false` to opt out.
   */
  base?: string | false;
  /**
   * Hide the on-page notices for non-fatal problems on the story's map
   * (`<ml-scrollytelling quiet>`), as `quiet` on `Map` does. Problems are
   * still logged to the console; a story that fails to load or validate
   * still shows its error card.
   */
  quiet?: boolean;
}

/**
 * Props for individual Chapter component.
 *
 * @remarks
 * Used internally by Scrollytelling.astro. Not typically used directly
 * by applications, but available for custom implementations.
 *
 * **Content:**
 * - `title` - Chapter title (required)
 * - `description` - HTML description (optional)
 * - `image`, `video` - Media attachments
 *
 * **Layout:**
 * - `alignment` - Content positioning
 * - `hidden` - Hide chapter content (map-only)
 * - `theme` - Visual theme
 *
 * @example
 * ```astro
 * <Chapter
 *   id="intro"
 *   title="Introduction"
 *   description="<p>Welcome to our story.</p>"
 *   alignment="left"
 *   theme="light"
 * />
 * ```
 */
export interface ChapterProps {
  /** Unique chapter identifier */
  id: string;
  /** Chapter title */
  title: string;
  /** Chapter description (HTML) */
  description?: string;
  /** Hero image URL */
  image?: string;
  /** Video URL */
  video?: string;
  /** Content alignment */
  alignment?: "left" | "right" | "center" | "full";
  /** Hide chapter content (map-only chapter) */
  hidden?: boolean;
  /**
   * Whether this chapter shows as the active one (full opacity). Defaults to
   * `true`: a standalone `Chapter` is not inside a story that would activate
   * it, so it renders as if it were being read. Pass `false` for the dimmed,
   * inactive look.
   */
  isActive?: boolean;
  /** Visual theme */
  theme?: "light" | "dark";
  /**
   * Where `image` / `video` paths start. Defaults to the site's
   * `import.meta.env.BASE_URL` (see `ScrollytellingProps.base`); `false`
   * opts out.
   */
  base?: string | false;
}
