---
status: pending
priority: p1
issue_id: 015
tags: [code-review, data-integrity, correctness]
dependencies: []
---

# 1-coordinate LineString produces invalid degenerate output

## Problem Statement

`buildRouteMapConfig` does not validate `route.coordinates.length >= 2`. The inline `RouteLineSchema` does enforce `.min(2)` (`collections-schemas.ts:105`), but `dispatchByGeometry` constructs the input from a parsed Feature without re-validating: a LineString feature with a single coordinate produces a degenerate line, and `route.coordinates[route.coordinates.length - 1]` returns the same point as `route.coordinates[0]` — start and end markers overlap silently. MapLibre will render a zero-length line.

Same issue for `buildMultiLineStringMapConfig`: per-segment endpoint computation guards `if (segment.length === 0) return [];` but not `=== 1`.

Reviewer: data-integrity-guardian (P2, escalating to P1 because it produces invalid GeoJSON output silently).

## Findings

- `packages/astro/src/utils/feature-ref-builder.ts:250-266` — `LineString` dispatch arm doesn't check coord count
- `packages/astro/src/utils/feature-ref-builder.ts:308-333` — `MultiLineString` dispatch arm doesn't check
- `packages/astro/src/utils/map-builders.ts:606-716` — `buildRouteMapConfig` no minimum coord check
- `packages/astro/src/utils/map-builders.ts:909-928` — endpoint builder guards `=== 0` but not `=== 1`

## Proposed Solutions

### Option A: Validate in `dispatchByGeometry` arms (recommended)

For LineString:
```typescript
case "LineString": {
  const line = geom as LineString;
  if (line.coordinates.length < 2) {
    throw new GeoJSONLoadError(
      `LineString feature in ${ref.source} has fewer than 2 coordinates and cannot render`,
      ref.source,
    );
  }
  // ... existing logic
}
```

For MultiLineString: validate that AT LEAST ONE segment has `>=2` coordinates, OR filter out 1-coord segments before passing to the builder, OR throw if any segment has `<2`.

- Pros: explicit failure with clear error; no silent degenerate output
- Cons: adds branching to dispatch; need to decide whether MultiLineString should throw or filter
- Effort: Small (~15 LOC)
- Risk: Low

### Option B: Validate inside the builders themselves

Add `if (route.coordinates.length < 2) throw` inside `buildRouteMapConfig`. Mirrors `RouteLineSchema.min(2)`.

- Pros: builders self-validate; consumers can call them safely with arbitrary input
- Cons: builders so far don't validate; this introduces a new convention
- Effort: Small
- Risk: Low

### Option C: Coerce (drop degenerate features) silently

Skip degenerate segments without erroring.

- Pros: tolerant
- Cons: silent data loss
- Effort: Small
- Risk: High — exactly the failure mode we want to fix

## Recommended Action

(Filled during triage — Option A is most consistent with existing dispatch failure modes)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-builder.ts`
- `packages/astro/src/utils/map-builders.ts` (for the endpoint builder edge case)

**Test additions:**
- Add a 1-coordinate LineString feature to `tests/fixtures/sample.geojson`
- Test that loading it throws `GeoJSONLoadError` with a message naming the issue
- Add a MultiLineString with one segment having 1 coord and verify behavior

## Acceptance Criteria

- [ ] `dispatchByGeometry` rejects 1-coord LineString features with a clear error
- [ ] MultiLineString segments with `<2` coordinates are explicitly handled (filter or throw — design decision)
- [ ] Tests cover both cases

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:data-integrity-guardian`
- Existing schema constraint: `RouteLineSchema.min(2)` at `collections-schemas.ts:105`
