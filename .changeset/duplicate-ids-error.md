---
"@maplibre-yaml/core": patch
---

Two chapters (or two layers) with the same `id` are now a validation error that names both lines: `Two chapters have id "the-met" (lines 96 and 144). Each chapter needs its own id: rename this one.` Copying a chapter and forgetting to change its `id` used to validate, then fly the copy to the original chapter's camera and send its rail dot back to the original. The error shows on the page's error card, in `maplibre-yaml validate`, and in the Astro loaders.
