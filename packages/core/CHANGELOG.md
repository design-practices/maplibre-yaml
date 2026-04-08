# @maplibre-yaml/core

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
