---
"@maplibre-yaml/astro": patch
---

`getCollectionItemWithLocationSchema()` and the other `getCollectionItemWith*Schema()` helpers (`Locations`, `Region`, `Route`, `Geo`, `FeatureRef`) now give `entry.data` real types on Astro 6 and 7. On zod 4 every field was typed `unknown`, so the collections guide's Quick Start failed `astro check` (`Type 'unknown' is not assignable to type 'string'`); on Astro 4 and 5 the fields passed as `customFields` were missing from the type. Runtime validation is unchanged.
