---
"@maplibre-yaml/core": patch
---

A story's map height set in a site stylesheet now takes effect in Astro. `<Scrollytelling>` loads core's `scrollytelling.css` after the site's own CSS, and its default `ml-scrollytelling { --ml-scrolly-map-height: 100vh }` won on source order, so the documented override (`ml-scrollytelling { --ml-scrolly-map-height: calc(100vh - 64px) }`, for a page under a fixed header) did nothing. The default is now declared at zero specificity (`:where(ml-scrollytelling)`), so any author rule on the element wins whichever stylesheet loads last. Stories that don't set it look exactly as before.
