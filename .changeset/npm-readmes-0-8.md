---
"@maplibre-yaml/core": patch
"@maplibre-yaml/astro": patch
"@maplibre-yaml/cli": patch
"@maplibre-yaml/effects": patch
"maplibre-yaml": patch
---

The npm READMEs are rewritten for 0.8 as short orientations that match the docs site: what the package is, how to install it, one working example per way of using it (copied from the docs and run as printed), the main features, supported versions, and links to the docs pages for everything else. The core README now pins the CDN example to `@maplibre-yaml/core@0.8`, uses the `MapRenderer.fromModel` API the docs teach, covers `<ml-scrollytelling>`, `base`, slots and the on-page error card, and includes maplibre-gl 6's `setWorkerUrl` bundler setup (the effects README and guide gained it too: without it, an effects page built with Vite failed with *Worker failed to load*). The CLI README explains when `npx maplibre-yaml`, `npx @maplibre-yaml/cli` and `mlym` work. Each package's `homepage` now points at its docs page, and the descriptions and keywords say what the package does.
