---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

`markers:` — standalone map pins as first-class YAML, and the format's
first construct that *exports with a fallback*. Live, each entry is a real
`maplibregl.Marker` DOM pin: `at:` position, `color:`/`size:` on the default
pin, `icon:` swapping in any image URL (a failed load or unsafe URL scheme
falls back to the pin with one console note), and `popup:` carrying the same
trust-gated structured content as layer popups. Authored at the v1 document
root or v2 `runtime.markers` — the two normalize identically. `<ml-map>`
surfaces marker lifecycle as `ml-map:markers-added`, `ml-map:marker-click`,
and `ml-map:marker-icon-error` events (mirroring the layer events), and
`MarkerSchema`/`MarkersSchema`/`MarkerConfig` are exported from the schemas
barrel. `color:` validates as a real color, not any string.

On export, `mlym emit --with-fallbacks` lowers markers to a symbol layer
("mlym-markers") with generated pin sprites through the sprite pipeline,
reported as a `lossy` warning; `--strict` refuses marker documents, because a
DOM marker and a symbol layer are close but not identical. Icon URLs are not
embedded yet (that arrives with `images:`) — the emitted style substitutes
the default pin and says so. The export-class registry carries the lowering as its `export()` hook. Three gallery examples (default marker, custom icons, marker popup) are now plain YAML.
