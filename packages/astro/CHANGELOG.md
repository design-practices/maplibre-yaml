# @maplibre-yaml/astro

## 0.1.3

### Patch Changes

- c24084a: Fix maplibre-gl v5 compatibility and peer dependency ranges

  ### Bug fixes

  - **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
  - **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
  - **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
  - **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

  These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.

- Updated dependencies [c24084a]
  - @maplibre-yaml/core@0.2.1

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
