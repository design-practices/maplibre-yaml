---
"@maplibre-yaml/cli": minor
---

`maplibre-yaml preview` now renders scrollytelling stories. `preview story.yaml` (for example on the `init --template story` output) used to stop at "Visual preview currently supports only "type: map" blocks"; it now shows the story with `<ml-scrollytelling>` on the same hot-reloading page, so saving `story.yaml` reloads it and a validation error shows the error overlay, as for maps.
