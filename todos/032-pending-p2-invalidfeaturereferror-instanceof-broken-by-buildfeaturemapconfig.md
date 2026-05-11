---
status: pending
priority: p2
issue_id: 032
tags: [code-review, typescript, error-handling]
dependencies: []
---

# `InvalidFeatureRefError instanceof` promise broken by `buildFeatureMapConfig` wrapping

## Problem Statement

`InvalidFeatureRefError` (`packages/astro/src/utils/feature-ref-schema.ts`) was introduced in P1-010 specifically so consumers can discriminate the assertion failure via `err instanceof InvalidFeatureRefError`. The JSDoc on the class advertises this contract.

But `buildFeatureMapConfig` (`packages/astro/src/utils/feature-ref-builder.ts:137-146`) catches the `InvalidFeatureRefError`, re-throws it as `GeoJSONLoadError` with the original on `.cause`. Callers who try `instanceof InvalidFeatureRefError` against the public entry point's thrown error get `false` — the promise is broken.

## Findings

- `packages/astro/src/utils/feature-ref-schema.ts` — `InvalidFeatureRefError` class exported as a "discriminable subclass"
- `packages/astro/src/utils/feature-ref-builder.ts:137-146`:
  ```typescript
  try {
    assertValidFeatureRef(ref);
  } catch (cause) {
    throw new GeoJSONLoadError(
      cause instanceof Error ? cause.message : String(cause),
      ref.source,
      [],
      { cause },
    );
  }
  ```
- The wrap loses the type for everyone calling through `buildFeatureMapConfig` (the documented public path)

## Proposed Solutions

**Option 1: Re-throw `InvalidFeatureRefError` directly**

Drop the wrap entirely. `InvalidFeatureRefError extends Error` already, so it propagates fine.

```typescript
// Just call assertValidFeatureRef(ref) — let it throw.
assertValidFeatureRef(ref);
```

- Pros: simplest, preserves the discrimination contract
- Cons: callers expecting only `GeoJSONLoadError` from `buildFeatureMapConfig` see a different class; needs JSDoc update
- Effort: S
- Risk: Low

**Option 2: Make `GeoJSONLoadError` extend a base that `InvalidFeatureRefError` also extends**

Both errors share a `FeatureRefError` parent. `instanceof FeatureRefError` catches either.

- Pros: unified discrimination
- Cons: more class hierarchy than warranted; forward-compat constraint #4 already anticipates a shared base for `YAMLLoadError`/`GeoJSONLoadError`, and adding more siblings widens it
- Effort: M
- Risk: Low

**Option 3: Document the wrapping behavior; tell callers to walk `.cause`**

Update `InvalidFeatureRefError` JSDoc to say "only thrown by `assertValidFeatureRef` called directly. From `buildFeatureMapConfig`, check `(err as GeoJSONLoadError).cause instanceof InvalidFeatureRefError`."

- Pros: zero code change
- Cons: pushes complexity onto every caller
- Effort: S
- Risk: Low (but consumer footgun remains)

## Recommended Action

Option 1. The wrap added no value — it lost message fidelity (just re-used `cause.message`) and lost the type. Calling `assertValidFeatureRef(ref)` directly and letting it throw is the right minimum.

## Technical Details

- **Affected files**: `packages/astro/src/utils/feature-ref-builder.ts` (lines 137-146)
- **JSDoc update**: `buildFeatureMapConfig` `@throws` clause should list `InvalidFeatureRefError | GeoJSONLoadError`
- **Test addition**: assert `instanceof InvalidFeatureRefError` from a `buildFeatureMapConfig` call with invalid ref shape

## Acceptance Criteria

- [ ] `buildFeatureMapConfig` no longer wraps `InvalidFeatureRefError` in `GeoJSONLoadError`
- [ ] Test: invalid ref (both `featureId` and `match`) thrown from `buildFeatureMapConfig` satisfies `instanceof InvalidFeatureRefError`
- [ ] JSDoc updated
- [ ] All 248 tests still pass

## Work Log

- 2026-05-11: Identified by kieran-typescript-reviewer during post-P2 code review

## Resources

- See todo 010 (original P1 fix that introduced `InvalidFeatureRefError`)
