---
status: pending
priority: p2
issue_id: 025
tags: [code-review, architecture, performance]
dependencies: []
---

# Cache has no eviction policy or size cap

## Problem Statement

The module-level `fileCache` (`feature-ref-loader.ts:62`) has no eviction. In long-running `astro dev` sessions referencing many files, memory grows monotonically with no max-entry count, no LRU, no size accounting. For builds this is fine (process exits), but for dev mode it's a slow leak.

`clearFeatureCache()` is the only escape hatch — all-or-nothing.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:62` — Module-level Map with no bounds

Reviewer: architecture-strategist (P2), performance-oracle implicitly.

## Proposed Solutions

### Option A: Add internal `_evictFeatureCache(absPath: string)` for surgical eviction

Useful for tests; doesn't grow public surface.

- Pros: zero behavior change for V1; tests can clean up specific entries
- Cons: doesn't actually solve the unbounded growth concern
- Effort: Trivial
- Risk: Low

### Option B: LRU wrapper with configurable size

```typescript
const MAX_CACHE_ENTRIES = 50;
// ...
```

Drop oldest entry on insert when over limit.

- Pros: bounds memory
- Cons: in dev mode, could re-parse a file that was just evicted
- Effort: Small (or use a small dep)
- Risk: Low

### Option C: Defer to V2

Document the limitation; don't fix until consumers report it.

- Pros: zero work
- Cons: known leak
- Effort: Trivial
- Risk: Low for typical usage (1-3 GeoJSON files)

## Recommended Action

(Filled during triage — Option C for V1.x; Option B for V2)

## Acceptance Criteria

- [ ] If Option B: cache bounded by configurable limit
- [ ] If Option C: limitation documented in plan and README

## Resources

- Review by `compound-engineering:review:architecture-strategist`
