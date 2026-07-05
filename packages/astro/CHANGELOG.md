# @maplibre-yaml/astro

## 0.3.0

### Minor Changes

- afe9a22: Track `@maplibre-yaml/core` 0.3: the peer dependency range is now an explicit `^0.2.0 || ^0.3.0` (previously `workspace:^`, which forced spurious major bumps in the release tooling and pinned consumers to a single core minor at publish time). The astro package uses core's runtime-inheritance fixes shipped in 0.3.0.

### Patch Changes

- d87a7c5: Global config inheritance now actually flows into built map configs.

  **Astro map builders respect `globalConfig.defaultZoom`.** All six builders (`buildPointMapConfig`, `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPolygonMapConfig`, `buildMultiLineStringMapConfig`) previously hardcoded a zoom fallback (`zoom ?? location.zoom ?? 12`, or a literal `10`/`12`) that fired _before_ `resolveMapConfig` could apply the global default — so setting `defaultZoom` in your global config had no effect on built maps. Zoom now resolves as: explicit option > `location.zoom` (point builder) > `globalConfig.defaultZoom` > builder default. Behavior without a global config is unchanged: the builders' built-in defaults (12 for point/polygon, 10 for bounds-fitted builders) still apply as the last resort, so no existing call site starts throwing. `defaultCenter` and `defaultMapStyle` inheritance continue to be handled by core's `resolveMapConfig`, with explicit values always winning.

  **Core `resolveMapConfig` no longer uses an unsafe `as MapConfig` cast.** The return value is now structurally verified by TypeScript via narrowed locals after the missing-fields guard, so if a new required field is ever added to `MapConfig`, the resolver fails to compile instead of silently passing invalid data. Runtime behavior (resolution precedence, `ConfigResolutionError` on missing `mapStyle`/`center`/`zoom`) is unchanged.

- f716577: README corrections: fix the core JavaScript API example to use `YAMLParser.parseMapBlock` and the real `MapRenderer` constructor signature (`container, config, layers, options, sources`), replace the fictional `interactions:`/HTML-string popup format with the actual `interactive.click.popup` tag-array DSL, and fix the astro README scrollytelling example to use flat chapter `center`/`zoom` (matching `ChapterSchema`) instead of a nested `location:` object. Source `url` examples now use absolute URLs, which is what the schema validates.

## 0.2.1

### Patch Changes

- Republish of 0.2.0. The 0.2.0 manifest on npm shipped with unresolved `workspace:^` references in `peerDependencies` and `devDependencies` because the prior release went out via `npm publish` (which doesn't rewrite the workspace protocol). Consumers running `npm install @maplibre-yaml/astro@0.2.0` hit `EUNSUPPORTEDPROTOCOL`. 0.2.1 fixes the manifest by republishing via `pnpm publish`, which rewrites `workspace:^` to a concrete version. No behavior change vs 0.2.0; 0.2.0 has been deprecated on npm.

## 0.2.0

### Minor Changes

- 91b7eb4: Add GeoJSON feature references for collection items

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
  - **Path traversal protection**: relative `feature_ref.source` paths that escape the project root via `..` are rejected before any filesystem I/O. Symlinks that live inside the project root but point OUTSIDE it are also rejected, with a post-realpath containment re-check that catches the bypass where a symlink-internal path passes the pre-realpath check but resolves outward. Absolute paths are now **rejected by default** -- pass `{ allowAbsolutePaths: true }` in `FeatureLoadOptions` for trusted callers (tests, monorepo data, controlled scripts). This secures the schema for UGC contexts where frontmatter values are not author-controlled.
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
  - **`FeatureLoadOptions` (new)**: exported from `@maplibre-yaml/astro` and `/utils`. Threaded through `loadFeatureFile`, `buildFeatureMapConfig`, and `buildMapConfigFromEntry`. Two fields:
    - `projectRoot?: string` — override the boundary used for relative-path resolution and containment checks. Defaults to `process.cwd()`. Use this in monorepos when the build runs from a different directory than the Astro project root. The root is canonicalized via `realpath` so macOS `/var` → `/private/var` and similar symlinked-workspace shapes are handled.
    - `allowAbsolutePaths?: boolean` — opt-in to accept absolute `source` values. Defaults to `false`. Trusted callers can opt in; do NOT enable when frontmatter comes from untrusted content.
  - **`InvalidFeatureRefError` discrimination preserved**: `buildFeatureMapConfig` no longer wraps the XOR-violation error in `GeoJSONLoadError`. Callers can now correctly check `err instanceof InvalidFeatureRefError`, matching the contract advertised on the class.
  - **Irrelevant style-override warnings**: when a `feature_ref` sets a style field that doesn't apply to the resolved geometry (e.g., `markerColor` on a Polygon, `fillColor` on a Point), `buildFeatureMapConfig` now emits a deduplicated `console.warn` so authors can fix the mistake. Silent ignore-and-drop behavior is gone.

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

## 0.1.3

### Patch Changes

- c24084a: Fix maplibre-gl v5 compatibility and peer dependency ranges

  ### Bug fixes
  - **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
  - **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
  - **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
  - **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

  These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.

- Updated dependencies [c24084a]
  - @maplibre-yaml/core@0.2.1

## 1.0.0

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.1

### Patch Changes

- Fix HTMLElement SSR crash by moving custom element registration from Astro frontmatter to client-side script tag. Add global config inheritance, map builder, and geographic collection schema documentation.

  ### Bug Fix
  - **Fix `ReferenceError: HTMLElement is not defined` during Astro SSR** — The `Map`, `FullPageMap`, and `Scrollytelling` components previously imported `@maplibre-yaml/core/register` in their frontmatter, which runs server-side where `HTMLElement` does not exist. Registration is now handled via a bundled `<script>` tag that only executes in the browser.

  ### Documentation
  - Added Global Configuration guide with `loadGlobalMapConfig` pattern
  - Added guide for adding geographic data (points, polygons, lines) to existing content collections using `LocationPointSchema`, `RegionPolygonSchema`, and `RouteLineSchema`
  - Added dynamic map-per-collection-item example with geometry type detection
  - Added troubleshooting entries for common Astro integration gotchas
  - Updated map builder examples to show `globalConfig` usage

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
