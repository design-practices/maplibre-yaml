/**
 * @file Component exports for @maplibre-yaml/astro
 * @module @maplibre-yaml/astro/components
 *
 * @description
 * Astro components for creating interactive maps and scrollytelling experiences.
 *
 * ## Available Components
 *
 * - **Map** - Basic map component for inline maps
 * - **FullPageMap** - Full viewport map with controls and legend
 * - **Scrollytelling** - Narrative scrollytelling with chapter-based transitions
 * - **Chapter** - Individual chapter (internal use)
 *
 * @example
 * ```typescript
 * import { Map, Scrollytelling } from '@maplibre-yaml/astro/components';
 * ```
 */

// Re-export components for convenience
// Users should import directly: import { Map } from '@maplibre-yaml/astro'
export { default as Map } from "./Map.astro";
export { default as FullPageMap } from "./FullPageMap.astro";
export { default as Scrollytelling } from "./Scrollytelling.astro";

// Internal component (not typically used directly)
export { default as Chapter } from "./Chapter.astro";
