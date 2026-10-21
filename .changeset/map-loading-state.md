---
"@maplibre-yaml/core": minor
---

A slow map now says it is loading. While `<ml-map>` starts it carries `aria-busy="true"`, and if the map hasn't drawn after about a second a small, muted "Loading map…" appears in its middle (`role="status"`); both go away as soon as the basemap draws, or when an error card replaces the map. A fast map never shows it. It applies to story maps too, and `quiet` doesn't hide it, since it isn't a notice; a page with its own loading UI hides it with `ml-map .ml-map-loading { display: none; }`. The text is translatable as `maplibre-yaml.Loading` in `locale:`. The "Accessibility & languages" guide also shows an `ml-map:not(:defined)` rule for the moment before the script has loaded.
