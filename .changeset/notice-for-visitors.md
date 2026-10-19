---
"@maplibre-yaml/core": patch
---

The on-map notice now reads well to a site's visitors as well as its author. It leads with one plain line, "Part of this map couldn't load". The fix (file paths, folders, did-you-mean) sits in a "Details for the site's author" section below it, so it no longer fills the map on a published page. That section starts open while the page is served from your own computer (`localhost`, `127.0.0.1` or a `file://` page) and closed on a published site, where a click opens it. The notice stays dismissible, and `quiet` still keeps it, and the zero-height hint, off the page.
