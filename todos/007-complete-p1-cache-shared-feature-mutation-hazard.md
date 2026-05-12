---
status: pending
priority: p1
issue_id: 007
tags: [code-review, data-integrity, correctness]
dependencies: []
---

# Cache returns shared Feature references; downstream mutation poisons cache

## Problem Statement

`findFeature` returns the literal `Feature` instance from the cached `FeatureCollection`. `dispatchByGeometry` then constructs a `MapBlock` whose `source.data` embeds raw references to `geom.coordinates` (e.g., for MultiPolygon: `coordinates: region.coordinates`). The new `buildMultiPolygonMapConfig` and `buildMultiLineStringMapConfig` likewise reuse the input arrays.

If any consumer or test post-processes the returned MapBlock and mutates coordinates in place (e.g., rounding for snapshot tests, inserting elevation data), the cached entry is silently corrupted. Subsequent cache hits return mutated data.

## Findings

- `packages/astro/src/utils/feature-ref-builder.ts:355-361` — `GeometryCollection` recursion creates a synthetic `innerFeature` reusing `feature.properties` by reference
- `packages/astro/src/utils/map-builders.ts:799-812` — MultiPolygon builder embeds `region.coordinates` directly into `source.data.features[0].geometry.coordinates`
- `packages/astro/src/utils/map-builders.ts:962-988` — MultiLineString builder same pattern
- `packages/astro/src/utils/feature-ref-loader.ts:316` — `findFeature` returns `matches[0]` literal

Reviewer: data-integrity-guardian (originally tagged P1, downgraded to P2 by author; promoting back to P1 because the mutation surface includes any downstream pipeline step).

## Proposed Solutions

### Option A: structuredClone coordinates in dispatchByGeometry (recommended)

Add `structuredClone` calls in each `dispatchByGeometry` switch arm before passing coordinates to builders.

- Pros: minimal change, isolates clone cost to the build-time path that actually populates the cache
- Cons: adds clone overhead per dispatch (~ms for typical features, ~10ms+ for huge MultiPolygons)
- Effort: Small (~10 LOC across 6 switch arms)
- Risk: Low

### Option B: Object.freeze on cached Features

Freeze the parsed FeatureCollection deeply after `JSON.parse`. Throws on mutation attempts in strict mode.

- Pros: catches the bug at the mutation site, no cloning cost
- Cons: deep freeze of large GeoJSON is expensive; non-strict-mode mutations still silently fail
- Effort: Small
- Risk: Medium — could break consumers who legitimately mutate (uncommon but possible)

### Option C: Document as "do not mutate" contract, no code change

- Pros: zero overhead
- Cons: contract is invisible; future contributors will hit the bug
- Effort: None
- Risk: High

## Recommended Action

(Filled during triage)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-builder.ts`
- `packages/astro/src/utils/map-builders.ts` (the two new multi-builders)

## Acceptance Criteria

- [ ] Mutating a returned MapBlock's `source.data.features[0].geometry.coordinates` does not affect a subsequent `loadFeatureFile`/`findFeature` call against the same path
- [ ] Test added that exercises this scenario explicitly

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:data-integrity-guardian`
- File: [feature-ref-builder.ts:355](packages/astro/src/utils/feature-ref-builder.ts#L355)
