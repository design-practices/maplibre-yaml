---
"@maplibre-yaml/astro": minor
---

Add GeoJSON feature references for collection items

A new `feature_ref` field lets a collection item reference a feature in an external GeoJSON file (matched by `featureId` or `match: { property, equals }`) instead of inlining geometry coordinates in frontmatter. At build time, the loader reads the file, finds the matching feature, detects its geometry type, and dispatches to the existing point/polygon/route builders.

### New exports

- `FeatureRefSchema` -- Zod schema for the `feature_ref` field
- `FeatureRef` -- inferred type
- `assertValidFeatureRef(ref)` -- validates the `featureId` XOR `match` constraint at build time
- `getCollectionItemWithFeatureRefSchema(customFields?)` -- collection-helper factory enforcing mutual exclusivity of `feature_ref` with inline `location`/`region`/`route`
- `buildFeatureMapConfig(options, globalConfig?)` -- async convenience builder for a single feature ref
- `buildMapConfigFromEntry(data, globalConfig?, options?)` -- async helper that absorbs the per-page geometry-type dispatch chain (precedence: `feature_ref` > `region` > `route` > `locations` > `location` > `options.fallback`)
- `buildMultiPolygonMapConfig(options, globalConfig?)` -- builder for `MultiPolygon` geometry that renders ALL polygons (not just the first)
- `buildMultiLineStringMapConfig(options, globalConfig?)` -- builder for `MultiLineString` geometry that renders ALL segments
- `loadFeatureFile(srcPath)` -- async file loader (lower-level primitive)
- `findFeature(fc, ref)` -- pure feature-lookup helper (lower-level primitive)
- `GeoJSONLoadError` -- error class with `filePath`, `errors`, and ES2022 `cause` support
- `clearFeatureCache()` -- test-isolation helper

### Features

- **mtime-aware cache**: editing the GeoJSON file in `astro dev` invalidates the cache on next page render, no server restart needed
- **Lazy per-property index**: built on second access for properties on files with 200+ features
- **Full multi-geometry support**: all five geometry types (`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`) render fully via dedicated builders -- multi-types use `MultiPolygon`/`MultiLineString` GeoJSON Features so all rings/segments appear, not just the first
- **GeometryCollection support**: single-member collections dispatch to the inner geometry; multi-member collections throw a clear error directing users to split into separate features
- **Entry helper**: `buildMapConfigFromEntry(data, globalConfig?, options?)` collapses the per-page dispatch chain (`feature_ref` > `region` > `route` > `locations` > `location` > fallback) into a single async call
- **Override precedence**: frontmatter `name`/`description`/styles win over `feature.properties`. The entry helper's `options.label` and `options.description` fill in when geometry's own fields are unset.
- **Build-time only**: runtime guard throws an actionable error in deployed SSR adapter contexts
- **Forward-compatible**: schema does not lock down future compound match shapes (`all`/`any`/`in`); error class accepts ES2022 `cause`; cache and runtime guard are private and swappable for V2 runtime resolution

### Documentation

- New "GeoJSON Feature References" section in `packages/astro/README.md`
- New section in `docs/src/content/docs/integrations/astro.mdx` with quick start, match strategies, performance budget, and HMR caveats
- New guidance: when importing schemas in `src/content/config.ts`, use `@maplibre-yaml/astro/utils` rather than `@maplibre-yaml/astro`. The main entry re-exports Astro components which can't be loaded outside the component pipeline; the `/utils` subpath is safe in any Node context. All existing content-config examples in the README and docs site are updated to follow this convention.
