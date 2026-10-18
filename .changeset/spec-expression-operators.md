---
"@maplibre-yaml/core": patch
---

Valid MapLibre expression operators added in recent maplibre-gl versions (`split`, `join`, `elevation`, `semiliteral`, …) no longer warn as unknown. The list of known operators was written by hand and had fallen behind; `maplibre-yaml validate` turns warnings into errors when it runs in CI, so a valid document using one of them failed validation and builds. The operator list, and the list of operators that may take no arguments (`["elevation"]`), now come from the MapLibre style specification itself, so operators MapLibre adds later are recognised too. A typo still gets a "did you mean" hint.
