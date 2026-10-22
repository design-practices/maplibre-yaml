---
status: pending
priority: p2
issue_id: 022
tags: [code-review, architecture, correctness]
dependencies: []
---

# MultiPoint override semantics differ between dispatch paths

## Problem Statement

`dispatchByGeometry`'s MultiPoint branch (`feature-ref-builder.ts:234-249`) splats `name`/`description`/`markerColor` onto **every** point — every marker gets the same popup.

`buildMapConfigFromEntry`'s `locations` branch (`entry-builder.ts:171-182`) preserves per-location overrides correctly: `loc.name ?? label` per location, so each marker can have its own name with the page label as fallback.

The divergence is intentional (a feature_ref has one ref-level override that applies to the whole feature, while inline `locations` is an array where each element is its own thing) but it's not documented anywhere, and a maintainer reading the two paths in isolation will assume they should match.

## Findings

- `packages/astro/src/utils/feature-ref-builder.ts:234-249` — MultiPoint dispatch arm
- `packages/astro/src/utils/entry-builder.ts:171-182` — `locations` branch in entry helper

Reviewer: architecture-strategist (P2).

## Proposed Solutions

### Option A: Add a code comment explaining the divergence (recommended)

```typescript
// Intentional divergence from buildMapConfigFromEntry's `locations` branch:
// a feature_ref has one ref-level override that applies to the whole MultiPoint
// feature (one popup per feature is the GeoJSON convention), while inline
// `locations` lets each point carry its own name/description.
```

- Pros: documents the design choice; future maintainers won't "fix" the inconsistency
- Cons: just a comment, no behavioral change
- Effort: Trivial
- Risk: Low

### Option B: Unify semantics

Either make MultiPoint dispatch produce per-point distinct popups (read from `feature.properties` array if present? GeoJSON doesn't have per-point properties on MultiPoint), OR make `locations` use one shared popup.

- Pros: removes the divergence
- Cons: GeoJSON MultiPoint geometry doesn't have per-point properties — so this is a one-popup story by spec; unifying means changing `locations` semantics
- Effort: Small-Medium
- Risk: Medium (behavior change)

## Recommended Action

(Filled during triage — Option A; the divergence reflects real GeoJSON spec semantics)

## Acceptance Criteria

- [ ] Comment in dispatchByGeometry's MultiPoint case explains the design choice
- [ ] Optionally: comment in entry-builder's `locations` branch cross-references

## Resources

- Review by `compound-engineering:review:architecture-strategist`
