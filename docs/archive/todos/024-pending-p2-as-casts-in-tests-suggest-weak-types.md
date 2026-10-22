---
status: pending
priority: p2
issue_id: 024
tags: [code-review, typescript, testing]
dependencies: []
---

# `as`-casts in tests indicate weak public types

## Problem Statement

Test files use patterns like:
```typescript
const layer = config.layers[0] as { source: { data: { features: unknown[] } } };
```

This pattern appears ~20 times across `feature-ref-builder.test.ts` and `entry-builder.test.ts`. That's a signal that `MapBlock`/`Layer` types from `@maplibre-yaml/core` are too loose for tests to drill into, OR that there's no shared test util for typed layer assertions.

## Findings

- `packages/astro/tests/utils/feature-ref-builder.test.ts` — many sites (e.g., 57-59, 98-100, 117-122)
- `packages/astro/tests/utils/entry-builder.test.ts` — same pattern

Reviewer: kieran-typescript (P2).

## Proposed Solutions

### Option A: Add test util helpers

```typescript
// tests/utils/test-helpers.ts
export function getLayerSource(config: MapBlock, index = 0): { type: "geojson", data: FeatureCollection } { ... }
export function getLayerPaint(config: MapBlock, index = 0): Record<string, unknown> { ... }
```

Tests use these instead of inline casts.

- Pros: removes duplication; catches real regressions when paint-property keys change
- Cons: adds a tiny test-utils module
- Effort: Small
- Risk: Low

### Option B: Tighten core's MapBlock/Layer types

If the casts are needed because `Layer.source` is typed as `unknown` or similar, fix the type.

- Pros: best long-term
- Cons: could ripple through @maplibre-yaml/core
- Effort: Medium-Large
- Risk: Medium

### Option C: Defer

Tests work; just stylistically loose.

## Recommended Action

(Filled during triage — Option A as a follow-up; Option B as V2)

## Acceptance Criteria

- [ ] Test layer/source/paint access goes through typed helpers
- [ ] Casts in tests reduced significantly

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
