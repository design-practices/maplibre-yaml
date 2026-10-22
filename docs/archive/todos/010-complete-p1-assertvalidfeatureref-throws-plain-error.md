---
status: pending
priority: p1
issue_id: 010
tags: [code-review, typescript, error-handling]
dependencies: []
---

# `assertValidFeatureRef` throws plain `Error`; type signature lies

## Problem Statement

`assertValidFeatureRef` (`feature-ref-schema.ts:188-202`) is documented as throwing "a Zod-style error" but actually throws a vanilla `Error`. The downstream `buildFeatureMapConfig` rewraps it in `GeoJSONLoadError` (line 156-164 of feature-ref-builder.ts), but advanced consumers calling `assertValidFeatureRef` directly — exactly the pattern shown in its JSDoc example at lines 171-186 — get a generic `Error` they can't `instanceof`-discriminate from anything else.

The JSDoc lies about behavior, and consumers wiring this into their own `superRefine` will catch a generic `Error` and have to string-match the message to identify it.

## Findings

- `packages/astro/src/utils/feature-ref-schema.ts:165-176` — JSDoc says "Throws a Zod-style error if invalid"
- `packages/astro/src/utils/feature-ref-schema.ts:194-200` — Implementation throws `new Error(...)`, not Zod-style
- `packages/astro/src/utils/feature-ref-schema.ts:171-186` — Example shows consumers wiring into `superRefine` and catching `(err as Error).message` — the only way to identify the error is by string match

Reviewer: kieran-typescript (P1).

## Proposed Solutions

### Option A: Throw a dedicated `InvalidFeatureRefError` subclass (recommended)

```typescript
export class InvalidFeatureRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFeatureRefError";
  }
}

export function assertValidFeatureRef(ref: FeatureRef): void {
  // ...
  if (!hasId && !hasMatch) {
    throw new InvalidFeatureRefError(
      "feature_ref must specify either 'featureId' or 'match: { property, equals }'",
    );
  }
  // ...
}
```

- Pros: consumers can `instanceof InvalidFeatureRefError`; aligns with the existing error class pattern in the package (e.g., `GeoJSONLoadError`)
- Cons: adds another exported class
- Effort: Small
- Risk: Low

### Option B: Return a discriminated `Result` type

```typescript
export function validateFeatureRef(ref: FeatureRef):
  | { ok: true }
  | { ok: false; reason: string };
```

Caller decides what to do (throw, log, accumulate).

- Pros: no try/catch needed; works inside Zod `superRefine` cleanly (just push to ctx.issues if `!ok`)
- Cons: bigger API change; existing caller (`buildFeatureMapConfig`) needs to construct the error itself
- Effort: Small
- Risk: Low — but the rename `assert*` → `validate*` matches the existing repo convention better (see todo 027 about naming)

### Option C: Update JSDoc to say "throws plain Error"

Smallest change — just match docs to reality.

- Pros: zero code change
- Cons: doesn't fix the underlying DX issue; consumers still can't discriminate
- Effort: Trivial
- Risk: Low

## Recommended Action

(Filled during triage — Option B is most aligned with the package's existing patterns and gives best DX)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-schema.ts`
- `packages/astro/src/utils/feature-ref-builder.ts` (the caller wraps with `GeoJSONLoadError`)
- `packages/astro/tests/utils/feature-ref-schema.test.ts`
- `packages/astro/src/index.ts` and `src/utils/index.ts` (if Option A or B introduces a new export)

## Acceptance Criteria

- [ ] `assertValidFeatureRef` either throws a discriminable error class OR returns a Result
- [ ] JSDoc matches actual behavior
- [ ] Consumers can identify validation failures without string-matching messages

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:kieran-typescript-reviewer`
- Related: todo 027 (assertValidFeatureRef naming convention)
