---
"@maplibre-yaml/core": minor
---

A layer's `interactive.click` and `interactive.hover` take a `tolerance` in pixels: how far from a feature the pointer may be and still count as on it, so thin lines and small points are easier to click and hover without a duplicate transparent hit-area layer. With `tolerance: 6`, a click or hover within 6 px of a feature of that layer opens its popup, runs its actions and `emit`, sets its cursor and highlight, and fires the element's `ml-map:layer-click` / `ml-map:layer-hover` events exactly as a click or hover on the feature itself does; the topmost feature within reach is the one picked. Absent or `0` keeps today's on-the-feature behaviour unchanged. The key is runtime-only, so `mlym emit` leaves it out of the exported `style.json` with the rest of `interactive:`, and a live document update that adds, changes or removes it re-binds the layer's listeners in place.
