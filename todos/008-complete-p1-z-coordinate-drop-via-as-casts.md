---
status: pending
priority: p1
issue_id: 008
tags: [code-review, typescript, data-integrity, correctness]
dependencies: []
---

# `as [number, number]` casts silently drop GeoJSON Z (altitude) coordinates

## Problem Statement

GeoJSON's `Position` type is `number[]` — formally `[longitude, latitude]` OR `[longitude, latitude, altitude]` (RFC 7946 §3.1.1). `dispatchByGeometry` uses `coord as [number, number]` casts in 6+ sites that lie to TypeScript: if the source GeoJSON has 3D coordinates, the runtime value retains the third element while the type system pretends it's a 2-tuple.

This is both a TypeScript soundness issue (kieran review P1) AND a data-integrity concern (data-integrity review P2):

- **MapLibre tolerates it** — its GeoJSON source ignores Z values, so today this doesn't visibly break anything.
- **But** any future code that asserts `coords.length === 2`, serializes positions, or compares structurally will break unexpectedly when consumers feed in 3D source data.

## Findings

Locations of unsound casts in `packages/astro/src/utils/feature-ref-builder.ts`:

- Line 224: `coordinates: point.coordinates as [number, number]` (Point case)
- Lines 240-241: `(mp.coordinates as Position[]).map((coord) => ({ coordinates: coord as [number, number], ... }))` (MultiPoint)
- Lines 256-258: `(line.coordinates as Position[]).map((c) => c as [number, number])` (LineString)
- Lines 272-274: `(polygon.coordinates as Position[][]).map((ring) => ring.map((c) => c as [number, number]))` (Polygon)
- Lines 297-300: same pattern (MultiPolygon)
- Line 322: same pattern (MultiLineString)

Plus the `geom as Point` / `geom as MultiPoint` / etc. switch-arm casts (lines 222, 235, 251, 268, 286, 311, 339) defeat exhaustiveness checking — TypeScript would already narrow `geom` inside each case branch.

Reviewers: kieran-typescript (P1), data-integrity-guardian (P2).

## Proposed Solutions

### Option A: Replace casts with `coord.slice(0, 2) as [number, number]` (recommended)

Restores the 2D invariant the type claims by actually projecting 3D positions to 2D.

- Pros: explicit and honest; removes the lie; cheap (small array allocation)
- Cons: per-coordinate `slice` allocation on large geometries (mitigatable with a top-of-file helper)
- Effort: Small
- Risk: Low

### Option B: Accept Z-coords throughout, change types to `Position`

Update `LocationPoint.coordinates`, `RegionPolygon.coordinates`, `RouteLine.coordinates` to `Position` instead of `[number, number]`. Plumb through.

- Pros: most honest — preserves whatever the user supplied
- Cons: schema change ripples through many files; existing schema uses `z.tuple([z.number(), z.number()])`
- Effort: Large
- Risk: Medium

### Option C: Add a `to2D(p: Position): [number, number]` helper used by every dispatch arm

```typescript
function to2D(p: Position): [number, number] {
  return [p[0]!, p[1]!];
}
```

Then drop the `geom as X` switch casts and let TypeScript narrow naturally. End the switch with `default: { const _exhaustive: never = geom; throw ... }` for exhaustiveness.

- Pros: cleanest TypeScript; explicit narrowing; exhaustiveness guard
- Cons: same allocation profile as A
- Effort: Small
- Risk: Low

## Recommended Action

(Filled during triage — likely Option C; combines kieran's exhaustiveness suggestion with data-integrity's slicing fix)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-builder.ts` (6+ cast sites)

## Acceptance Criteria

- [ ] No `as [number, number]` casts on Position values in `dispatchByGeometry`
- [ ] No `geom as Point` / `geom as MultiPoint` etc. casts (TypeScript narrows inside the case arms)
- [ ] Switch ends with an exhaustiveness check (`const _exhaustive: never = geom`)
- [ ] Test added with a 3D-coord GeoJSON feature that verifies the output coordinates are 2-tuples

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
- Review by `compound-engineering:review:data-integrity-guardian`
- RFC 7946 §3.1.1: GeoJSON Position
