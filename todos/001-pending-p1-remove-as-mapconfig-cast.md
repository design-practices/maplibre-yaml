---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, typescript, type-safety]
dependencies: []
---

# Remove `as MapConfig` type cast in resolveMapConfig

## Problem Statement

In `packages/core/src/utils/config-resolver.ts:132`, the function returns `resolved as MapConfig` which is an unsafe type assertion. After the validation block confirms all required fields are present (mapStyle, center, zoom), TypeScript still doesn't narrow the type because the checks are done against a plain object. The `as MapConfig` cast bypasses the type system rather than proving the type is correct.

This was flagged by the Kieran TypeScript reviewer as the only merge-blocking issue.

## Findings

- **Location**: `packages/core/src/utils/config-resolver.ts:132`
- **Current code**: `return resolved as MapConfig;`
- **Risk**: If the validation logic drifts from the `MapConfig` type (e.g., a new required field is added to MapConfig but not checked), the cast will silently pass invalid data.

## Proposed Solutions

### Option A: Build a validated object after checks (Recommended)
After the missing-fields check passes, construct a new object with narrowed types:

```typescript
return {
  center: center!,
  zoom: zoom!,
  mapStyle: resolved.mapStyle!,
  interactive: resolved.interactive,
  pitch: resolved.pitch,
  bearing: resolved.bearing,
  ...(resolved.bounds ? { bounds: resolved.bounds } : {}),
};
```

- **Pros**: TypeScript verifies all fields at compile time; if MapConfig adds a field, this breaks loudly
- **Cons**: Slightly more verbose; uses non-null assertions (but safe since we just validated)
- **Effort**: Small
- **Risk**: Low

### Option B: Use a type guard function
Create a `isValidMapConfig` type guard that narrows the type:

```typescript
function isValidMapConfig(obj: Record<string, unknown>): obj is MapConfig {
  return obj.center !== undefined && obj.zoom !== undefined && !!obj.mapStyle;
}
```

- **Pros**: Reusable; clean pattern
- **Cons**: Still a runtime check that could drift; essentially same as current `isMapConfigComplete`
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] No `as MapConfig` cast in config-resolver.ts
- [ ] TypeScript compiles without errors
- [ ] All 1,001 tests still pass
- [ ] If a new required field is added to MapConfig, the return site fails to compile

## Resources

- PR #17: https://github.com/design-practices/maplibre-yaml/pull/17
- File: `packages/core/src/utils/config-resolver.ts:132`
