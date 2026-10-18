---
"@maplibre-yaml/core": patch
---

Source URLs and scrollytelling chapter `image`/`video` now accept bare relative paths such as `data/cities.geojson` or `cities.geojson`. Before, validation rejected them and required `./` or `/` in front, even though the browser loads them the same way. Relative paths resolve against the page, not the YAML file, and this is now documented. When a data file doesn't load, the on-map notice shows the full URL the browser tried. If the YAML came from another folder, the notice also gives the path to write instead. Non-path schemes stay as they were: chapter media still rejects `javascript:` and `data:`.
