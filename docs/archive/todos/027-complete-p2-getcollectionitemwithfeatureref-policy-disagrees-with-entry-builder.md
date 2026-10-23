---
status: pending
priority: p2
issue_id: 027
tags: [code-review, architecture, simplicity]
dependencies: []
---

# `getCollectionItemWithFeatureRefSchema` cross-field rule disagrees with `buildMapConfigFromEntry` precedence

## Problem Statement

`getCollectionItemWithFeatureRefSchema` (`feature-ref-schema.ts:277-325`) uses a `superRefine` to **reject** entries that declare both `feature_ref` AND any inline geometry field. Meanwhile, `buildMapConfigFromEntry` (`entry-builder.ts:120-218`) silently **prefers** `feature_ref` and ignores the others.

The two policies disagree. A user who reads the entry-builder docs sees "feature_ref takes precedence over inline" and writes both fields. The schema then rejects the entry at content-collection-parse time, before the entry helper ever runs.

## Findings

- `packages/astro/src/utils/feature-ref-schema.ts:277-325` — Cross-field XOR enforced
- `packages/astro/src/utils/entry-builder.ts:120-218` — Silent precedence

Reviewer: code-simplicity (P2 — drop the schema-level XOR).

## Proposed Solutions

### Option A: Drop `applyMutualExclusivityRefinement`; let entry-builder precedence be the truth

Remove the cross-field check from the helper schema. Document the precedence order. Users get one consistent policy.

- Pros: removes ~22 LOC + a chunk of tests; removes the disagreement
- Cons: schema-level rejection was a usability win for users who genuinely confused about which field wins
- Effort: Small
- Risk: Low

### Option B: Update entry-builder to throw if multiple geometry fields set

Make the policies match in the strict direction.

- Pros: explicit failure mode
- Cons: behavior change; users currently relying on "extra fields ignored" semantics break
- Effort: Small
- Risk: Medium

### Option C: Keep both; document the precedence as "schema is opt-in strict mode"

Position `getCollectionItemWithFeatureRefSchema` as the strict variant; users who don't use it get the lenient entry-builder behavior.

- Pros: no behavior change
- Cons: inherently confusing — two ways to do the same thing
- Effort: Trivial (just docs)
- Risk: Low

## Recommended Action

(Filled during triage — Option C is the path of least resistance for V1.x; revisit in V2)

## Acceptance Criteria

- [ ] Policy is documented somewhere (README + JSDoc)
- [ ] If Option A: tests/code updated; if Option C: doc clarification only

## Resources

- Review by `compound-engineering:review:code-simplicity-reviewer`
