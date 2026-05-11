---
status: pending
priority: p3
issue_id: 034
tags: [code-review, polish, simplicity, docs]
dependencies: []
---

# Grouped P3 followups from second code review

## Problem Statement

Collected polish items from the second multi-agent review (5 reviewers: kieran-typescript, security-sentinel, performance-oracle, architecture-strategist, code-simplicity). None block merge. Bundled here so a single follow-up PR can address them all.

## Findings

### TypeScript / interfaces

- **34-A**: `to2D` JSDoc overstates "downstream mutation cannot poison the file cache" — the guarantee is only as strong as the chain of `.map` calls in every dispatch case. Trim the JSDoc to the immediate guarantee: "projects 3D positions to 2D and breaks aliasing with the source array."
  - File: `packages/astro/src/utils/feature-ref-builder.ts:153-167`

- **34-B**: `CacheDebugSnapshot.mtimeMs` is exposed but no test reads it. Remove unless a future test needs it.
  - File: `packages/astro/src/utils/feature-ref-loader.ts:100,134`

- **34-C**: `CacheDebugSnapshot.indexSizeFor` returns `number | undefined` — `undefined` doubles as "no index built." If V2 eagerly builds all indexes, this returns 0/N and tests using `.toBeUndefined()` fail. Either add a JSDoc note locking this in as part of the snapshot contract, or rename to `indexedValueCountFor(p): number` (returns 0 for unindexed) and let `hasIndexForProperty` cover the existence question.
  - File: `packages/astro/src/utils/feature-ref-loader.ts:110,138-140`

- **34-D**: `buildPolygonLayers` and `buildRouteLayers` tagged-union geometry param is not actually branched on inside the helper — `features[0].geometry = geometry` is the only use. Replace with `Feature["geometry"]` from `geojson` or a simpler structural type.
  - Files: `packages/astro/src/utils/map-builders.ts:290-300, 363-372`

- **34-E**: `endpointFeatures` inline shape diverges from the `geojson` library's `Feature<Point>` type. Use `Feature<Point, { type: string }>[]`.
  - File: `packages/astro/src/utils/map-builders.ts:363-372`

- **34-F**: `applyMutualExclusivityRefinement` uses `Record<string, unknown>` and string-checks four field names ("location", "locations", "region", "route"). If a future schema renames a field, the drift is silent. Move the field list to a single `const` shared with `EntryGeometryFields` in `entry-builder.ts:44-50` so both stay in sync.
  - Files: `packages/astro/src/utils/feature-ref-schema.ts:288-309`, `packages/astro/src/utils/entry-builder.ts:44-50`

### Layering / architecture

- **34-G**: `_getCacheEntryDebug` is `@internal` but still exported from `feature-ref-loader.ts`. Subpath imports could reach it from outside the package. Move to a separate `feature-ref-loader.internal.ts` or guard at runtime (`if (!process.env.VITEST) throw`).
  - File: `packages/astro/src/utils/feature-ref-loader.ts:124-145`

- **34-H**: `matchByProperty` does a linear scan of `fileCache.values()` looking for the entry whose `fc` reference matches. Functionally correct but a layering hack — `findFeature` should be pure. Refactor: `loadFeatureFile` returns `{ fc, indexLookup }` where `indexLookup` is a closure bound to the entry; `findFeature` takes the closure instead of reaching back into module-private cache state. Would also let synthetic FCs (passed to `findFeature` directly without going through the cache) work consistently.
  - File: `packages/astro/src/utils/feature-ref-loader.ts:540-580`

- **34-I**: Serverless detection at the ENOENT path uses brand-name string matching against cwd patterns (`/var/task`, `/opt/render`, etc.). Cloudflare Workers, Deno Deploy, Bun deploy won't match. Invert: when ENOENT happens and the resolved path is NOT inside cwd, that's the actionable signal regardless of platform.
  - File: `packages/astro/src/utils/feature-ref-loader.ts` (deploymentHint function — exact lines vary)

### Code simplicity

- **34-J**: `resolveSourcePath` calls `resolve(projectRoot, srcPath)` twice. Dedupe by moving `resolved` outside the `if`.
  - File: `packages/astro/src/utils/feature-ref-loader.ts:184-198`

- **34-K**: `buildMultiPolygonMapConfig` uses `region.coordinates.flatMap(p => p.flatMap(r => r))` — that's `region.coordinates.flat(2)`. Saves a line, more readable.
  - File: `packages/astro/src/utils/map-builders.ts:806-808`

- **34-L**: `buildMultiLineStringMapConfig` has an empty-segment guard `if (segment.length === 0) return []` that may be dead code if upstream schema (`MultiLineString` validation in dispatch) already rejects empty segments. Verify before removing.
  - File: `packages/astro/src/utils/map-builders.ts:891`

### Documentation / hygiene

- **34-M**: Add a load-bearing comment above `PointStyleFields`, `PolygonStyleFields`, `LineStyleFields`: "All fields MUST be `.optional()` — these are spread into multiple schemas where required-ness has different semantics."
  - File: `packages/astro/src/utils/collections-schemas.ts:62-90`

- **34-N**: Document in README/JSDoc that `GeoJSONLoadError` / `YAMLLoadError` `.cause` chains may include filesystem paths and parser internals; warn against echoing them in production HTTP responses.
  - Files: `packages/astro/src/utils/loader.ts:60-80`, `packages/astro/src/utils/feature-ref-loader.ts:425-445`

- **34-O**: Add a TODO/comment at `matchByProperty` noting "swap to `WeakMap<FeatureCollection, CacheEntry>` sidetable if cache grows past ~20 files."
  - File: `packages/astro/src/utils/feature-ref-loader.ts:540-552`

### Optional perf signal

- **34-P**: Add a vitest `bench` for MultiPolygon with 100k+ vertices to lock in the `to2D` allocation baseline. Trips CI if a future change regresses by 10x.
  - Files: new file `packages/astro/tests/utils/feature-ref-builder.bench.ts`

## Recommended Action

Take in a single follow-up PR after the V1 PR merges. Most items are 1-5 line changes. Items 34-G, 34-H, 34-I are slightly larger but still bounded.

## Acceptance Criteria

Each sub-item closed individually; PR includes test updates and docs where applicable.

## Work Log

- 2026-05-11: Created from second multi-agent code review (kieran-typescript, security-sentinel, performance-oracle, architecture-strategist, code-simplicity)
