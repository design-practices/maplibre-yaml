---
status: pending
priority: p3
issue_id: "005"
tags: [code-review, schema, dry]
dependencies: []
---

# Reuse ZoomLevelSchema instead of inline zoom validation

## Problem Statement

`packages/core/src/schemas/page.schema.ts` defines `defaultZoom` with inline validation:

```typescript
defaultZoom: z.number().min(0).max(24).optional()
```

But `packages/core/src/schemas/base.schema.ts` already exports a `ZoomLevelSchema` (or similar) that validates the same 0-24 range. Duplicating the range means if we ever change the valid zoom range, we'd need to update both places.

## Proposed Solutions

### Option A: Import and reuse ZoomLevelSchema
```typescript
defaultZoom: ZoomLevelSchema.optional()
```

- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] `defaultZoom` in GlobalConfigSchema uses shared zoom schema
- [ ] All tests still pass

## Resources

- File: `packages/core/src/schemas/page.schema.ts`
- File: `packages/core/src/schemas/base.schema.ts`
