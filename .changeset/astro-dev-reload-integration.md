---
"@maplibre-yaml/astro": minor
---

New optional integration, `@maplibre-yaml/astro/integration`, that makes `astro dev` reload the page when a map file changes. Add `maplibreYaml()` to `integrations` in `astro.config.mjs`. It reloads when a file read by `loadMapConfig`, `loadScrollytellingConfig`, `loadGlobalMapConfig` or a `feature_ref` changes, re-running the modules that read it. Edits to a global config loaded with a module-level `await loadGlobalMapConfig(...)` used to be ignored until the dev server restarted. It also reloads when YAML, GeoJSON or JSON under `public/` changes, and it pre-bundles maplibre-gl and `@maplibre-yaml/core` when the dev server starts, so the first page with a map no longer triggers Vite's "new dependencies optimized" reload (with *504 (Outdated Optimize Dep)* errors in the console). It does nothing in `astro build`.
