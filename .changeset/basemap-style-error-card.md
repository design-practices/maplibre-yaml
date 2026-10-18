---
"@maplibre-yaml/core": patch
---

A `mapStyle` (or v2 `style.basemap`) that won't load now shows an error card on the page instead of an empty white box. The card names the URL and says what went wrong: 404 Not Found, 401/403 (keyed styles such as MapTiler need your API key), a network or CORS failure, a URL that returned a web page, or a file that isn't a MapLibre style. It also says how to check the URL. `mapReady()` now rejects and `ml-map:error` fires with `fatal: true`. Before, `mapReady()` never settled. Embedders get the same classification through a new optional third argument to `MapRendererOptions.onError`, a `MapErrorContext` of `{ kind: "style" | "layer" | "source", … }`.
