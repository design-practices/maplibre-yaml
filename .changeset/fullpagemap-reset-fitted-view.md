---
"@maplibre-yaml/astro": patch
---

`FullPageMap`'s "Reset view" button now returns to the view the map opened with. When the document uses `fitTo` on a fetched source, the map is framed on the data once it loads. Reset used to go back to the YAML's own `center`/`zoom` instead, a different view from the one the page showed. It now resets to the fitted framing.
