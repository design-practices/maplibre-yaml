# maplibre-yaml

## 0.2.1

### Patch Changes

- Updated dependencies [dc16ded]
- Updated dependencies [f5445e1]
- Updated dependencies [51a39ed]
- Updated dependencies [95bbbfc]
- Updated dependencies [87cbabb]
- Updated dependencies [b8c7715]
- Updated dependencies [4383762]
  - @maplibre-yaml/cli@0.6.0

## 0.2.0

### Minor Changes

- 80ea176: Installing the CLI no longer reports known vulnerabilities. `npm install @maplibre-yaml/cli` used to print "9 vulnerabilities (8 high), no fix available"; it now reports 0. sharp moves to 0.35.5, which fixes the libvips, libheif and librsvg advisories. Vite moves to 6.4, fixing dev-server advisories and the old esbuild Vite 5 brought. chokidar moves to 4 and file matching from fast-glob to tinyglobby, because the `braces` package they used has an advisory with no fixed release. Commands and options are unchanged.

  **The CLI now needs Node.js 20.9 or later** (22 or 24 LTS recommended). sharp 0.35's security fixes don't run on older Node, and Node 18 reached end of life in 2025. On an older Node the CLI stops at once with "maplibre-yaml needs Node.js 20.9 or newer, but this is Node.js 18.x" and how to update, instead of failing later. The `maplibre-yaml` alias raises its Node minimum with it, so it moves to a minor version and `^0.1` installs on Node 18 keep the old one. This applies to the command line only: `@maplibre-yaml/core` and `@maplibre-yaml/astro` still support Node 18.

### Patch Changes

- Updated dependencies [286a3c3]
- Updated dependencies [80ea176]
- Updated dependencies [255b285]
- Updated dependencies [75364f6]
- Updated dependencies [84c9c1f]
- Updated dependencies [6a2f4d4]
- Updated dependencies [92a236d]
- Updated dependencies [92a236d]
  - @maplibre-yaml/cli@0.5.0

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
