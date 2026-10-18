---
"@maplibre-yaml/core": patch
---

Keys nested one level too deep under `config:` are no longer ignored silently. `markers`, `legend`, `state`, `popups`, `images`, `controls`, `terrain`, a story's `theme` and the other document-root keys now warn `"markers" belongs at the top level, next to config:, not inside it`, with the line number. A `config:` key that is neither a maplibre-yaml option nor a MapLibre map option warns `Unknown key "fooBar" in config`, with a did-you-mean when one is close (`maxZom` → `maxZoom`). Real MapLibre options (`cooperativeGestures`, `zoomSnap`, `canvasContextAttributes`, …) are still passed through without a warning.
