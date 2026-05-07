---
"@maplibre-yaml/astro": minor
---

Add GeoJSON feature references for collection items

A new `feature_ref` field lets a collection item reference a feature in an external GeoJSON file (matched by `featureId` or `match: { property, equals }`) instead of inlining geometry coordinates in frontmatter. At build time, the loader reads the file, finds the matching feature, detects its geometry type, and dispatches to the existing point/polygon/route builders.

### New exports

- `FeatureRefSchema` -- Zod schema for the `feature_ref` field
- `FeatureRef` -- inferred type
- `getCollectionItemWithFeatureRefSchema(customFields?)` -- collection-helper factory enforcing mutual exclusivity of `feature_ref` with inline `location`/`region`/`route`
- `buildFeatureMapConfig(options, globalConfig?)` -- async convenience builder
- `loadFeatureFile(srcPath)` -- async file loader (lower-level primitive)
- `findFeature(fc, ref)` -- pure feature-lookup helper (lower-level primitive)
- `GeoJSONLoadError` -- error class with `filePath`, `errors`, and ES2022 `cause` support
- `clearFeatureCache()` -- test-isolation helper

### Features

- **mtime-aware cache**: editing the GeoJSON file in `astro dev` invalidates the cache on next page render, no server restart needed
- **Lazy per-property index**: built on second access for properties on files with 200+ features
- **Geometry dispatch**: `Point`, `MultiPoint`, `LineString`, `Polygon`, `MultiPolygon` supported. `MultiLineString` and `GeometryCollection` throw clear errors
- **Override precedence**: frontmatter `name`/`description`/styles win over `feature.properties`
- **Build-time only**: runtime guard throws an actionable error in deployed SSR adapter contexts
- **Forward-compatible**: schema does not lock down future compound match shapes (`all`/`any`/`in`); error class accepts ES2022 `cause`; cache and runtime guard are private and swappable for V2 runtime resolution

### Documentation

- New "GeoJSON Feature References" section in `packages/astro/README.md`
- New section in `docs/src/content/docs/integrations/astro.mdx` with quick start, match strategies, performance budget, and HMR caveats
