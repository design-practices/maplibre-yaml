---
status: pending
priority: p1
issue_id: 009
tags: [code-review, typescript, contract]
dependencies: []
---

# `MultiLineStringMapOptions.padding` declared but never consumed

## Problem Statement

`MultiLineStringMapOptions` declares `padding?: number` (line 174) but `buildMultiLineStringMapConfig` never destructures or uses it (line 874 omits `padding`). Callers passing `padding: 50` get nothing — silent contract violation with no way to discover the field is dead.

Compounding issue: `buildRouteMapConfig` (line 610) and `buildMultiPointMapConfig` (line 396) both destructure `padding` but neither actually forwards it to `resolveMapConfig` or the underlying source. The field appears to be vestigial across the entire family of builders.

## Findings

- `packages/astro/src/utils/map-builders.ts:172-179` — `MultiLineStringMapOptions.padding` declared
- `packages/astro/src/utils/map-builders.ts:870-991` — `buildMultiLineStringMapConfig` doesn't reference `padding`
- `packages/astro/src/utils/map-builders.ts:610` — `buildRouteMapConfig` destructures it but doesn't use it
- `packages/astro/src/utils/map-builders.ts:396` — `buildMultiPointMapConfig` same pattern

Reviewer: kieran-typescript (P1).

## Proposed Solutions

### Option A: Wire `padding` through to `resolveMapConfig` everywhere it's declared (recommended)

Whatever the original intent was (likely "padding around bounds for `fitBounds`"), implement it properly. Pass it to `resolveMapConfig` or the bounds-fitting path.

- Pros: honors the declared API
- Cons: requires understanding what "padding" was meant to do (probably bounds inset for the initial `fitBounds` call)
- Effort: Small-Medium (need to investigate intended semantics)
- Risk: Low

### Option B: Remove `padding` from all four builder option types

If the field is genuinely unused and never was wired, remove it.

- Pros: shrinks the API surface, removes confusion
- Cons: technically a breaking change for any caller currently passing `padding` (silently broken today, but TypeScript will flag the removal)
- Effort: Trivial
- Risk: Low (callers got nothing from the field anyway)

### Option C: Document `padding` as "not yet implemented"

Add JSDoc `@deprecated` or `@todo` until wired.

- Pros: minimal change
- Cons: leaves dead code in the API
- Effort: Trivial
- Risk: Low

## Recommended Action

(Filled during triage — recommend B for V1.x since the field never worked; reintroduce as A in V2 if needed)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/map-builders.ts`

## Acceptance Criteria

- [ ] `padding` field is either functional (Option A) or removed from option types (Option B)
- [ ] If removed, changeset notes the removal
- [ ] Tests reflect the chosen behavior

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
