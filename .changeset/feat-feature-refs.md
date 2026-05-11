---
"@maplibre-yaml/astro": minor
---

Add GeoJSON feature references for collection items

A new `feature_ref` field lets a collection item reference a feature in an external GeoJSON file (matched by `featureId` or `match: { property, equals }`) instead of inlining geometry coordinates in frontmatter. At build time, the loader reads the file, finds the matching feature, detects its geometry type, and dispatches to the existing point/polygon/route builders.

### New exports

- `FeatureRefSchema` -- Zod schema for the `feature_ref` field
- `FeatureRef` -- inferred type
- `assertValidFeatureRef(ref)` -- validates the `featureId` XOR `match` constraint at build time
- `InvalidFeatureRefError` -- error class thrown by `assertValidFeatureRef`; discriminable via `instanceof`
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
- **Build-time only**: when invoked outside a build context (e.g., a deployed serverless adapter), `loadFeatureFile`'s ENOENT path detects common serverless cwd patterns and includes deployment-context hints in the error message
- **Forward-compatible**: schema does not lock down future compound match shapes (`all`/`any`/`in`); error class accepts ES2022 `cause`; cache is private and swappable for V2 runtime resolution

### Hardening (post code-review)

After a multi-agent code review surfaced 9 P1 issues, the following hardening landed before merge:

- **Path traversal protection**: relative `feature_ref.source` paths that escape the project root via `..` are rejected before any filesystem I/O. Symlinks that live inside the project root but point OUTSIDE it are also rejected, with a post-realpath containment re-check that catches the bypass where a symlink-internal path passes the pre-realpath check but resolves outward. Absolute paths are still allowed (deliberate user intent — tests, monorepos).
- **File-size cap**: files exceeding 100MB throw a clear error before `readFile`; files between 50MB and 100MB log a warning. Prevents OOM on memory-constrained CI runners.
- **Symlink canonicalization**: cache key uses `realpath` so symlinks pointing at the same file share a single cache entry and the lazy property index works correctly across them.
- **Concurrent-load dedupe**: parallel `loadFeatureFile` calls for the same file share an in-flight Promise, preventing double-parse of large files under parallel page builds.
- **Cache-mutation safety**: `dispatchByGeometry` uses a `to2D` helper that allocates fresh tuples, so downstream mutation of returned `MapBlock` coordinates cannot poison the cached `FeatureCollection`.
- **Z-coordinate handling**: GeoJSON 3D positions (`[lng, lat, altitude]`) are explicitly projected to 2D via `to2D` instead of unsound `as [number, number]` casts. Switch statement now ends with an exhaustiveness check that catches new geometry types at compile time.
- **Degenerate-line validation**: `LineString` features with fewer than 2 coordinates and `MultiLineString` features with degenerate segments throw clear errors instead of producing invalid output.
- **Error class for assertion**: `assertValidFeatureRef` now throws `InvalidFeatureRefError` (discriminable subclass) instead of plain `Error`.
- **Removed**: vestigial `INTERNAL_ALLOW_RUNTIME` mutable module-level flag and the `_setInternalAllowRuntime` setter (V2 runtime resolution should ship as a separate builder, not via global mode switch).
- **Removed**: vestigial `padding` field from `MultiLineStringMapOptions` (declared but never consumed).

### Internal cleanup (post code-review, P2 batch)

Lower-priority code-review findings that landed in the same PR:

- **YAMLLoadError parity**: `YAMLLoadError` now accepts an ES2022 `cause` field for parity with `GeoJSONLoadError`. Both classes still satisfy the same forward-compat constraint (#4): a shared base class can be introduced later without breaking the `cause` contract. All `YAMLLoadError` throw sites in `loader.ts` now thread `{ cause: error }` so the original parse/IO error is preserved as `.cause`.
- **Stable cache debug interface**: `_getCacheEntryDebug` now returns a `CacheDebugSnapshot` (with `mtimeMs`, `indexedPropertyCount`, `hasIndexForProperty()`, `indexSizeFor()`, `accessCountFor()`) instead of the raw `CacheEntry`. Tests no longer assert on internal Map shapes -- swapping the cache storage in V2 stays internal.
- **Schema XOR vs builder precedence**: documented that `getCollectionItemWithFeatureRefSchema`'s strict XOR check and `buildMapConfigFromEntry`'s precedence chain are intentionally different. Schema-strict is for opt-in authors who want early errors in `astro dev`; the precedence chain serves callers using the basic `getCollectionItemSchema` or rolling their own.
- **Style-field dedupe**: introduced `PointStyleFields`, `PolygonStyleFields`, `LineStyleFields` in `collections-schemas.ts` as single source of truth. `LocationPointSchema`, `RegionPolygonSchema`, `RouteLineSchema`, and `FeatureRefSchema` all spread these now -- adding a new style field (e.g., `lineDashArray`) is a one-place edit. The `MultiRegionPolygon` and `MultiRouteLine` TS interfaces extend `Omit<RegionPolygon | RouteLine, "coordinates">` so they pick up new style fields automatically.
- **Builder body dedupe**: extracted `buildPopupContent`, `buildPolygonLayers`, and `buildRouteLayers` as internal helpers. `buildPolygonMapConfig` + `buildMultiPolygonMapConfig` and `buildRouteMapConfig` + `buildMultiLineStringMapConfig` now share their layer construction (-~250 LOC). Public function signatures, output shape, and `MapBlock` `layers[]` structure are unchanged -- existing snapshot tests pass.

### Deferred (tracked as pending todos)

- **P2-024**: `as`-casts in test files indicate weak public layer types. Fixing requires a typed-test-helper module and a substantial test rewrite (~20 sites). Tracked for a follow-up PR.
- **P2-025**: The module-level `fileCache` has no eviction policy. Bounded growth is fine for build (process exits) but accumulates in `astro dev` sessions referencing many distinct files. `clearFeatureCache()` is the existing escape hatch. LRU/size-cap implementation tracked for a follow-up PR if growth becomes observable in practice.
- **P2-026**: Large MultiPolygon/MultiLineString MapBlocks serialize into the `<ml-map>` HTML attribute; the right place to warn is the rendering component, not the builder utilities. Tracked for a follow-up PR alongside any other component-side telemetry.
- **P3-028**: Grouped minor polish items (typos, JSDoc nits, etc.). Tracked for a follow-up PR.

### Documentation

- New "GeoJSON Feature References" section in `packages/astro/README.md`
- New section in `docs/src/content/docs/integrations/astro.mdx` with quick start, match strategies, performance budget, and HMR caveats
- New guidance: when importing schemas in `src/content/config.ts`, use `@maplibre-yaml/astro/utils` rather than `@maplibre-yaml/astro`. The main entry re-exports Astro components which can't be loaded outside the component pipeline; the `/utils` subpath is safe in any Node context. All existing content-config examples in the README and docs site are updated to follow this convention.
