---
"@maplibre-yaml/core": patch
---

Pattern and icon images declared denser than the screen no longer alias. An `images:` entry with a `pixelRatio` above the display's (for example the crosshatch classic's `pixelRatio: 4` building hatch on a Retina screen) used to reach MapLibre at full size and be drawn minified without mipmaps, so thin hatch strokes broke into dots and crawled as the map moved. `<ml-map>` now resamples such images to the screen's pixel ratio before registering them, keeping their size on the map, so the live document draws the same pixels as the sprite that `mlym emit` exports. SDF images are unchanged.
