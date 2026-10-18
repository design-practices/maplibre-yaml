# mlym

## 0.1.0

### Minor Changes

- 9c6f51a: New: `mlym` and `maplibre-yaml` on npm are official aliases for `@maplibre-yaml/cli`, so `npx mlym validate map.yaml` (or `npx maplibre-yaml …`) runs the maplibre-yaml command line even when the CLI isn't installed in the project. Before, those names were unclaimed: `npx mlym` failed outside a project with the CLI installed, and anyone could have published a different package under either name. Each alias depends on `@maplibre-yaml/cli` and runs it unchanged, so every command and flag is the same.

### Patch Changes

- Updated dependencies [4fb7da1]
- Updated dependencies [6fc625a]
  - @maplibre-yaml/cli@0.4.1
