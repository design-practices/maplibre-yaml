---
"@maplibre-yaml/astro": patch
---

Declare `zod` and `yaml` as runtime dependencies. Both are imported at runtime by the package's utils (`loader.ts`, the collection/feature-ref schemas) but were only listed in `devDependencies`, so the package broke under strict/isolated installs (pnpm without hoisting, Yarn PnP) that don't resolve them transitively through `@maplibre-yaml/core`. Ranges match core's (`zod ^3.23.0`, `yaml ^2.4.0`).
