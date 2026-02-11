---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, design, global-config]
dependencies: []
---

# Hardcoded `?? 12` zoom in buildPointMapConfig prevents globalConfig.defaultZoom

## Problem Statement

In `packages/astro/src/utils/map-builders.ts:263`, the point builder computes zoom as:

```typescript
zoom: zoom ?? location.zoom ?? 12,
```

This means `globalConfig.defaultZoom` can never take effect for point maps, because the `12` fallback fires before `resolveMapConfig` gets a chance to apply the global default. The polygon builder at line 465 has the same pattern (`zoom ?? 12`).

The multi-point and route builders hardcode `zoom: 10` which is also bypassed by bounds, so it's less impactful there.

## Findings

- **Location**: `packages/astro/src/utils/map-builders.ts:263` (point), `:465` (polygon)
- **Current behavior**: `zoom ?? location.zoom ?? 12` always resolves before global defaults apply
- **Test "inherits zoom from globalConfig when location has no zoom"** at `map-builders.test.ts:203-214` asserts `expect(result.config.zoom).toBe(12)` which confirms the global default (8) is NOT inherited -- this is either intentional or a bug
- **Impact**: Users who set `defaultZoom: 8` in global config will see zoom 12 on point maps unless they explicitly pass `zoom`

## Proposed Solutions

### Option A: Remove the `?? 12` and let resolveMapConfig handle it
Pass `undefined` for zoom when not explicitly set, letting the resolver apply globalConfig.defaultZoom:

```typescript
zoom: zoom ?? location.zoom,  // no ?? 12 fallback
```

- **Pros**: Global config actually works for zoom; simpler mental model
- **Cons**: If no global default is set either, resolveMapConfig throws ConfigResolutionError (which is correct behavior per plan)
- **Effort**: Small
- **Risk**: Low (breaking change only if someone relies on the implicit 12)

### Option B: Keep current behavior, document it
The `?? 12` is intentional "builder convenience" -- document that builders have their own defaults that override global config.

- **Pros**: No code change; backward compatible
- **Cons**: Surprising behavior; global config is partially ineffective
- **Effort**: None
- **Risk**: None

## Acceptance Criteria

- [ ] Decision made on whether builders should respect globalConfig.defaultZoom
- [ ] If Option A: update builders + fix test assertion at map-builders.test.ts:213
- [ ] If Option B: add JSDoc noting that builders have their own zoom defaults

## Resources

- PR #17: https://github.com/design-practices/maplibre-yaml/pull/17
- File: `packages/astro/src/utils/map-builders.ts:263`
- Test: `packages/astro/tests/utils/map-builders.test.ts:203-214`
