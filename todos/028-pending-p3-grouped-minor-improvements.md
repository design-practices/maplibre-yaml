---
status: pending
priority: p3
issue_id: 028
tags: [code-review, polish]
dependencies: []
---

# Grouped P3 minor improvements

A consolidated file for minor improvements surfaced during the multi-agent code review. Each can be addressed independently or batched.

## P3-A: GeometryCollection recursion has no max depth bound

`feature-ref-builder.ts:355-361` — recursive call for single-member collections. A maliciously nested `GeometryCollection { geometries: [GeometryCollection { geometries: [...] }] }` of arbitrary depth would recurse arbitrarily deep until it hits a leaf. Bounded by file size, but worth a `MAX_DEPTH = 8` constant + clear error.

**Fix:** add depth parameter, throw at MAX_DEPTH.

## P3-B: Coordinate range sanity checks missing

Neither schema nor builder validates `lng∈[-180,180]`, `lat∈[-90,90]`. Lat/lng swaps render in the wrong hemisphere silently. Cheap warn-once helper at build time would help.

**Fix:** in `dispatchByGeometry` Point case, warn once per build if coords are out of range.

## P3-C: `GeoJSONLoadError.errors[]` field unused

`feature-ref-loader.ts:234, 239` — every constructor call passes `[]` or omits it. Dead today.

**Fix:** drop until needed, OR populate from validation paths in V2.

## P3-D: `clearFeatureCache` should return number cleared

DX nit: returning `number` (entries cleared) makes test-isolation diagnostics easier.

**Fix:** change return type to `number`.

## P3-E: Missing JSDoc `@throws` annotations

- `assertValidFeatureRef` — throws but not declared
- `buildMultiPolygonMapConfig` and `buildMultiLineStringMapConfig` — throw on empty coords, undeclared

**Fix:** add `@throws` JSDoc tags.

## P3-F: `MultiRegionPolygon` / `MultiRouteLine` naming

Mixed style: `Multi*` prefix combines GeoJSON ("MultiPolygon") with library ("RegionPolygon"). Consider `MultiPolygonRegion` / `MultiLineStringRoute` for clarity.

**Fix:** rename. Caveat: breaking type rename. Consider for V2.

## P3-G: Underscore-prefix exports as the only "internal" mechanism

`_getCacheEntryDebug` and `_setInternalAllowRuntime` rely on `@internal` JSDoc + barrel exclusion. TypeScript doesn't enforce; future contributor could add them to `index.ts`. Consider moving to `feature-ref-loader.internal.ts` + `feature-ref-builder.internal.ts` files imported only by tests.

## P3-H: `feature_ref` snake_case undocumented

The only snake_case identifier in the public API. Reasonable choice (matches YAML frontmatter idioms) but undocumented.

**Fix:** add JSDoc `@remarks` on `FeatureRefSchema` explaining the snake_case choice.

## P3-I: `assertValidFeatureRef` naming unprecedented

`assert*` is unprecedented in this codebase (which prefers `parse*`/`validate*`). Either rename to `validateFeatureRef` (returns void, throws) or align with todo 010's solution.

## P3-J: `applyMutualExclusivityRefinement` over-generic

`feature-ref-schema.ts:277-298` — generic parameter `T extends z.ZodTypeAny` and `Record<string, unknown>` cast mean it compiles for any input. There's exactly one caller. Inline it or constrain.

## P3-K: ES2022 cause ceremony

`feature-ref-loader.ts:236-251` — hand-rolled property assignment with comment about polyfills. Unnecessary on Node 18+. Use `super(message, { cause: options?.cause })` directly.

## P3-L: `tests/fixtures/` directory establishment

`sample.geojson` is the first occupant. Worth a one-line CONTRIBUTING note: "Static fixtures go in tests/fixtures/."

## P3-M: `utils/index.ts` header doc not refreshed

Lines 5-44 enumerate older categories only; new feature-ref symbols are exported but not described in the docstring.

## P3-N: `loadGlobalMapConfig` ordering inconsistency in barrels

In `index.ts:120-143`, `loadGlobalMapConfig` sits between `buildMultiLineStringMapConfig` and the `MultiRegionPolygon` type block — visually awkward. In `utils/index.ts` it isn't exported at all. Fix grouping.

## P3-O: Test `it()` strings inconsistent voice

Some new tests use arrow-form labels (`"Point feature → buildPointMapConfig"`) instead of English sentences. Older suite uses third-person present indicative.

**Fix:** rewrite arrow labels to match house style.

## P3-P: Single-pass `flatMap` in MultiPolygon bounds

`map-builders.ts:755-757` — `flatMap(flatMap)` allocates intermediate arrays. For 1000-polygon × 100-vertex MultiPolygon, that's ~100k-element intermediate arrays. Single-pass min/max + sum would be 3-5× faster at scale. Below 1000 points: don't bother.

## Acceptance Criteria

Each sub-item can be checked off independently. Some (P3-F naming, P3-J inline) are V2 candidates; others (P3-D, P3-E, P3-H, P3-K, P3-M, P3-N, P3-O) are 5-minute fixes worth bundling into a polish PR.

## Resources

- All review agents (kieran-typescript, architecture-strategist, security-sentinel, performance-oracle, code-simplicity, pattern-recognition, data-integrity-guardian)
