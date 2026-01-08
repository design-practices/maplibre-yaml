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
  /** Debug mode - shows chapter boundaries */
  debug?: boolean;
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
  /** Whether this chapter is currently active */
  isActive?: boolean;
  /** Visual theme */
  theme?: "light" | "dark";
}
