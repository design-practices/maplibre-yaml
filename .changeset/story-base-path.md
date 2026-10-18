---
"@maplibre-yaml/core": minor
"@maplibre-yaml/astro": minor
---

Stories work on a site published under a subpath, such as a GitHub Pages project site. `<ml-scrollytelling base="/my-repo/">` (attribute or `base` property, same meaning as `<ml-map base>`) resolves the story's `src`, every path in its map document (data, images, marker icons, a site-hosted style) and chapter `image`/`video` paths under the base, and hands it to the story's map. Astro's `Scrollytelling` passes the site's `base` by default (`/` included), as `Map` and `FullPageMap` do, so `/stories/tour.yaml` and `/images/photo.jpg` from `public/` load under `/<repo>/` with no change to the YAML; a standalone `Chapter`'s media does the same, and `base={false}` opts out. A story `src` that fails to load now shows the same advice as `<ml-map src>` (file not found, an HTML page instead of YAML, a page opened from disk, a missing base), in the story's single error card.
