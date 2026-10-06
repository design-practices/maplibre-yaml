---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": patch
---

Three gaps from the MapLibre examples gallery can now be expressed in YAML.

- `config.fitTo: { source, padding?, maxZoom? }` fits the initial camera to a GeoJSON source's data. In format v2 it lives at `runtime.fitTo`. Inline `data:` is framed when the map is constructed, so the camera never jumps. A `url:` source is framed once its first fetch lands; refreshes don't re-fit. Tiled sources keep the authored `center`/`zoom` and log one warning. The new `ml-map:camera-fit` event fires when the fit applies. On export `fitTo` falls back: `mlym emit --with-fallbacks` computes `center`/`zoom` from inline data for a 1024×768 reference viewport and reports it as lossy, so `--strict` refuses `fitTo` documents.
- Root `popups:` (v2: `runtime.popups`) opens popups at coordinates, with no layer and no marker. Content goes through the same `PopupBuilder` trust gate as other popups. Each entry accepts `closeButton`, `closeOnClick` and `maxWidth`. Popups don't export (class `no-export`).
- The `color-relief` layer type (maplibre-gl 5.6 or later) joins the layer union with `color-relief-color` and `color-relief-opacity`. On older runtimes `<ml-map>` skips these layers with one warning instead of letting MapLibre reject the document. `mlym emit --target` below 5.6 reports the layer as lossy.

Export classes are registered for `fitTo`, `popups` and `color-relief`. `ExportContext` gains an optional `model`, and `ExportLowering` gains an optional `camera`.
