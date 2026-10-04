---
"@maplibre-yaml/cli": minor
---

New `mlym bake <preset> --out <dir>` command. It reproducibly regenerates the pattern images for the Mapzen-classic static presets: `crosshatch` derives its ink-on-paper ground, landuse, pre-lit water and building hatch from Tangram's MIT-licensed source textures, which now ship in the package with their provenance; `blueprint` generates a drafting grid. Run `mlym bake` with no preset to list the available presets.
