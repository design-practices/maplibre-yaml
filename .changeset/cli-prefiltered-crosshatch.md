---
"@maplibre-yaml/cli": patch
---

`mlym bake crosshatch` now writes hatch textures pre-filtered for MapLibre, so they no longer shimmer when the map draws them at an angle. MapLibre samples pattern images without mipmaps, so on a pitched map the far ground showed the hatch strokes breaking up and crawling as the map moved. The earth and landuse hatches are now baked at twice Tangram's period, with softened strokes at 85 % contrast, as 512 px, 32-tone palette PNGs (declare them at `pixelRatio: 2`). The preset no longer writes `building-fallback.png`, because the crosshatch style now draws plain lit walls: a pattern on a wall is drawn edge-on and shimmers most. If you want hatched walls in a static style, the new `mlym bake crosshatch-walls` writes `building-hatch.png`, a wall hatch pre-filtered along the stroke.
