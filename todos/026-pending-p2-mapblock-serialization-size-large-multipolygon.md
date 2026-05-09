---
status: pending
priority: p2
issue_id: 026
tags: [code-review, performance]
dependencies: []
---

# MapBlock serialization size for large multi-geometries

## Problem Statement

A MultiPolygon with 50 polygons × 1000 vertices each = 50k coordinates × ~30 bytes JSON = **~1.5MB per `<ml-map>` HTML attribute**. HTML attributes don't have a hard cap but parsers and DevTools struggle past ~1MB, and it ships uncompressed-relative-to-tiles.

The new `buildMultiPolygonMapConfig` and `buildMultiLineStringMapConfig` produce these large embedded configs. Best place for a warning is in the rendering component, not the builder utilities (which should stay pure).

## Findings

- `packages/astro/src/utils/map-builders.ts:799-812` — embeds full MultiPolygon
- `packages/astro/src/utils/map-builders.ts:962-988` — embeds full MultiLineString
- `packages/astro/src/components/Map.astro` — would be the natural place to add a build-time warning

Reviewer: performance-oracle (P3, calling out as a real-world concern).

## Proposed Solutions

### Option A: Add build-time warning in `Map.astro`

```typescript
const serialized = JSON.stringify(config);
if (serialized.length > 500_000) {
  console.warn(`[maplibre-yaml] Large MapBlock config (${(serialized.length / 1024).toFixed(0)}KB) embedded in HTML attribute. Consider pre-tiling the data or using a vector source.`);
}
```

- Pros: catches the issue at the right layer; users get an actionable warning
- Cons: adds logging in a component file
- Effort: Trivial
- Risk: Low

### Option B: Document in README/docs

Add a "When to use a vector source instead" note.

- Pros: zero code change
- Cons: easy to miss
- Effort: Trivial

### Option C: Both A and B

## Recommended Action

(Filled during triage — Option C)

## Acceptance Criteria

- [ ] Users with large MultiPolygon configs see a build-time warning
- [ ] Docs explain when to switch to a vector source

## Resources

- Review by `compound-engineering:review:performance-oracle`
