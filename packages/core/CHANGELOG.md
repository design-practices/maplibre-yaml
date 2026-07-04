# @maplibre-yaml/core

## 0.2.2

### Patch Changes

- a053545: Revert the named-import change from 0.2.1 and update tests

  ### Bug fixes

  - **`@maplibre-yaml/core`**: reverted `map-renderer`, `controls-manager`, and `event-handler` from named `maplibre-gl` imports back to the default `maplibregl` import (e.g. `new maplibregl.Map(...)`), because the named-import build broke existing consumers. The maplibre-gl v5 peer range widening from 0.2.1 remains in place.
  - Updated the renderer, component, and integration tests to match the reverted import style.

## 0.2.1

### Patch Changes

- c24084a: Fix maplibre-gl v5 compatibility and peer dependency ranges

  ### Bug fixes

  - **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
  - **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
  - **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
  - **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

  These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.

## 0.2.0

### Minor Changes

- 937738a: Add block-level named sources to MapBlockSchema and MapFullPageBlockSchema

  ### New Feature: Named Sources

  Sources can now be defined at the map block level and referenced by string ID across multiple layers, rather than being inlined on each layer. This enables source reuse and cleaner YAML when multiple layers share the same data.

  ```yaml
  sources:
    boundary:
      type: geojson
      url: "/data/boundary.geojson"
  layers:
    - id: boundary-fill
      type: fill
      source: boundary # string reference
    - id: boundary-outline
      type: line
      source: boundary # same source, different layer
  ```

  - Added optional `sources` field to `MapBlockSchema` and `MapFullPageBlockSchema`
  - `MapRenderer` now accepts named sources and adds them to the map before processing layers
  - `LayerManager` correctly resolves string source references and avoids removing shared sources when individual layers are removed
  - Inline sources on layers continue to work as before — the two approaches can be mixed

## 0.1.0

### Minor Changes

- e7e1126: "add docs"
