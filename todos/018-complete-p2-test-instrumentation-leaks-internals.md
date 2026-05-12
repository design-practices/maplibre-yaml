---
status: pending
priority: p2
issue_id: 018
tags: [code-review, typescript, architecture, testing]
dependencies: []
---

# `_getCacheEntryDebug` leaks structural details to tests

## Problem Statement

`_getCacheEntryDebug` (`feature-ref-loader.ts:71-73`) hands the test suite the entire `CacheEntry` interface (`mtimeMs`, `indexByProperty`, `propertyAccessCount`). Tests then assert on internal field names (e.g., `indexByProperty.size`, `propertyAccessCount.get("gotf_id")`). These tests will break the day the cache implementation is swapped — defeating the documented "module-private cache, swap stays internal" forward-compat constraint.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:71-73` — `_getCacheEntryDebug` exports the full CacheEntry shape
- `packages/astro/tests/utils/feature-ref-loader.test.ts:495-567` — tests assert on internal field names

Reviewers: kieran-typescript (P2), architecture-strategist (P3).

## Proposed Solutions

### Option A: Replace with narrow observer interface (recommended)

```typescript
export interface CacheStats {
  hasIndexFor(property: string): boolean;
  accessCountFor(property: string): number;
}

/** @internal */
export function _getCacheStats(absPath: string): CacheStats | undefined { ... }
```

Tests assert behavior, not field shape. Cache implementation can change freely.

- Pros: clean contract; future-proofs the cache structure
- Cons: requires updating ~10 test assertions
- Effort: Small
- Risk: Low

### Option B: Move debug API to a separate `feature-ref-loader.test-utils.ts`

Tests import from the test-utils file directly; production code never imports it.

- Pros: clearer separation
- Cons: TypeScript can't enforce "test-only"; convention-only
- Effort: Small
- Risk: Low

### Option C: Combine A + B

Both the narrow interface AND a separate file.

## Recommended Action

(Filled during triage — Option A is sufficient)

## Acceptance Criteria

- [ ] No test asserts on internal CacheEntry field names
- [ ] Cache implementation can be swapped without breaking tests
- [ ] Public surface remains free of internal types

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
- Review by `compound-engineering:review:architecture-strategist`
