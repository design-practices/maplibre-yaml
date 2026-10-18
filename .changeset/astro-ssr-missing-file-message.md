---
"@maplibre-yaml/astro": patch
---

When `loadMapConfig`, `loadScrollytellingConfig`, `loadGlobalMapConfig` or `loadYAML` cannot find their file, the error now says why it probably happened. On a server with no `src/` folder (an `output: 'server'` deploy rendering the page on request), it suggests `export const prerender = true` or importing the YAML. Inside the project it points at the path's spelling. The bare *ENOENT* used to give no hint.
