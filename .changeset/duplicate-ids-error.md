---
"@maplibre-yaml/core": patch
---

Two chapters with the same `id` are now a validation error that names both lines: `Two chapters have id "the-met" (lines 96 and 144). Each chapter needs its own id: rename this one.` Copying a chapter and forgetting to change its `id` used to validate, then fly the copy to the original chapter's camera and send its rail dot back to the original. The error shows on the page's error card, in `maplibre-yaml validate`, and in the Astro loaders.

Two layers with the same `id` still render, as in 0.8.0: the first one is drawn and the repeat is skipped. Validation now warns about it (`Two layers have id "walk" (lines 40 and 52): the first one is drawn and this one is skipped`), and the map's notice says the same in place of MapLibre's "already exists" error. Before, the repeat could also add a second copy of its source.
