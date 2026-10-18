---
"@maplibre-yaml/astro": patch
---

Maps keep working with Astro view transitions (`<ClientRouter />`). `FullPageMap`'s zoom and reset buttons used to work only on the first visit to a page and did nothing after a soft navigation back to it; they now work on every visit. Under `astro dev`, MapLibre's stylesheet was dropped after the first soft navigation (controls and attribution fell out of the map, popups were unstyled, and `<ml-map>` warned that the CSS was missing); `Map` and `FullPageMap` now load it as page CSS, so it survives navigation in dev as it already did in builds.
