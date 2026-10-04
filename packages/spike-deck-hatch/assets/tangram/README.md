# Tangram crosshatch source textures

Vendored verbatim, unmodified, from Mapzen's Tangram projects (both MIT):

| File | Source |
|---|---|
| `hatch_0.png`, `hatch_2.png`, `normal-0031.jpg` | tangrams/tangram-sandbox `styles/imgs/` (crosshatch style by @patriciogv, 2015) |
| `hatch.png` (3×3 tonal hatch atlas) | tangrams/blocks `filter/imgs/hatch.png` (hatch filter after Jaume Sanchez's cross-hatching shader) |

`scripts/bake-crosshatch.ts` derives the preset's ink-on-paper textures from
these. Tangram's crosshatch style itself: tangram-sandbox `styles/crosshatch.yaml`.
