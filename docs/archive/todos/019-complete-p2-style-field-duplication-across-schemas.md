---
status: pending
priority: p2
issue_id: 019
tags: [code-review, pattern, simplicity, architecture]
dependencies: []
---

# Style fields duplicated across 6 schema/interface sites

## Problem Statement

The same six style fields (`markerColor`, `fillColor`, `strokeColor`, `fillOpacity`, `color`, `width`) are declared independently in 6 places. Adding `lineDashArray` would require 6 coordinated edits with no compile-time link to enforce them.

Sites:
- `LocationPointSchema` — `collections-schemas.ts:58-64`
- `RegionPolygonSchema` — `collections-schemas.ts:77-91`
- `RouteLineSchema` — `collections-schemas.ts:102-111`
- `MultiRegionPolygon` interface — `map-builders.ts:133-141`
- `MultiRouteLine` interface — `map-builders.ts:160-167`
- `FeatureRefSchema` overrides — `feature-ref-schema.ts:121-147`

Reviewers: pattern-recognition (P2), code-simplicity (P2 — defer), architecture (related to forward-compat constraint #5).

## Proposed Solutions

### Option A: Extract Zod fragments + TS types (recommended for V2, defer for V1)

```typescript
// collections-schemas.ts
export const pointStyleSchema = z.object({ markerColor: z.string().optional() });
export const polygonStyleSchema = z.object({ fillColor: z.string().optional(), strokeColor: z.string().optional(), fillOpacity: z.number().min(0).max(1).optional() });
export const lineStyleSchema = z.object({ color: z.string().optional(), width: z.number().positive().optional() });

// Then merge:
export const LocationPointSchema = z.object({ coordinates: ..., name: ..., description: ..., zoom: ... }).merge(pointStyleSchema);
```

Multi-* interfaces extend the inferred TS types: `interface MultiRegionPolygon extends PolygonStyle { coordinates: ... }`.

- Pros: single source of truth; new style fields are one-touch additions
- Cons: refactor touches all 6 sites; tests need verification
- Effort: Medium
- Risk: Medium (subtle Zod type inference quirks possible)

### Option B: Document the constraint, defer to V2

Add a header comment listing the 6 sites that must stay in sync.

- Pros: zero immediate work
- Cons: drift risk grows with each new style field
- Effort: Trivial
- Risk: Medium (drift)

## Recommended Action

(Filled during triage — Option B for V1.x, Option A for V2)

## Acceptance Criteria

- [ ] If Option A: adding a new style field requires only one edit
- [ ] If Option B: comment in each affected file lists all 6 sites
- [ ] Existing schemas continue to validate identical inputs

## Resources

- Review by `compound-engineering:review:pattern-recognition-specialist`
- Review by `compound-engineering:review:code-simplicity-reviewer`
