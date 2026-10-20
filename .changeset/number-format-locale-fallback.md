---
"@maplibre-yaml/core": patch
---

Number formatting no longer drops to raw digits when a language tag is written with an underscore or isn't usable. A page `lang="en_US"` (or a format's `locale: de_DE`) is read as `en-US` / `de-DE`, so `format: ",.0f"` shows `8,336,817` again, as in 0.8.1, instead of `8336816.62`. When a locale or option is still rejected, `formatNumber` falls back in steps: the same options in the default locale, then in the browser's, then grouping and decimals alone. The bare number is shown only when none of those work.
