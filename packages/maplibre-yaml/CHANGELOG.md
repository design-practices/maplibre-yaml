# maplibre-yaml

## 0.1.1

### Patch Changes

- 6750a12: The npm READMEs are rewritten for 0.8 as short orientations that match the docs site: what the package is, how to install it, one working example per way of using it (copied from the docs and run as printed), the main features, supported versions, and links to the docs pages for everything else. The core README now pins the CDN example to `@maplibre-yaml/core@0.8`, uses the `MapRenderer.fromModel` API the docs teach, covers `<ml-scrollytelling>`, `base`, slots and the on-page error card, and includes maplibre-gl 6's `setWorkerUrl` bundler setup (the effects README and guide gained it too: without it, an effects page built with Vite failed with _Worker failed to load_). The CLI README explains when `npx maplibre-yaml`, `npx @maplibre-yaml/cli` and `mlym` work. Each package's `homepage` now points at its docs page, and the descriptions and keywords say what the package does.
- Updated dependencies [b7a8f09]
- Updated dependencies [6750a12]
  - @maplibre-yaml/cli@0.4.2

## 0.1.0

### Minor Changes

- 9c6f51a: New: `mlym` and `maplibre-yaml` on npm are official aliases for `@maplibre-yaml/cli`, so `npx mlym validate map.yaml` (or `npx maplibre-yaml …`) runs the maplibre-yaml command line even when the CLI isn't installed in the project. Before, those names were unclaimed: `npx mlym` failed outside a project with the CLI installed, and anyone could have published a different package under either name. Each alias depends on `@maplibre-yaml/cli` and runs it unchanged, so every command and flag is the same.

### Patch Changes

- Updated dependencies [4fb7da1]
- Updated dependencies [6fc625a]
  - @maplibre-yaml/cli@0.4.1
