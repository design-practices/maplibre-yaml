---
status: pending
priority: p2
issue_id: 023
tags: [code-review, typescript]
dependencies: []
---

# `Record<string, unknown>` double-cast in dispatchByGeometry

## Problem Statement

`feature-ref-builder.ts:209-212`:

```typescript
const props = (feature.properties ?? {}) as GeoJsonProperties as Record<string, unknown>;
```

`GeoJsonProperties` is `{ [name: string]: any } | null`, so `(feature.properties ?? {})` is already typed `{ [name: string]: any }`. Casting through `GeoJsonProperties` and then to `Record<string, unknown>` is theatre that produces `unknown`-typed property access — which then forces runtime guards (`typeof props.name === "string"`).

Reviewer: kieran-typescript (P2).

## Proposed Solutions

### Option A: Single cast

```typescript
const props: Record<string, unknown> = feature.properties ?? {};
```

The runtime guards (`typeof props.name === "string"`) stay — they're correct because we genuinely don't trust the GeoJSON properties' shape. But the type expression matches reality.

- Effort: Trivial (1 line)
- Risk: Low

## Recommended Action

(Filled during triage — Option A)

## Acceptance Criteria

- [ ] Single typed assignment, no double cast
- [ ] Runtime type guards preserved

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
