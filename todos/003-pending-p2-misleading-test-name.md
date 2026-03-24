---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, testing]
dependencies: ["002"]
---

# Misleading test name: "inherits zoom from globalConfig" actually asserts the opposite

## Problem Statement

The test at `packages/astro/tests/utils/map-builders.test.ts:203` is named:

> "inherits zoom from globalConfig when location has no zoom"

But it asserts `expect(result.config.zoom).toBe(12)`, which is the hardcoded builder default -- NOT the globalConfig's `defaultZoom: 8`. The test name says "inherits" but the assertion proves it does NOT inherit.

## Findings

- **Location**: `packages/astro/tests/utils/map-builders.test.ts:203-214`
- **Test name says**: inherits zoom from globalConfig
- **Test actually asserts**: zoom is 12 (builder default), not 8 (globalConfig default)
- **Coupled to**: Finding #002 (if the `?? 12` is removed, this test name becomes correct)

## Proposed Solutions

### Option A: Rename the test to match actual behavior
```typescript
it("uses builder default zoom (12) when location has no zoom", () => {
```

- **Effort**: Small
- **Risk**: None

### Option B: Fix together with #002
If #002 Option A is chosen (remove `?? 12`), the test assertion changes to `toBe(8)` and the current name becomes accurate.

- **Effort**: None (part of #002)

## Acceptance Criteria

- [ ] Test name accurately describes what is being asserted

## Resources

- PR #17: https://github.com/design-practices/maplibre-yaml/pull/17
- File: `packages/astro/tests/utils/map-builders.test.ts:203-214`
