---
"@maplibre-yaml/core": patch
---

Maps now render under `astro dev` when installed from npm. Every `@maplibre-yaml/astro` component used to fail in the dev server with "Failed to create map: Map is not a constructor", while `astro build` worked. The cause: Vite never pre-bundles maplibre-gl when only a dependency's `.astro` file imports it, so the browser got the raw UMD file, which exposes no ES exports. Core now falls back to the `maplibregl` global that the UMD file sets. On earlier versions, add `vite: { optimizeDeps: { include: ["maplibre-gl"] } }` to `astro.config.mjs`.
