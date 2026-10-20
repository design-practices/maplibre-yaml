---
"@maplibre-yaml/core": minor
---

Popup numbers are now formatted with `Intl.NumberFormat` in the reader's language. A popup item's `format:` accepts MapLibre's `number-format` options — `locale`, `currency`, `unit`, `min-fraction-digits`, `max-fraction-digits` — e.g. `format: { currency: EUR, max-fraction-digits: 0 }`, so the vocabulary is the one authors already use for label `text-field`s. Without a `locale`, numbers follow the page's language (the nearest `lang`, on `<ml-map>` or `<html>`), then the browser's. The older d3-style string (`format: ",.0f"`) keeps working but now follows the page's language too instead of always using US English: on a `lang="de"` page it gives `8.336.817`. The formatter is exported as `formatNumber(value, options, defaultLocale)` for hosts and generated legend labels; the params panel's slider readout uses it as well.
