---
status: pending
priority: p2
issue_id: 017
tags: [code-review, typescript, simplicity]
dependencies: []
---

# `INTERNAL_ALLOW_RUNTIME` mutable module-level flag is a code smell

## Problem Statement

`feature-ref-builder.ts:69-80` declares a module-level mutable flag with an exported `_setInternalAllowRuntime` setter. The forward-compat justification is "V2 runtime variants set this flag internally before calling the loader, then unset it after." This is exactly the dangerous pattern: a global mode switch that leaks across `await` boundaries. If V2 ever throws between set and unset, every subsequent build-time call silently skips the guard.

The simplicity reviewer goes further: the entire guard is V2 scaffolding for a feature that may never ship, and the test asserting "flag exists and can be toggled" tests nothing meaningful.

## Findings

- `packages/astro/src/utils/feature-ref-builder.ts:69-80` — module-level `let INTERNAL_ALLOW_RUNTIME = false`
- `packages/astro/src/utils/feature-ref-builder.ts:184-195` — `ensureBuildTimeContext` uses the flag
- `packages/astro/tests/utils/feature-ref-builder.test.ts:336-353` — test asserts toggling doesn't crash (no real contract)

Reviewers: kieran-typescript (P2), code-simplicity (delete).

## Proposed Solutions

### Option A: Replace with per-call internal option (recommended)

```typescript
export interface BuildFeatureMapOptions {
  ref: FeatureRef;
  /** @internal — V2 runtime variants only */
  _allowRuntime?: boolean;
}
```

`ensureBuildTimeContext(options)` reads `options._allowRuntime` directly. Guard remains skippable for V2; no global state.

- Pros: scope-safe; no `await`-leak risk; future V2 runtime variant just passes the flag
- Cons: adds an underscore field to the public-ish options type
- Effort: Small (~10 LOC)
- Risk: Low

### Option B: Delete the guard entirely (per simplicity reviewer)

Rely on `loadFeatureFile`'s ENOENT path to surface failures with deployment hints (see todo 012).

- Pros: removes ~35 LOC + a meaningless test
- Cons: loses proactive detection (replaced by reactive ENOENT detection from todo 012)
- Effort: Small
- Risk: Low if combined with todo 012's improvements

## Recommended Action

(Filled during triage — Option B if todo 012 lands; Option A otherwise)

## Acceptance Criteria

- [ ] No mutable module-level flag for runtime opt-out
- [ ] If guard is kept, V2 has a clear path to bypass it without global state
- [ ] If guard is removed, ENOENT errors include serverless-context hints (todo 012)

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
- Review by `compound-engineering:review:code-simplicity-reviewer`
- Related: todo 012 (runtime guard misses serverless adapters)
