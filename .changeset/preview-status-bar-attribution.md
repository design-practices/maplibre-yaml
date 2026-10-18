---
"@maplibre-yaml/cli": patch
---

`maplibre-yaml preview` no longer hides the map's attribution: the status bar at the bottom of the preview page now sits below the map (and below a story's map) instead of over it, so the MapLibre/basemap credits and any bottom controls stay visible on desktop and phones. `preview --help` also describes `--no-open` correctly ("Don't open the browser"); it used to read "Open browser automatically".
