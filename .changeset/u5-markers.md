---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

`markers:` — standalone map pins as first-class YAML (R8), and the format's
first *ejects-via-fallback* construct (R5). Live, each entry is a real
`maplibregl.Marker` DOM pin: `at:` position, `color:`/`size:` on the default
pin, `icon:` swapping in any image URL (a failed load falls back to the pin
with one console note), and `popup:` carrying the same trust-gated structured
content as layer popups. Authored at the v1 document root or v2
`runtime.markers` — the two normalize identically.

On eject, `mlym emit --with-fallbacks` lowers markers to a symbol layer
("mlym-markers") with generated pin sprites through the sprite pipeline,
reported as a `lossy` warning; `--strict` refuses marker documents, because a
DOM marker and a symbol layer are close but not identical. Icon URLs are not
embedded yet (that arrives with `images:`) — the emitted style substitutes
the default pin and says so. The eject-class registry carries the lowering as
its `eject()` hook, so the doctrine's fallback contract is mechanical, not
prose. Three gallery pages flip Gap → Pure YAML (default marker, custom
icons, marker popup).
