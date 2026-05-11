---
status: pending
priority: p2
issue_id: 021
tags: [code-review, simplicity, pattern]
dependencies: []
---

# Builder body duplication: Polygon vs MultiPolygon, Route vs MultiLineString

## Problem Statement

`buildPolygonMapConfig` (`map-builders.ts:439-524`) and `buildMultiPolygonMapConfig` (`map-builders.ts:717-840`) are ~80% identical: same defaults resolution, same popup-content construction, same `resolveMapConfig` call, same two-layer (`region-fill` + `region-outline`) shape, same paint blocks. Only meaningful differences: `geometry.type` literal, coordinate shape, and bounds-flatten depth.

Same story for `buildRouteMapConfig` (lines 553-663) vs `buildMultiLineStringMapConfig` (lines 858-995): identical popup logic, line-paint, `resolveMapConfig`. Only material difference: endpoint computation.

This is the single largest LOC-reduction opportunity in the diff.

## Findings

- `packages/astro/src/utils/map-builders.ts:439-524` — `buildPolygonMapConfig`
- `packages/astro/src/utils/map-builders.ts:553-663` — `buildRouteMapConfig`
- `packages/astro/src/utils/map-builders.ts:717-840` — `buildMultiPolygonMapConfig`
- `packages/astro/src/utils/map-builders.ts:858-995` — `buildMultiLineStringMapConfig`

Reviewers: pattern-recognition (P2), code-simplicity (P2 follow-up).

## Proposed Solutions

### Option A: Extract `makePolygonLikeMapConfig` and `makeLineLikeMapConfig` helpers

```typescript
function makePolygonLikeMapConfig(opts, geomType: "Polygon" | "MultiPolygon", coords, allCoords, globalConfig) { ... }
function makeLineLikeMapConfig(opts, geomType: "LineString" | "MultiLineString", coords, endpointFeatures, globalConfig) { ... }
```

Each takes the per-variant inputs and emits the shared `MapBlock` skeleton.

- Pros: cuts ~150 LOC; future paint additions are one-touch
- Cons: introduces an intermediate abstraction layer; need to be careful with type narrowing
- Effort: Medium (~1-2 hours)
- Risk: Low (no public API change)

### Option B: Defer; accept the duplication for V1.x

The duplication is ~150 LOC but visually maintainable today.

- Pros: zero risk
- Cons: drift compounds over time
- Effort: Trivial
- Risk: Low-Medium

## Recommended Action

(Filled during triage — Option B for V1.x; Option A as a follow-up PR after merge to keep diffs reviewable)

## Acceptance Criteria

- [ ] If Option A: 4 builders share their core logic via 2 helpers
- [ ] No public API change
- [ ] All existing tests still pass

## Resources

- Review by `compound-engineering:review:pattern-recognition-specialist`
- Review by `compound-engineering:review:code-simplicity-reviewer`
