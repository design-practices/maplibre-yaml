---
"@maplibre-yaml/core": patch
---

Hillshade layers now validate MapLibre's multidirectional lighting (maplibre-gl ≥ 5.5). Set `hillshade-method` to `standard`, `basic`, `combined`, `igor` or `multidirectional`. `hillshade-illumination-direction`, `hillshade-illumination-altitude`, `hillshade-highlight-color` and `hillshade-shadow-color` each accept one value per light as a list, for example `hillshade-illumination-direction: [270, 315, 0, 45]`. Before this release a direction list failed validation, so a multidirectional hillshade document could not be authored.
