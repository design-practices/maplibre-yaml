# @maplibre-yaml/astro

## 1.0.0

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.1

### Patch Changes

- Fix HTMLElement SSR crash by moving custom element registration from Astro frontmatter to client-side script tag. Add global config inheritance, map builder, and geographic collection schema documentation.

  ### Bug Fix

  - **Fix `ReferenceError: HTMLElement is not defined` during Astro SSR** — The `Map`, `FullPageMap`, and `Scrollytelling` components previously imported `@maplibre-yaml/core/register` in their frontmatter, which runs server-side where `HTMLElement` does not exist. Registration is now handled via a bundled `<script>` tag that only executes in the browser.

  ### Documentation

  - Added Global Configuration guide with `loadGlobalMapConfig` pattern
  - Added guide for adding geographic data (points, polygons, lines) to existing content collections using `LocationPointSchema`, `RegionPolygonSchema`, and `RouteLineSchema`
  - Added dynamic map-per-collection-item example with geometry type detection
  - Added troubleshooting entries for common Astro integration gotchas
  - Updated map builder examples to show `globalConfig` usage

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
