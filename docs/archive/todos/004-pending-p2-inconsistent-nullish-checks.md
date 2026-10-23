---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, typescript, consistency]
dependencies: []
---

# Inconsistent nullish checks: mapStyle uses falsy vs center/zoom use === undefined

## Problem Statement

In `packages/core/src/utils/config-resolver.ts:111-118`, mapStyle is checked with a falsy check (`!resolved.mapStyle`) while center and zoom use strict undefined checks (`=== undefined`). This means an empty string `""` for mapStyle would be caught, but a `0` for zoom would not (though 0 is a valid zoom level).

The inconsistency is a code smell even if it doesn't cause bugs today.

## Findings

- **Location**: `packages/core/src/utils/config-resolver.ts:111-118`
- **mapStyle check**: `if (!resolved.mapStyle)` -- catches `undefined`, `null`, `""`, `0`, `false`
- **center check**: `if (resolved.center === undefined)` -- only catches `undefined`
- **zoom check**: `if (resolved.zoom === undefined)` -- only catches `undefined`
- **Practical impact**: Low. mapStyle should never be `""` or `0`. But the inconsistency is confusing.

## Proposed Solutions

### Option A: Standardize on `=== undefined` (Recommended)
```typescript
if (resolved.mapStyle === undefined) {
```

- **Pros**: Consistent; clear intent
- **Cons**: Would not catch empty string mapStyle (but that would fail elsewhere anyway)
- **Effort**: Small
- **Risk**: None

### Option B: Keep as-is
The falsy check on mapStyle is arguably more defensive since empty string URLs are never valid.

- **Effort**: None

## Acceptance Criteria

- [ ] All three checks use the same pattern
- [ ] All tests still pass

## Resources

- PR #17: https://github.com/design-practices/maplibre-yaml/pull/17
- File: `packages/core/src/utils/config-resolver.ts:111-118`
